# -*- coding: utf-8 -*-
"""Local MOSS-Transcribe-Diarize sidecar using MeetingCopilot's WS protocol.

MOSS-Transcribe-Diarize is a long-form, one-shot generative ASR model rather
than a native streaming model.  This sidecar therefore buffers one utterance,
finalizes it after trailing silence, and emits one final DashScope-compatible
``result-generated`` event.  Live partial re-decodes are deliberately disabled
to keep latency and VRAM use predictable.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import gc
import json
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from moss_asr_utils import max_new_tokens, transcript_text


logging.basicConfig(level=logging.INFO, format="[moss-local] %(message)s", stream=sys.stderr)
log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
SILENCE_FLUSH_MS = 700
SILENCE_RMS = 0.004
MIN_UTTERANCE_SAMPLES = 4_800  # 300 ms
MODEL_ID = "OpenMOSS-Team/MOSS-Transcribe-Diarize"
MODEL_REVISION = "e6d68cdfcddbdad1a7e8454f0cb859cad76e2502"
STRICT_PROMPT = (
    "请准确转写音频中的原语言内容，不要翻译，不要补充或猜测未说出的内容。"
    "严格只输出格式：[起始秒数][S01]文本[结束秒数]；"
    "时间戳、说话人编号、文本缺一不可。"
)

_executor = ThreadPoolExecutor(max_workers=1)
_model = None
_processor = None
_torch = None
_device = None
_dtype = None
_infer_ms: list[float] = []


def _release_cuda(torch_module) -> None:
    gc.collect()
    if torch_module.cuda.is_available():
        torch_module.cuda.empty_cache()


def _load_on_device(device_name: str, model_id: str, revision: str):
    import torch
    from transformers import AutoModelForCausalLM, AutoProcessor

    device = torch.device(device_name)
    dtype = torch.bfloat16 if device.type == "cuda" else torch.float32
    log.info(
        "torch %s | cuda available=%s | loading %s on %s (%s)",
        torch.__version__,
        torch.cuda.is_available(),
        model_id,
        device,
        dtype,
    )
    # The checkpoint is BF16.  Loading it in its native dtype first avoids a
    # transient second GPU copy; CPU fallback explicitly expands to FP32.
    load_dtype = "auto" if device.type == "cuda" else torch.float32
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        trust_remote_code=True,
        dtype=load_dtype,
        revision=revision,
    )
    model = model.to(device=device, dtype=dtype).eval()
    processor = AutoProcessor.from_pretrained(
        model_id,
        trust_remote_code=True,
        revision=revision,
    )
    return torch, model, processor, device, dtype


def load_model(requested_device: str, model_id: str, revision: str) -> None:
    """Load on CUDA by default and retry on CPU when automatic loading fails."""

    global _torch, _model, _processor, _device, _dtype

    import torch

    if requested_device == "auto":
        candidates = ["cuda:0", "cpu"] if torch.cuda.is_available() else ["cpu"]
    else:
        candidates = [requested_device]

    last_message = "no device candidates"
    for candidate in candidates:
        try:
            bundle = _load_on_device(candidate, model_id, revision)
            _torch, _model, _processor, _device, _dtype = bundle
            log.info("model ready on %s", _device)
            return
        except Exception as error:  # runtime/model errors vary by backend
            last_message = f"{type(error).__name__}: {error}"
            log.warning("device %s initialization failed: %s", candidate, last_message)
            _model = None
            _processor = None
            _release_cuda(torch)
    raise RuntimeError(f"MOSS model failed on all devices ({last_message})")


def _infer(pcm: np.ndarray) -> str:
    messages = [
        {
            "role": "user",
            "content": [
                # A placeholder value is sufficient for the chat template;
                # the real in-memory PCM is passed directly to the processor
                # below.  This bypasses an upstream helper whose Python ``or``
                # rejects NumPy arrays because their truth value is ambiguous.
                {"type": "audio", "audio": "in-memory-pcm"},
                {"type": "text", "text": STRICT_PROMPT},
            ],
        }
    ]
    started = time.perf_counter()
    prompt = _processor.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    audio_kwargs = {"device": str(_device)} if _device.type == "cuda" else {}
    inputs = _processor(
        text=prompt,
        audio=[np.ascontiguousarray(pcm, dtype=np.float32)],
        max_length=131_072,
        audio_kwargs=audio_kwargs,
        return_tensors="pt",
    ).to(_device)
    prompt_len = int(inputs["attention_mask"][0].sum().item())
    generation_config = copy.deepcopy(_model.generation_config)
    generation_config.max_new_tokens = max_new_tokens(len(pcm))
    generation_config.do_sample = False
    with _torch.inference_mode(), (
        _torch.amp.autocast("cuda", dtype=_dtype)
        if _device.type == "cuda"
        else _torch.no_grad()
    ):
        outputs = _model.generate(
            input_ids=inputs["input_ids"],
            attention_mask=inputs["attention_mask"],
            input_features=inputs["input_features"],
            audio_feature_lengths=inputs["audio_feature_lengths"],
            audio_chunk_mapping=inputs["audio_chunk_mapping"],
            generation_config=generation_config,
        )
    generated_ids = outputs[0][prompt_len:]
    raw = _processor.tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
    elapsed = (time.perf_counter() - started) * 1000
    _infer_ms.append(elapsed)
    text = transcript_text(raw)
    log.info("infer audio=%.2fs latency=%.0fms raw=%r", len(pcm) / SAMPLE_RATE, elapsed, raw[:160])
    return text


class Session:
    def __init__(self, ws):
        self.ws = ws
        self.task_id = ""
        self.sent_buf = np.zeros(0, dtype=np.float32)
        self.samples_seen = 0
        self.sent_begin_ms = -1
        self.last_voice_ms = 0
        self.silence_ms = 0.0

    async def send_event(self, event: str, payload=None, **header):
        message = {
            "header": {"event": event, "task_id": self.task_id, "attributes": {}, **header},
            "payload": payload or {},
        }
        await self.ws.send(json.dumps(message, ensure_ascii=False))

    async def send_sentence(self, text: str):
        await self.send_event(
            "result-generated",
            {
                "output": {
                    "sentence": {
                        "begin_time": max(self.sent_begin_ms, 0),
                        "end_time": self.last_voice_ms,
                        "text": text,
                        "heartbeat": False,
                        "sentence_end": True,
                    }
                },
                "usage": None,
            },
        )

    async def feed(self, pcm16: bytes):
        pcm = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
        if not len(pcm):
            return
        block_ms = len(pcm) / 16.0
        self.samples_seen += len(pcm)
        now_ms = self.samples_seen / 16.0
        rms = float(np.sqrt(np.mean(pcm * pcm)))
        voiced = rms > SILENCE_RMS
        if voiced:
            self.silence_ms = 0.0
            self.last_voice_ms = int(now_ms)
            if self.sent_begin_ms < 0:
                self.sent_begin_ms = int(now_ms - block_ms)
        elif self.sent_begin_ms >= 0:
            self.silence_ms += block_ms

        if self.sent_begin_ms >= 0:
            self.sent_buf = np.concatenate([self.sent_buf, pcm])
            if self.silence_ms >= SILENCE_FLUSH_MS:
                await self.finalize()

    async def finalize(self):
        pcm = self.sent_buf
        self.sent_buf = np.zeros(0, dtype=np.float32)
        if len(pcm) >= MIN_UTTERANCE_SAMPLES:
            loop = asyncio.get_running_loop()
            text = await loop.run_in_executor(_executor, _infer, pcm)
            if text:
                await self.send_sentence(text)
        self.sent_begin_ms = -1
        self.silence_ms = 0.0

    async def finish(self):
        if self.sent_begin_ms >= 0 and len(self.sent_buf):
            await self.finalize()


async def handle(ws):
    session = Session(ws)
    log.info("connection open")
    try:
        async for message in ws:
            if isinstance(message, (bytes, bytearray)):
                await session.feed(bytes(message))
                continue
            try:
                request = json.loads(message)
            except Exception:
                continue
            action = (request.get("header") or {}).get("action")
            if action == "run-task":
                session.task_id = (request.get("header") or {}).get("task_id", "")
                await session.send_event("task-started")
                log.info("task-started %s", session.task_id)
            elif action == "finish-task":
                await session.finish()
                await session.send_event("task-finished")
                log.info("task-finished %s", session.task_id)
                await ws.close()
                break
    except Exception as error:
        log.exception("connection failed: %s", error)
        try:
            await session.send_event(
                "task-failed",
                error_code="MOSS_LOCAL_ERROR",
                error_message=str(error),
            )
        except Exception:
            pass


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=10097)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--device", default="auto", help="auto | cuda:0 | cpu")
    parser.add_argument("--model-id", default=MODEL_ID)
    parser.add_argument("--revision", default=MODEL_REVISION)
    args = parser.parse_args()

    load_model(args.device, args.model_id, args.revision)

    import websockets

    async with websockets.serve(handle, args.host, args.port, max_size=None):
        log.info("listening on ws://%s:%d", args.host, args.port)
        print(f"MOSS_ASR_READY ws://{args.host}:{args.port}", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
