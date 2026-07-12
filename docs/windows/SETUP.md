# Windows Setup Guide

[简体中文](SETUP.zh-CN.md) · [macOS guide](../macos/SETUP.md)

MeetingCopilot was born on Windows: it captures the other side through **system
loopback audio** (no meeting bot, works with any meeting app) and can hide its
window from screen shares via content protection.

## Requirements

| Component | Requirement |
|---|---|
| OS | Windows 10 / 11 |
| Runtime | Node.js ≥ 20 and npm |
| LLM | Any OpenAI-compatible API key — DeepSeek recommended |
| Local streaming ASR *(default)* | Python 3.10 conda env with `funasr` + `torch`; NVIDIA GPU recommended |
| Local Whisper *(offline fallback)* | `whisper-large-v3-turbo` ONNX weights, DirectML-capable GPU |
| Cloud ASR *(optional)* | Alibaba Cloud DashScope API key, or a MiMo key |

## Install & run

```bash
git clone https://github.com/JWM0203/MeetingCopilot.git
cd MeetingCopilot
npm install        # postinstall applies patches/ (transformers.js patch — do not remove)
npm run build
start.bat          # or: npm start
```

> 🇨🇳 If npm / Electron downloads are slow in China, create a `.npmrc` containing
> `registry=https://registry.npmmirror.com` and
> `electron_mirror=https://npmmirror.com/mirrors/electron/`.

## Audio capture

Nothing to configure. Pressing **▶ Start** captures whole-system loopback audio
(the other party) through Electron's display-media handler; the independent
**🎤** button transcribes your own microphone on a separate channel.

## Local streaming FunASR (default ASR backend)

```bash
conda create -n funasr python=3.10 -y
conda activate funasr
# pick the torch build matching your GPU (cu128 shown for RTX 50-series):
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install funasr modelscope websockets numpy
```

The app **auto-spawns and reaps** the sidecar (`tools/funasr_stream_server.py`,
`ws://127.0.0.1:10097`) — selecting the preset in Settings is all you do. The
selected model downloads automatically from ModelScope on first run (~880 MB
for paraformer, ~1.7 GB for Nano). Resolution order for the Python interpreter:
`MC_FUNASR_PYTHON` env var → project `.venv\Scripts\python.exe` →
`C:\ProgramData\miniconda3\envs\funasr\python.exe` → `python` on PATH.

## Local Whisper turbo (offline fallback)

Place [`onnx-community/whisper-large-v3-turbo-ONNX`](https://huggingface.co/onnx-community/whisper-large-v3-turbo-ONNX)
under `%APPDATA%/MeetingCopilot/models/onnx-community/whisper-large-v3-turbo-ONNX/`
(`encoder_model_fp16.onnx`, `decoder_model_merged_quantized.onnx`, plus
config/tokenizer files). The encoder runs on the GPU via DirectML.

## Stealth

Content protection (`Stealth` toggle in the title bar, on by default) excludes
the window from OBS, screen shares and screenshots on Windows. The global
hotkeys default to **Control+B** (hide/show) and **Control+Shift+S**
(region-screenshot Q&A).

## Data locations

- Settings / sessions / materials: `%APPDATA%/MeetingCopilot/` (plain JSON)
- API keys: encrypted at rest with Windows DPAPI (`safeStorage`)
