# Quick start (packaged users)

For people who downloaded an installer. No Node.js, no Python, no commands.

中文版：[QUICK_START.zh-CN.md](QUICK_START.zh-CN.md)

---

## What you need

| Item | Notes |
|---|---|
| OS | Windows 10 / 11 (64-bit). There is no macOS installer yet — see [INSTALL_MACOS.en.md](INSTALL_MACOS.en.md) |
| Network | Enough to reach the providers you choose |
| API keys | One for speech recognition, one for AI answers (a single provider can cover both). You create them; the provider bills you |
| Time | About 5 minutes the first time, mostly signing up and copying keys |

MeetingCopilot is **bring-your-own-key**: no accounts, no server, no fee collected by this app. If "API key" means nothing to you yet, read [API_KEYS.en.md](API_KEYS.en.md) first.

---

## Step 1 — download and install

1. Open the [Releases page](https://github.com/JWM0203/MeetingCopilot/releases/latest).
2. Download `MeetingCopilot-<version>-win-x64.exe` (installer) or `...-win-x64-portable.exe` (portable). The difference and the install locations are in [INSTALL_WINDOWS.en.md](INSTALL_WINDOWS.en.md).
3. This beta is not code-signed, so Windows SmartScreen shows "Windows protected your PC". Once you have confirmed the file came from the official release page above, click **More info → Run anyway**.
4. Verify the download first if you can: every `.exe` ships with a matching `.exe.sha256` file containing the hash CI computed at build time.

---

## Step 2 — follow the setup wizard (5 steps)

The wizard opens by itself on first launch. It is a normal, taskbar-visible window that screen sharing can see (so someone can walk you through it remotely); the main overlay stays closed until it finishes.

### 1️⃣ Welcome

Explains bring-your-own-key, what an API key is, and where your data goes:

- keys are encrypted and stored on this machine;
- with cloud speech recognition, meeting audio goes to the ASR provider you chose;
- with a cloud LLM, the transcript and the material you import go to the LLM provider you chose;
- with local speech recognition, audio never leaves the machine.

The toggle in the top-right switches **中文 / English**, and that choice becomes the app's UI language.

### 2️⃣ Pick a plan

| Plan | Combination | Keys needed | Good for |
|---|---|---|---|
| **Low latency (recommended)** | Alibaba Cloud realtime ASR + DeepSeek answers | 2 | The snappiest captions, mixed Chinese/English meetings |
| **Minimal setup** | MiMo ASR + MiMo answers | 1 (one key can serve both) | Signing up with a single platform. Captions arrive per sentence, so they trail a little (Beta) |
| **Transcription only** | Alibaba Cloud realtime ASR | 1 | You do not want AI answers yet |
| **Advanced / local** | Changes nothing, goes straight to the app | 0 | You plan to use local FunASR / MOSS / Whisper or a custom provider |

"Advanced / local" ends the wizard immediately; configure everything from Settings afterwards.

### 3️⃣ Configure the services

One card per service, each with the provider tutorial inline:

1. click "Open the official key page", create a key on the provider site and copy it;
2. come back and paste it (there is a "Paste from clipboard" button);
3. click "Save and test connection".

Saving strips surrounding whitespace, wrapping quotes and a `Bearer ` prefix automatically. The connection test sends one **tiny** real request (1 token / ~1.4 s of audio / a 64×64 image), so the provider may charge a very small amount. Tests only ever run when you click — nothing is called in the background.

On failure the card shows an error code and the single next action worth taking, plus a "Save and retry later" escape hatch.

### 4️⃣ Connection test

- **Computer audio**: play anything with sound, click "Start test" and watch the level meter move. If it stays flat, the card lists what to check.
- **Microphone (optional)**: transcribes your own voice on a separate channel. Use headphones so the speakers do not echo back.
- **Checklist**: which keys are saved, whether audio works, and the latest connection-test verdicts. Anything still "Not saved" or "No sound" blocks "Next"; merely untested does not.

### 5️⃣ Done

Review the summary and click "Enter MeetingCopilot". The wizard writes the whole plan as a **single** settings update and closes; the main window opens.

> You can reopen the wizard at any time: **⚙ Settings → Run the setup wizard again**. The main window keeps running while it is open.

---

## Step 3 — your first meeting

1. Play something with speech in it (a meeting, a video, a podcast).
2. Click **▶ Start** in the title bar; the Transcript pane on the left starts filling.
3. Click **⚡Ans** on one of their lines and the right pane streams an answer written to be read aloud.
4. Turn on **Auto** in the title bar to let the AI answer by itself — only question-like sentences trigger it.
5. For answers grounded in your experience, import material with **📄Resume** / **📋JD** (`.md/.txt/.docx/.pdf`). Parsing is local; the text is only sent to the LLM you configured, and only as context for a question you asked.

Other title-bar controls:

| Button | What it does |
|---|---|
| `A:ZH` / `A:EN` | Language the AI answers in |
| `Text` / `Vision` | Answer with the text LLM, or with the vision model (screenshot Q&A) |
| `🎤Mic` | Transcribe your own voice separately |
| `Stealth:On/Off` | Hides the window from recording / sharing / screenshots (Windows; best-effort on macOS) |
| `—` | Hide the window; the hotkey or the tray icon brings it back |

---

## Lost the window?

The main window deliberately stays out of the taskbar, so after hiding it there are two ways back:

- press the show/hide hotkey (`Control+B` by default, changeable in Settings);
- click the MeetingCopilot icon in the system tray, or pick "Show window" from its menu.

The tray menu also has Start/Stop transcription, New session, Settings, Service status, Help & guides, Check for updates and Quit. The first time the window is hidden you get one balloon reminder, and never again.

---

## When something goes wrong

1. Open **Help & guides** in the app (tray menu, or Settings → Help & guides). It works offline.
2. Read [TROUBLESHOOTING.en.md](TROUBLESHOOTING.en.md) for the full error-code table.
3. Still stuck: Settings → Advanced → Diagnostics, copy the report (it has no keys, resume text or transcripts) and open an issue at [GitHub Issues](https://github.com/JWM0203/MeetingCopilot/issues).
