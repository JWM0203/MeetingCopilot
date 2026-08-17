<div align="center">

# MeetingCopilot

**Real-time meeting & interview copilot for Windows and macOS**

Live transcription of the other side · first-person teleprompter answers · capture protection

<a href="https://github.com/JWM0203/MeetingCopilot/stargazers"><img src="https://img.shields.io/github/stars/JWM0203/MeetingCopilot?style=flat-square&logo=github&color=2a6df4" alt="GitHub stars"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-3da639?style=flat-square" alt="license"></a>
<a href="https://github.com/JWM0203/MeetingCopilot"><img src="https://img.shields.io/badge/GitHub-repo-181717?style=flat-square&logo=github" alt="GitHub repo"></a>
<a href="https://gitee.com/jwm0302/MeetingCopilot"><img src="https://img.shields.io/badge/Gitee-China%20mirror-C71D23?style=flat-square&logo=gitee" alt="Gitee mirror"></a>
<a href="https://www.xiaohongshu.com/discovery/item/6a50df530000000007020f79?source=webshare&xhsshare=pc_web&xsec_token=ABbqtJXWoEQSYl-hNrBxJbXeGEZWoH6YjnAYj97pjKEpo=&xsec_source=pc_share"><img src="https://img.shields.io/badge/小红书-视频效果-ff2442?style=flat-square&logo=xiaohongshu&logoColor=white" alt="小红书视频效果"></a>
<a href="https://www.xiaohongshu.com/discovery/item/6a50ddc800000000080027a6?source=webshare&xhsshare=pc_web&xsec_token=YBsteWYkixo34xXwfYeNXKL1SFbiOeg7mxQAZyq7wQIc4=&xsec_source=pc_share"><img src="https://img.shields.io/badge/小红书-开源推文-ff2442?style=flat-square&logo=xiaohongshu&logoColor=white" alt="小红书开源推文"></a>

[简体中文](README.zh-CN.md) · [Download](#download) · [5-minute setup](#5-minute-setup) · [Features](#features) · [ASR Backends](#asr-backends) · [Development](#development) · [License](#license)

</div>

## Download

**Just want to use it?** Download the installer — no Node.js, no Python, no commands.
**Want to hack on it?** Skip to [Development](#development) and run from source.

**[⬇ Get the latest release](https://github.com/JWM0203/MeetingCopilot/releases/latest)**

| File | Type | Best for |
|---|---|---|
| `MeetingCopilot-<version>-win-x64.exe` | Installer (NSIS, per-user) | Normal use — Start-menu and desktop shortcuts, upgrades in place |
| `MeetingCopilot-<version>-win-x64-portable.exe` | Portable | Not installing anything; note that settings still live in `%APPDATA%` |

**Requirements:** Windows 10 / 11 (x64), no administrator rights, plus your own API key(s) — MeetingCopilot is bring-your-own-key and collects no fee.

> ⚠️ **This beta is not code-signed yet**, so Windows SmartScreen will warn you. Confirm the file came from the official release page, then *More info → Run anyway*. Each `.exe` ships a matching `.exe.sha256` with the hash CI computed — verify it with `Get-FileHash .\MeetingCopilot-<version>-win-x64.exe -Algorithm SHA256`.

> 🍎 **macOS:** no packaged build in this release. macOS is supported when run from source — see [INSTALL_MACOS.en.md](docs/user/INSTALL_MACOS.en.md).

**User guides:** [Quick start](docs/user/QUICK_START.en.md) · [API keys](docs/user/API_KEYS.en.md) · [Troubleshooting](docs/user/TROUBLESHOOTING.en.md) · [Windows install & data locations](docs/user/INSTALL_WINDOWS.en.md)

---

![Live demo: real-time transcription + auto answer](docs/demo.gif)

*Real capture, no mockup: the interviewer's voice is transcribed while they are still speaking (left, live gray subtitle), and a read-aloud answer grounded in your resume streams in automatically (right).*

### 🎬 3-minute real-world walkthrough

[![Watch the demo video](docs/video-poster.jpg)](docs/MeetingCopilot-demo.mp4)

*Click to watch (with sound): using an English podcast and a Chinese vlog as the "other side" — live transcription of both languages, inline translation, auto answers in Chinese and English, 0.94 s end-to-end latency on screen.*

## 5-minute setup

The first launch opens a setup wizard — a normal, screen-shareable window, so someone can walk you through it remotely. Five steps:

1. **Welcome** — what bring-your-own-key means, what an API key is, and exactly what leaves your machine. Pick 中文 / English here; that becomes the app's language.
2. **Plan** — *Low latency* (Alibaba Cloud realtime ASR + DeepSeek answers, 2 keys), *Minimal* (MiMo for both, 1 key, Beta), *Transcription only* (1 key), or *Advanced / local* (change nothing, configure it yourself).
3. **Services** — the provider tutorial is inline: open the key page, paste, "Save and test connection". Keys are encrypted with the OS credential store before they touch disk.
4. **Connection test** — a live level meter proves the app can hear your computer, plus the optional microphone channel and a checklist of what is still missing.
5. **Done** — the whole plan is written as one settings update and the main window opens.

![Setup wizard, step 2: choosing a plan](docs/setup-wizard-en.png)

*Step 2 "Plan": each card states plainly how many platforms you have to sign up for and how many keys it needs; "Low latency" is preselected. Local backends stay out of the way behind the "Advanced setup and local modes" link.*

![Setup wizard, step 3: pasting the API keys](docs/setup-keys-en.png)

*Step 3 "Services": one card per service, with the official key page, the official docs and a step-by-step guide right inside it — no hunting through a browser. Paste, press "Save and test connection", and the key is encrypted by the OS credential store before it touches disk.*

Then: play some speech, hit **▶ Start**, click **⚡Ans** on any line. Full walkthrough in [QUICK_START.en.md](docs/user/QUICK_START.en.md).

You can reopen the wizard any time from *⚙ Settings → Run the setup wizard again*, and the in-app **Help & guides** (tray menu or Settings) has the same content offline.

![settings panel, English UI](docs/settings-en.png)

## Features

- 🎧 **Hears the other side directly — no meeting bot.** Windows captures system loopback audio. macOS uses a selectable audio input (choose a virtual device such as BlackHole for meeting/system audio). An independent microphone channel transcribes your own voice separately.
- ⚡ **Four switchable ASR backend families** — local sidecars (FunASR by default; experimental MOSS-Transcribe 0.9B), local Whisper turbo (offline fallback, DirectML GPU), Alibaba Cloud `fun-asr-realtime`, and MiMo per-segment. FunASR provides live partials; MOSS emits a finalized utterance after a pause.
- 🌍 **Bilingual (zh / en) out of the box** — the ASR detects Chinese↔English switches automatically mid-meeting, with no settings to touch; one click on the answer-language toggle (`A:EN`) and the teleprompter output flips to English too. Built for English interviews and code-switching conversations.
- 🌐 **Fully English or Chinese interface** — every label, tooltip, dialog and status message is available in both languages. Switch under *Settings → Appearance → UI Language*; first launch follows your OS language automatically. UI language and answer language are independent, so you can run an English UI while reading Chinese answers, or vice versa.
- 🧠 **First-person teleprompter answers** — bring your own key, any OpenAI-compatible LLM (DeepSeek recommended). Answers are written to be read aloud verbatim: conclusion first, then 2-3 short points; STAR for behavioral questions; idea → key points → complexity for technical ones. Never invents experience beyond your resume.
- 📄 **Per-session resume + JD slots** — import `.md/.txt/.docx/.pdf`; parsing is local and deterministic, nothing gets uploaded. Question-type detection (behavioral / technical / smalltalk) appends a zero-latency answering hint.
- 🔁 **Rolling interview memo** — a structured summary (questions asked / facts you claimed / interviewer focus) updates asynchronously after each answer, so a 60-minute interview stays self-consistent while per-request tokens stay flat.
- 🚀 **Prefix-cache prewarm** — pressing ▶ fires a 1-token request that pre-builds the LLM provider's KV prefix cache, so the first real answer prefills from cache (verified via DeepSeek `prompt_cache_hit_tokens`); kept warm automatically during capture.
- 🖼️ **Region-screenshot Q&A** — drag-select any screen region (the selection overlay itself is invisible to recording) and ask a vision model (MiMo / Gemini) about it.
- 🥷 **Capture protection** — content protection plus a global hide/show hotkey. Windows excludes the window from supported captures; macOS cannot guarantee invisibility against modern ScreenCaptureKit clients.
- 🩺 **Connection tests, service status and local diagnostics** — one click tells you whether a key, the network or the account is at fault (14 normalized error codes), and the diagnostics report is built locally with no keys, transcripts or resume text in it.
- 🔔 **System tray** — show/hide, start/stop transcription, new session, settings, service status, help and quit, all without a taskbar button. Optional start-at-login, off by default.
- 🌗 **Dark / light / follow-system themes**, 3-step answer font size, latency HUD, inline translation, multi-session with fully isolated transcript + chat + material per meeting.

| Dark | Light |
|---|---|
| ![dark theme, English UI](docs/main-dark-en.png) | ![light theme, English UI](docs/main-light-en.png) |

### One click between the English and Chinese UI

![Switching the UI language from Chinese to English](docs/language-switch.gif)

*Settings → Appearance → UI Language: the whole interface — title bar, panels, tooltips, dialogs — flips instantly. The screenshots above show the English UI; the Chinese one is in [README.zh-CN.md](README.zh-CN.md).*

### Bilingual in one session

![Bilingual demo: automatic zh/en switching](docs/demo-bilingual.gif)

*A Chinese question, then an English one — same session, nothing reconfigured. The local ASR picks up the language switch automatically (both at ~1.6 s), and after one click on `答:EN` the answer streams out in English, still grounded in the same resume.*

![bilingual answer](docs/bilingual.png)

## ASR Backends

| Backend | Latency | Cost | Privacy | Notes |
|---|---|---|---|---|
| Aliyun `fun-asr-realtime` *(recommended for packaged users)* | best | pay-per-use | cloud | word-by-word streaming, server-side punctuation, nothing to install |
| MiMo per-segment | ~1 s/seg | pay-per-use | cloud | simple per-utterance cloud ASR; one key can also serve the answers |
| **Local FunASR streaming** *(default when running from source)* | ~1.2–1.8 s | free | ✅ fully local | `Fun-ASR-Nano` (zh+en, punctuation) or `paraformer` true streaming (zh-only, snappier subtitles) |
| MOSS-Transcribe-Diarize 0.9B *(experimental)* | finalized after a pause | free | ✅ fully local | 50+ languages, hotwords, long-form diarization; live mode consumes transcript text only |
| Local Whisper turbo | ~2 s on supported Windows GPUs | free | ✅ fully local | DirectML on Windows; CPU fallback elsewhere |

**Which one should you pick?** If you installed the packaged build, use a **cloud** backend: it needs one API key and nothing else. The **local** backends are an advanced option — free and fully private, but you have to bring your own Python environment and let the model weights download, and the installer ships neither.

## Local ASR & advanced setup

### Requirements per backend

| Component | Requirement |
|---|---|
| OS | Windows 10 / 11, or Apple-silicon macOS 14+ |
| Cloud ASR *(recommended)* | Alibaba Cloud DashScope API key, or a MiMo key |
| LLM | Any OpenAI-compatible API key — DeepSeek recommended (fast, cheap, prefix caching) |
| Local streaming ASR | Python 3.10/3.11 with `funasr` + `torch`; CUDA, Apple MPS, or CPU fallback |
| Experimental MOSS ASR | isolated Python 3.12 env; NVIDIA CUDA BF16 first, automatic CPU fallback |
| Local Whisper *(offline fallback)* | `whisper-large-v3-turbo` ONNX weights; DirectML on Windows, CPU elsewhere |
| Running from source | Node.js ≥ 20 and npm |

Audio capture, Python setup, stealth behavior and hotkeys differ per platform — each OS has its own guide:

| Platform | Audio capture | Stealth | Guide |
|---|---|---|---|
| 🪟 **Windows 10 / 11** | system loopback — zero config | window excluded from captures | **[docs/windows/SETUP.md](docs/windows/SETUP.md)** |
| 🍎 **macOS 14+ (Apple silicon)** | input device + [BlackHole](https://github.com/ExistentialAudio/BlackHole) routing | best-effort (ScreenCaptureKit may capture) | **[docs/macos/SETUP.md](docs/macos/SETUP.md)** |

### Local streaming FunASR

One-time Python environment, then the app **auto-spawns and reaps** the sidecar
(`tools/funasr_stream_server.py`, `ws://127.0.0.1:10097`) — selecting the preset
in Settings is all you do. The selected model downloads automatically from
ModelScope on first run (~880 MB for paraformer, ~1.7 GB for Nano). `--device
auto` picks CUDA / Apple MPS / CPU with automatic CPU fallback.

- **Windows** (conda env, NVIDIA GPU): see [docs/windows/SETUP.md](docs/windows/SETUP.md#local-streaming-funasr-default-asr-backend)
- **macOS** (project `.venv`, Apple MPS): see [docs/macos/SETUP.md](docs/macos/SETUP.md#local-streaming-funasr-default-asr-backend)

If your Python lives elsewhere, set `MC_FUNASR_PYTHON` to its full path.

### MOSS-Transcribe-Diarize 0.9B (experimental)

MOSS is a one-shot generative model, not native streaming ASR. MeetingCopilot invokes the isolated `tools/moss_asr_server.py` sidecar after an utterance ends instead of repeatedly decoding a growing buffer. CUDA BF16 is attempted first and initialization failures fall back to CPU; the existing FunASR environment and default remain unchanged.

- **Windows:** see [docs/windows/SETUP.md](docs/windows/SETUP.md#experimental-moss-transcribe-diarize-09b)
- Custom interpreter: set `MC_MOSS_PYTHON`; force a device with `MC_MOSS_DEVICE=cuda:0` or `cpu`.

### Local Whisper turbo

Place [`onnx-community/whisper-large-v3-turbo-ONNX`](https://huggingface.co/onnx-community/whisper-large-v3-turbo-ONNX) under `<userData>/models/onnx-community/whisper-large-v3-turbo-ONNX/` — `%APPDATA%/MeetingCopilot/` on Windows, `~/Library/Application Support/MeetingCopilot/` on macOS (`encoder_model_fp16.onnx`, `decoder_model_merged_quantized.onnx`, plus config/tokenizer files). The encoder uses DirectML on Windows and CPU elsewhere.

### Cloud endpoints

- **Aliyun DashScope**: endpoint `wss://dashscope.aliyuncs.com/api-ws/v1/inference`, model `fun-asr-realtime` or `paraformer-realtime-v2`.
- **MiMo**: `https://api.xiaomimimo.com/v1`, model `mimo-v2.5-asr`.

## Privacy

- API keys are encrypted at rest with Electron `safeStorage` (Windows DPAPI / macOS Keychain) and never reach the renderer process.
- All data (settings / sessions / materials) lives under Electron's per-user `userData` directory (`%APPDATA%/MeetingCopilot/` on Windows and `~/Library/Application Support/MeetingCopilot/` on macOS). No telemetry, no accounts, no server.
- With the local ASR backends, audio never leaves your machine; with BYOK LLMs, transcripts go only to the provider you configured.
- The diagnostics report is built locally and contains no keys, transcripts or resume text — it is safe to paste into a public issue.

## Development

```bash
git clone https://github.com/JWM0203/MeetingCopilot.git
cd MeetingCopilot
npm install        # postinstall applies patches/ (transformers.js patch — do not remove)
npm run build      # builds main + preload + renderer into out/
npm start          # cross-platform; Windows can also use start.bat
```

Running from source starts the same first-run wizard as the packaged build. Set `MC_DEV_DEFAULT_LOCAL_ASR=1` to skip it and go straight to the overlay with the local FunASR defaults.

```bash
npm test            # unit tests (prompt building / VAD / stores / doc parsing / ASR protocol / tray / links)
npm run typecheck   # dual tsconfig (main + renderer)
npm run dev         # vite HMR dev mode
npm run verify      # typecheck + tests + build, the pre-commit gate
npm run dist:dir    # unpacked build into release/win-unpacked
npm run dist:win    # nsis + portable installers
npm run smoke:packaged        # boots the packaged exe and asserts both startup paths
node tools/rt-asr-smoke.mjs   # streaming-ASR protocol smoke (set MC_RT_URL / MC_RT_KEY)
```

Platform setup for developers (python envs, audio routing, stealth): [docs/windows/SETUP.md](docs/windows/SETUP.md) · [docs/macos/SETUP.md](docs/macos/SETUP.md).

> 🇨🇳 If npm / Electron downloads are slow in China, create a `.npmrc` containing
> `registry=https://registry.npmmirror.com` and
> `electron_mirror=https://npmmirror.com/mirrors/electron/`.

Architecture in one line: Electron main process (window / stealth / tray / IPC / LLM routing / ASR host) → ASR engines inside a **utilityProcess** (never the main process — DirectML inference wedges there) → React renderer (transcript pane + answer session pane); all state lives in plain JSON files, never DOM storage.

## Disclaimer

This tool is intended for personal learning and assistive use. Whether and how real-time assistance may be used in meetings or interviews depends on your local laws and the policies of the other party — you are solely responsible for how you use this software.

## License

**[Apache License 2.0](LICENSE)** — free to use, modify and redistribute, including commercially, under the terms of the license.
