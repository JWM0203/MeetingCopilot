# Installing on macOS

> **Status: no packaged macOS build yet.** The `v0.2.0-beta.1` release ships Windows installers only. macOS is supported when run from source, and a signed/notarised `.dmg` is planned for a later release. Until then, follow the "Run from source" section below.

The app itself is macOS-aware: the wizard, the tray, cloud transcription, AI answers and the vision path all work. What is missing is packaging, not functionality.

---

## Requirements

| Item | Requirement |
|---|---|
| OS | macOS 14+ (Apple silicon) |
| Runtime | Node.js ≥ 20 and npm (only because you are building it yourself) |
| Audio | A virtual audio device such as [BlackHole](https://github.com/ExistentialAudio/BlackHole) — macOS has no system loopback capture |
| API keys | Same as Windows; see [API_KEYS.en.md](API_KEYS.en.md) |

## Run from source

```bash
git clone https://github.com/JWM0203/MeetingCopilot.git
cd MeetingCopilot
npm install        # postinstall applies patches/ — do not remove it
npm run build
npm start
```

The first launch opens the same setup wizard as the Windows build; walk through it with [QUICK_START.en.md](QUICK_START.en.md).

## Audio routing (the part that is genuinely different)

Windows can capture system loopback audio with no configuration. macOS cannot, so the other party's voice has to be routed into an ordinary input device:

1. Install [BlackHole](https://github.com/ExistentialAudio/BlackHole) (2ch is enough).
2. In *Audio MIDI Setup*, create a Multi-Output Device containing both your headphones and BlackHole, so you can still hear the meeting.
3. Set that Multi-Output Device as the system output, or as the meeting app's output.
4. In MeetingCopilot, set **Settings → other-party audio input** to BlackHole (the setup wizard asks for this on step 4 when it detects macOS).
5. Press "▶ Start" and confirm text appears.

Full detail, including permissions and per-app routing: [docs/macos/SETUP.md](../macos/SETUP.md).

## What a future packaged build will look like

When the `.dmg` lands it will initially be **unsigned and un-notarised**, exactly like the current Windows beta. The macOS-specific consequences will be:

- Gatekeeper will refuse a plain double-click. The usual workarounds are right-click → *Open* → *Open*, or removing the quarantine flag:

  ```bash
  xattr -dr com.apple.quarantine /Applications/MeetingCopilot.app
  ```

- On first launch macOS will ask for **microphone** permission (only if you enable the mic channel) and for **screen recording** permission (only if you use screenshot Q&A).
- Data will live in `~/Library/Application Support/MeetingCopilot/` (`settings.json`, `sessions.json`, `knowledge.md`, `models/`), and API keys will be encrypted with the macOS Keychain.

## Known macOS limitations

- **Stealth is best-effort.** Content protection cannot guarantee invisibility against recent ScreenCaptureKit clients; assume a modern screen recorder may see the window.
- **No local MOSS backend.** The experimental MOSS sidecar is CUDA/CPU on Windows only. FunASR runs on Apple MPS; local Whisper falls back to CPU (DirectML is Windows-only).
- **Auto-start at login** is stored but only applied by an installed build, so it does nothing while you run from source.

---

## Related documents

- [QUICK_START.en.md](QUICK_START.en.md) — the five-step wizard and your first meeting
- [API_KEYS.en.md](API_KEYS.en.md) — provider-by-provider key guides
- [TROUBLESHOOTING.en.md](TROUBLESHOOTING.en.md) — error codes, no-sound triage, diagnostics
- [docs/macos/SETUP.md](../macos/SETUP.md) — full platform setup (python env, BlackHole, permissions)
