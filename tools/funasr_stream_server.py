# -*- coding: utf-8 -*-
"""
Local streaming ASR sidecar: FunASR models behind a WebSocket server that
speaks the SAME protocol as Aliyun DashScope realtime ASR (run-task /
task-started / binary pcm16 frames / result-generated / finish-task /
task-finished). The app's AliyunRealtimeEngine connects to
ws://127.0.0.1:<port> with no Node-side changes.

Two engines (loadable together, routed per session by run-task payload.model):
  paraformer   paraformer-zh-streaming (220M): TRUE streaming
               (600ms chunks, incremental decode). zh great, en poor.
  nano         Fun-ASR-Nano-2512 (0.8B LLM decoder, 31 languages,
               punctuation): NOT streaming — pseudo-streamed by
               re-transcribing the open sentence for partials and
               finalizing on trailing silence. zh+en both good.

--model both (default) loads both; the app's settings pick per-connection:
a run-task whose payload.model contains "paraformer" gets the streaming
engine, anything else gets nano (fallback = whichever is loaded).

Run (conda env `funasr`):
  conda run --no-capture-output -n funasr python tools/funasr_stream_server.py \
    --port 10097 --model both --device auto

First start downloads the model(s) from ModelScope (China-direct).
"""
import argparse
import asyncio
import json
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

logging.basicConfig(level=logging.INFO, format="[funasr-local] %(message)s", stream=sys.stderr)
log = logging.getLogger(__name__)

SAMPLE_RATE = 16000
# paraformer-zh-streaming canonical config: [0, 10, 5] * 60ms => 600ms chunks
CHUNK_SIZE = [0, 10, 5]
CHUNK_SAMPLES = CHUNK_SIZE[1] * 960  # 10 * 60ms * 16 samples/ms
ENCODER_LOOK_BACK = 4
DECODER_LOOK_BACK = 1
# endpointing: flush the sentence after this much trailing silence
SILENCE_FLUSH_MS = 700
SILENCE_RMS = 0.004
# nano pseudo-streaming: re-transcribe the open sentence at most this often
PARTIAL_INTERVAL_MS = 1200

NANO_MODEL_ID = "FunAudioLLM/Fun-ASR-Nano-2512"

# one worker: serialize inference across sessions (them/me)
_executor = ThreadPoolExecutor(max_workers=1)
_models = {"stream": None, "oneshot": None}
_infer_ms: list = []  # rolling per-call latency


def load_model(model_arg: str, device: str):
    import torch
    from funasr import AutoModel

    if device == "auto":
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
    log.info("torch %s | cuda available=%s | using device=%s",
             torch.__version__, torch.cuda.is_available(), device)
    if device.startswith("cuda"):
        log.info("gpu: %s", torch.cuda.get_device_name(0))

    if model_arg in ("nano", "both"):
        log.info("loading %s (first run downloads ~1.7GB from ModelScope)...", NANO_MODEL_ID)
        m = AutoModel(model=NANO_MODEL_ID, disable_update=True, disable_pbar=True,
                      device=device)
        # NOTE: nano's generate_chatml only accepts a file path (str) or a
        # torch.Tensor — a numpy array silently becomes None and crashes.
        m.generate(input=torch.from_numpy(np.zeros(SAMPLE_RATE, dtype=np.float32)))  # warm
        _models["oneshot"] = m
    if model_arg in ("paraformer", "both"):
        log.info("loading paraformer-zh-streaming (first run downloads ~880MB from ModelScope)...")
        m = AutoModel(model="paraformer-zh-streaming", disable_update=True,
                      disable_pbar=True, device=device)
        m.generate(
            input=np.zeros(CHUNK_SAMPLES, dtype=np.float32),
            cache={}, is_final=True, chunk_size=CHUNK_SIZE,
            encoder_chunk_look_back=ENCODER_LOOK_BACK,
            decoder_chunk_look_back=DECODER_LOOK_BACK,
        )
        _models["stream"] = m
    loaded = [k for k, v in _models.items() if v is not None]
    if not loaded:
        raise SystemExit(f"unknown --model {model_arg} (use paraformer | nano | both)")
    log.info("model(s) ready: %s", ", ".join(loaded))


def pick_mode(requested_model: str) -> str:
    """Route a session by the model name the app sent in run-task."""
    want = "stream" if "paraformer" in (requested_model or "").lower() else "oneshot"
    if _models[want] is None:  # fallback: whatever is loaded
        want = "stream" if _models["stream"] is not None else "oneshot"
    return want


def _timed(fn):
    t0 = time.perf_counter()
    out = fn()
    ms = (time.perf_counter() - t0) * 1000
    _infer_ms.append(ms)
    if len(_infer_ms) % 10 == 0:
        recent = _infer_ms[-10:]
        log.info("infer latency last10: avg=%.0fms min=%.0fms max=%.0fms",
                 sum(recent) / len(recent), min(recent), max(recent))
    return out


def _text_of(res) -> str:
    if res and isinstance(res, list):
        return (res[0].get("text") or "").strip()
    return ""


def _infer_stream(pcm: np.ndarray, cache: dict, is_final: bool) -> str:
    return _text_of(_timed(lambda: _models["stream"].generate(
        input=pcm, cache=cache, is_final=is_final, chunk_size=CHUNK_SIZE,
        encoder_chunk_look_back=ENCODER_LOOK_BACK,
        decoder_chunk_look_back=DECODER_LOOK_BACK,
    )))


def _infer_oneshot(pcm: np.ndarray) -> str:
    import torch

    tensor = torch.from_numpy(np.ascontiguousarray(pcm))
    return _text_of(_timed(lambda: _models["oneshot"].generate(input=tensor, batch_size=1)))


class Session:
    """One WS connection = one streaming task (mirrors DashScope semantics)."""

    def __init__(self, ws):
        self.ws = ws
        self.task_id = ""
        self.mode = "oneshot"  # set from run-task payload.model (pick_mode)
        self.buf = np.zeros(0, dtype=np.float32)  # un-chunked inbound pcm
        # shared endpointing state
        self.samples_seen = 0
        self.sent_begin_ms = -1
        self.last_voice_ms = 0
        self.silence_ms = 0.0
        # stream mode
        self.cache = {}
        self.text = ""
        # oneshot mode
        self.sent_buf = np.zeros(0, dtype=np.float32)  # current open sentence
        self.pre_block = np.zeros(0, dtype=np.float32)  # rolling pre-roll
        self.last_partial_samples = 0
        self.partial_busy = False
        self.sent_gen = 0  # bumped on each final: kills stale partials

    async def send_event(self, event: str, payload=None, **hdr):
        msg = {"header": {"event": event, "task_id": self.task_id, "attributes": {}, **hdr},
               "payload": payload or {}}
        await self.ws.send(json.dumps(msg, ensure_ascii=False))

    async def send_sentence(self, text: str, end: bool):
        await self.send_event(
            "result-generated",
            {
                "output": {
                    "sentence": {
                        "begin_time": max(self.sent_begin_ms, 0),
                        "end_time": self.last_voice_ms,
                        "text": text,
                        "heartbeat": False,
                        "sentence_end": end,
                    }
                },
                "usage": None,
            },
        )

    async def feed(self, pcm16: bytes):
        pcm = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
        self.buf = np.concatenate([self.buf, pcm])
        while len(self.buf) >= CHUNK_SAMPLES:
            block, self.buf = self.buf[:CHUNK_SAMPLES], self.buf[CHUNK_SAMPLES:]
            await self.process_block(block)

    def _track_voice(self, block: np.ndarray) -> bool:
        block_ms = len(block) / 16.0
        self.samples_seen += len(block)
        now_ms = self.samples_seen / 16.0
        rms = float(np.sqrt(np.mean(block * block))) if len(block) else 0.0
        voiced = rms > SILENCE_RMS
        if voiced:
            self.silence_ms = 0.0
            self.last_voice_ms = int(now_ms)
            if self.sent_begin_ms < 0:
                self.sent_begin_ms = int(now_ms - block_ms)
        else:
            self.silence_ms += block_ms
        return voiced

    async def process_block(self, block: np.ndarray):
        if self.mode == "stream":
            await self._process_stream(block)
        else:
            await self._process_oneshot(block)

    # ---- true streaming (paraformer) ----

    async def _process_stream(self, block: np.ndarray):
        self._track_voice(block)
        loop = asyncio.get_running_loop()
        inc = await loop.run_in_executor(_executor, _infer_stream, block, self.cache, False)
        if inc:
            self.text += inc
            await self.send_sentence(self.text, end=False)
        if self.text and self.silence_ms >= SILENCE_FLUSH_MS:
            await self.flush_sentence()

    # ---- pseudo streaming (nano): re-transcribe the open sentence ----

    async def _process_oneshot(self, block: np.ndarray):
        voiced = self._track_voice(block)
        in_sentence = len(self.sent_buf) > 0

        if not in_sentence:
            if voiced:
                # sentence starts: include one block of pre-roll
                self.sent_buf = np.concatenate([self.pre_block, block])
                self.last_partial_samples = 0
            else:
                self.pre_block = block  # rolling 600ms pre-roll
            return

        self.sent_buf = np.concatenate([self.sent_buf, block])

        # final: enough trailing silence => one clean full-sentence pass
        if self.silence_ms >= SILENCE_FLUSH_MS:
            await self._finalize_oneshot()
            return

        # partial: re-transcribe the whole open sentence, throttled + latest-wins
        grown_ms = (len(self.sent_buf) - self.last_partial_samples) / 16.0
        if voiced and not self.partial_busy and grown_ms >= PARTIAL_INTERVAL_MS:
            self.last_partial_samples = len(self.sent_buf)
            self.partial_busy = True
            gen = self.sent_gen
            snapshot = self.sent_buf

            async def run_partial():
                try:
                    loop = asyncio.get_running_loop()
                    text = await loop.run_in_executor(_executor, _infer_oneshot, snapshot)
                    if text and gen == self.sent_gen:  # sentence not finalized meanwhile
                        await self.send_sentence(text, end=False)
                except Exception as e:
                    log.info("partial failed: %s", e)
                finally:
                    self.partial_busy = False

            asyncio.get_running_loop().create_task(run_partial())

    async def _finalize_oneshot(self):
        pcm = self.sent_buf
        self.sent_gen += 1  # cancel in-flight partials for this sentence
        self.sent_buf = np.zeros(0, dtype=np.float32)
        self.pre_block = np.zeros(0, dtype=np.float32)
        self.last_partial_samples = 0
        if len(pcm) < 4800:  # <300ms of audio: click/noise
            self.sent_begin_ms = -1
            return
        loop = asyncio.get_running_loop()
        text = await loop.run_in_executor(_executor, _infer_oneshot, pcm)
        if text:
            await self.send_sentence(text, end=True)
        self.sent_begin_ms = -1
        self.silence_ms = 0.0

    # ---- finish-task ----

    async def flush_sentence(self):
        if self.mode == "oneshot":
            if len(self.sent_buf) > 0 and self.sent_begin_ms >= 0:
                await self._finalize_oneshot()
            return
        # stream mode: flush decoder lookahead; suppress silence hallucinations
        had_voice = self.sent_begin_ms >= 0
        loop = asyncio.get_running_loop()
        tail = self.buf if len(self.buf) > 0 else np.zeros(960, dtype=np.float32)
        self.buf = np.zeros(0, dtype=np.float32)
        self.samples_seen += len(tail)
        inc = await loop.run_in_executor(_executor, _infer_stream, tail, self.cache, True)
        if inc and had_voice:
            self.text += inc
        if self.text and had_voice:
            await self.send_sentence(self.text, end=True)
        self.cache = {}
        self.text = ""
        self.sent_begin_ms = -1
        self.silence_ms = 0.0


async def handle(ws):
    session = Session(ws)
    log.info("connection open")
    try:
        async for message in ws:
            if isinstance(message, (bytes, bytearray)):
                await session.feed(bytes(message))
                continue
            try:
                j = json.loads(message)
            except Exception:
                continue
            action = (j.get("header") or {}).get("action")
            if action == "run-task":
                session.task_id = (j.get("header") or {}).get("task_id", "")
                requested = ((j.get("payload") or {}).get("model")) or ""
                session.mode = pick_mode(requested)
                await session.send_event("task-started")
                log.info("task-started %s model=%s -> %s", session.task_id, requested, session.mode)
            elif action == "finish-task":
                await session.flush_sentence()
                await session.send_event("task-finished")
                log.info("task-finished %s", session.task_id)
                await ws.close()
                break
    except Exception as e:  # connection reset etc.
        log.info("connection closed: %s", e)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=10097)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--device", default="auto", help="auto | cpu | cuda:0")
    ap.add_argument("--model", default="both", help="paraformer | nano | both")
    args = ap.parse_args()

    load_model(args.model, args.device)

    import websockets

    async with websockets.serve(handle, args.host, args.port, max_size=None):
        log.info("listening on ws://%s:%d", args.host, args.port)
        print(f"FUNASR_READY ws://{args.host}:{args.port}", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
