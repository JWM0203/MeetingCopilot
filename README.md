<div align="center">

# MeetingCopilot

**Real-time stealth meeting & interview copilot for Windows**

Live transcription of the other side · first-person teleprompter answers · invisible to screen sharing

<a href="https://github.com/JWM0203/MeetingCopilot/stargazers"><img src="https://img.shields.io/github/stars/JWM0203/MeetingCopilot?style=flat-square&logo=github&color=2a6df4" alt="GitHub stars"></a>
<img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Commons%20Clause-3da639?style=flat-square" alt="license">
<a href="https://gitee.com/jwm0302/MeetingCopilot"><img src="https://img.shields.io/badge/Gitee-China%20mirror-C71D23?style=flat-square&logo=gitee" alt="Gitee mirror"></a>
<a href="https://www.xiaohongshu.com/discovery/item/6a50df530000000007020f79?source=webshare&xhsshare=pc_web&xsec_token=ABbqtJXWoEQSYl-hNrBxJbXeGEZWoH6YjnAYj97pjKEpo=&xsec_source=pc_share"><img src="https://img.shields.io/badge/小红书-视频介绍-ff2442?style=flat-square&logo=xiaohongshu&logoColor=white" alt="小红书视频介绍"></a>

[简体中文](README.zh-CN.md) · [Features](#features) · [Quick Start](#quick-start) · [ASR Backends](#asr-backends) · [License](#license)

</div>

---

![Live demo: real-time transcription + auto answer](docs/demo.gif)

*Real capture, no mockup: the interviewer's voice is transcribed while they are still speaking (left, live gray subtitle), and a read-aloud answer grounded in your resume streams in automatically (right).*

### 🎬 3-minute real-world walkthrough

[![Watch the demo video](docs/video-poster.jpg)](docs/MeetingCopilot-demo.mp4)

*Click to watch (with sound): using an English podcast and a Chinese vlog as the "other side" — live transcription of both languages, inline translation, auto answers in Chinese and English, 0.94 s end-to-end latency on screen.*

## Features

- 🎧 **Hears the other side directly — no meeting bot.** Captures Windows system loopback audio, so it works with any meeting app (Zoom / Teams / VoOV / …) without joining the call. Optional independent microphone channel transcribes your own voice separately.
- ⚡ **Streaming ASR with 4 switchable backends** — local FunASR streaming (default: free, private; the Python sidecar is auto-spawned and reaped by the app), local Whisper turbo (offline fallback, DirectML GPU), Alibaba Cloud `fun-asr-realtime` (word-by-word cloud streaming), MiMo per-segment. Live gray partial subtitles appear while speech is still in progress.
- 🌍 **Bilingual (zh / en) out of the box** — the ASR detects Chinese↔English switches automatically mid-meeting, with no settings to touch; one click on the answer-language toggle and the teleprompter output flips to English too. Built for English interviews and code-switching conversations.
- 🧠 **First-person teleprompter answers** — bring your own key, any OpenAI-compatible LLM (DeepSeek recommended). Answers are written to be read aloud verbatim: conclusion first, then 2-3 short points; STAR for behavioral questions; idea → key points → complexity for technical ones. Never invents experience beyond your resume.
- 📄 **Per-session resume + JD slots** — import `.md/.txt/.docx/.pdf`; parsing is local and deterministic, nothing gets uploaded. Question-type detection (behavioral / technical / smalltalk) appends a zero-latency answering hint.
- 🔁 **Rolling interview memo** — a structured summary (questions asked / facts you claimed / interviewer focus) updates asynchronously after each answer, so a 60-minute interview stays self-consistent while per-request tokens stay flat.
- 🚀 **Prefix-cache prewarm** — pressing ▶ fires a 1-token request that pre-builds the LLM provider's KV prefix cache, so the first real answer prefills from cache (verified via DeepSeek `prompt_cache_hit_tokens`); kept warm automatically during capture.
- 🖼️ **Region-screenshot Q&A** — drag-select any screen region (the selection overlay itself is invisible to recording) and ask a vision model (MiMo / Gemini) about it.
- 🥷 **Stealth** — content protection makes the window invisible in OBS, screen shares and screenshots; a global hotkey hides/shows it instantly.
- 🌗 **Dark / light / follow-system themes**, 3-step answer font size, latency HUD, inline translation, multi-session with fully isolated transcript + chat + material per meeting.

| Dark | Light |
|---|---|
| ![dark theme](docs/main-dark.png) | ![light theme](docs/main-light.png) |

### Bilingual in one session

![Bilingual demo: automatic zh/en switching](docs/demo-bilingual.gif)

*A Chinese question, then an English one — same session, nothing reconfigured. The local ASR picks up the language switch automatically (both at ~1.6 s), and after one click on `答:EN` the answer streams out in English, still grounded in the same resume.*

![bilingual answer](docs/bilingual.png)

## Requirements

| Component | Requirement |
|---|---|
| OS | Windows 10 / 11 |
| Runtime | Node.js ≥ 20 and npm |
| LLM | Any OpenAI-compatible API key — DeepSeek recommended (fast, cheap, prefix caching) |
| Local streaming ASR *(default)* | Python 3.10 conda env with `funasr` + `torch`; NVIDIA GPU recommended |
| Local Whisper *(offline fallback)* | `whisper-large-v3-turbo` ONNX weights, DirectML-capable GPU |
| Cloud ASR *(optional)* | Alibaba Cloud DashScope API key, or a MiMo key |

## Quick Start

```bash
git clone https://github.com/JWM0203/MeetingCopilot.git
cd MeetingCopilot
npm install        # postinstall applies patches/ (transformers.js patch — do not remove)
npm run build      # builds main + preload + renderer into out/
start.bat          # or: npx electron .
```

First run:

1. Open **⚙ Settings** → pick the *DeepSeek* preset → paste your API key → save.
2. Pick an ASR backend (see below). The default *local streaming FunASR* needs a one-time Python env; cloud backends only need a key.
3. Press **▶** — everything the other side says appears on the left. Click **⚡答** on any bubble, or enable **持续答** so questions are answered automatically.
4. Import your resume / JD via **📄 / 📋** so answers are grounded in your real experience.

> 🇨🇳 If npm / Electron downloads are slow in China, create a `.npmrc` containing
> `registry=https://registry.npmmirror.com` and
> `electron_mirror=https://npmmirror.com/mirrors/electron/`.

## ASR Backends

| Backend | Latency | Cost | Privacy | Notes |
|---|---|---|---|---|
| **Local FunASR streaming** *(default)* | ~1.2–1.8 s | free | ✅ fully local | `Fun-ASR-Nano` (zh+en, punctuation) or `paraformer` true streaming (zh-only, snappier subtitles) |
| Local Whisper turbo | ~2 s | free | ✅ fully local | offline fallback; DirectML GPU encoder |
| Aliyun `fun-asr-realtime` | best | pay-per-use | cloud | word-by-word streaming, server-side punctuation |
| MiMo per-segment | ~1 s/seg | pay-per-use | cloud | simple per-utterance cloud ASR |

### Local streaming FunASR (default)

```bash
conda create -n funasr python=3.10 -y
conda activate funasr
# pick the torch build matching your GPU (cu128 shown for RTX 50-series):
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install funasr modelscope websockets numpy
```

That's it — the app **auto-spawns and reaps** the sidecar (`tools/funasr_stream_server.py`, `ws://127.0.0.1:10097`). Models download automatically from ModelScope on first run (~1–2 GB). If your Python lives elsewhere, set the env var `MC_FUNASR_PYTHON` to its full path.

### Local Whisper turbo

Place [`onnx-community/whisper-large-v3-turbo-ONNX`](https://huggingface.co/onnx-community/whisper-large-v3-turbo-ONNX) under `%APPDATA%/MeetingCopilot/models/onnx-community/whisper-large-v3-turbo-ONNX/` (`encoder_model_fp16.onnx`, `decoder_model_merged_quantized.onnx`, plus config/tokenizer files).

### Cloud

- **Aliyun DashScope**: endpoint `wss://dashscope.aliyuncs.com/api-ws/v1/inference`, model `fun-asr-realtime` or `paraformer-realtime-v2`.
- **MiMo**: `https://api.xiaomimimo.com/v1`, model `mimo-v2.5-asr`.

![settings panel](docs/settings.png)

## Development

```bash
npm test            # unit tests (prompt building / VAD / stores / doc parsing / ASR protocol)
npm run typecheck   # dual tsconfig (main + renderer)
npm run dev         # vite HMR dev mode
node tools/rt-asr-smoke.mjs   # streaming-ASR protocol smoke (set MC_RT_URL / MC_RT_KEY)
```

Architecture in one line: Electron main process (window / stealth / IPC / LLM routing / ASR host) → ASR engines inside a **utilityProcess** (never the main process — DirectML inference wedges there) → React renderer (transcript pane + answer session pane); all state lives in plain JSON files, never DOM storage.

## Privacy

- API keys are encrypted at rest with Windows DPAPI (`safeStorage`) and never reach the renderer process.
- All data (settings / sessions / materials) lives in local JSON files under `%APPDATA%/MeetingCopilot/`. No telemetry, no accounts, no server.
- With the local ASR backends, audio never leaves your machine; with BYOK LLMs, transcripts go only to the provider you configured.

## Disclaimer

This tool is intended for personal learning and assistive use. Whether and how real-time assistance may be used in meetings or interviews depends on your local laws and the policies of the other party — you are solely responsible for how you use this software.

## License

**Apache License 2.0 with Commons Clause** — free to use, modify and redistribute for **non-commercial** purposes; selling the software, or services whose value derives substantially from it, is not permitted. See [LICENSE](LICENSE).
