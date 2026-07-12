# macOS Setup Guide

[简体中文](SETUP.zh-CN.md) · [Windows guide](../windows/SETUP.md)

The macOS port keeps the whole pipeline — streaming ASR, teleprompter answers,
resume/JD grounding — but two platform realities differ from Windows:

1. **No system loopback capture.** Electron's `audio: 'loopback'` source is
   Windows-only, so on macOS the other-party channel records from a selectable
   **audio input device**. To hear a meeting app you route system audio through
   a virtual device such as BlackHole (below).
2. **Stealth is best-effort.** Recent ScreenCaptureKit clients may still
   capture the window; full invisibility is not guaranteed on macOS.

Engineering details live in the [port SDD](macos-port-sdd.md).

## Requirements

| Component | Requirement |
|---|---|
| OS | Apple-silicon macOS 14+ |
| Runtime | Node.js ≥ 20 and npm |
| LLM | Any OpenAI-compatible API key — DeepSeek recommended |
| Local streaming ASR *(default)* | Python 3.10/3.11 in a project `.venv`; Apple MPS with CPU fallback |
| System-audio capture | [BlackHole](https://github.com/ExistentialAudio/BlackHole) (or a similar virtual audio device) |
| Cloud ASR *(optional)* | Alibaba Cloud DashScope API key, or a MiMo key |

## Install & run

```bash
git clone https://github.com/JWM0203/MeetingCopilot.git
cd MeetingCopilot
npm install        # postinstall applies patches/ (transformers.js patch — do not remove)
npm run build
npm start
```

## Audio: route the meeting into MeetingCopilot

To capture a meeting app (Zoom / Teams / …) instead of your built-in mic:

1. **Install BlackHole** (2-channel build is enough):
   ```bash
   brew install blackhole-2ch
   ```
2. **Create a Multi-Output Device** so you still *hear* the meeting:
   open **Audio MIDI Setup** → `+` → *Create Multi-Output Device* → check both
   your speakers/headphones **and** BlackHole 2ch.
3. **Send system output to it**: System Settings → Sound → Output → select the
   Multi-Output Device. Sound now plays through your speakers *and* mirrors
   into BlackHole.
4. **Pick BlackHole in MeetingCopilot**: press **▶ Start** (grant microphone
   permission on first use), then choose *BlackHole 2ch* in the input selector
   next to the button.

Echo cancellation / noise suppression / auto gain are disabled on this channel
so the virtual device's PCM arrives untouched; the separate **🎤** channel keeps
normal microphone processing for your own voice.

## Local streaming FunASR (default ASR backend)

Validated project-local setup on Apple silicon:

```bash
# from the repo root
python3.11 -m venv .venv
.venv/bin/pip install -r requirements-funasr.txt
npm start
```

The app discovers `.venv` automatically (resolution order: `MC_FUNASR_PYTHON`
env var → project `.venv/bin/python` → `python3` → `python`). `--device auto`
tries CUDA, then Apple MPS, then CPU; accelerator initialization failures retry
on CPU automatically. Only the selected FunASR model is loaded to keep memory
bounded on 8 GB machines — switching models restarts the sidecar (60–90 s).
The selected model downloads from ModelScope on first run (~880 MB for
paraformer, ~1.7 GB for Nano).

## Stealth limits

The `Stealth` toggle still applies Electron content protection, and legacy
capture APIs respect it. However, apps built on modern **ScreenCaptureKit**
may capture the window anyway — treat stealth as best-effort on macOS. The
global hotkeys default to **Command+B** (hide/show) and **Command+Shift+S**
(region-screenshot Q&A).

## Data locations

- Settings / sessions / materials: `~/Library/Application Support/MeetingCopilot/` (plain JSON)
- API keys: encrypted at rest via the macOS Keychain (`safeStorage`)
