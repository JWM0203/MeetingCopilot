# Installing on Windows

中文版：[INSTALL_WINDOWS.zh-CN.md](INSTALL_WINDOWS.zh-CN.md)

For people using the packaged build. To run from source, see the Development section of the README.

---

## Requirements

| Item | Requirement |
|---|---|
| OS | Windows 10 / 11, 64-bit (x64) |
| Privileges | No administrator rights needed |
| Disk | ~400 MB installed; 1–2 GB more if you use local transcription models |
| Runtime | No Node.js required. Python is only needed for the **local** ASR backends |

---

## Which file to download

The [Releases page](https://github.com/JWM0203/MeetingCopilot/releases/latest) has two:

| File | Type | Best for |
|---|---|---|
| `MeetingCopilot-<version>-win-x64.exe` | Installer (NSIS) | Normal use. Adds Start-menu and desktop shortcuts |
| `MeetingCopilot-<version>-win-x64-portable.exe` | Portable | Not installing anything — a USB stick, or a locked-down machine |

Each `.exe` also ships a matching `.exe.sha256` containing the hash CI computed at build time.

### Verify the SHA256 (recommended)

In PowerShell, from your downloads folder:

```powershell
Get-FileHash .\MeetingCopilot-<version>-win-x64.exe -Algorithm SHA256
```

Compare the output with the value inside the `.sha256` file.

---

## Installing (installer build)

1. Double-click `MeetingCopilot-<version>-win-x64.exe`.
2. This beta is **unsigned**, so SmartScreen shows "Windows protected your PC". Once you have confirmed the source, click "More info" → "Run anyway".
3. The installer is one-click: it does not ask for a path and installs into your **user** profile (under `%LOCALAPPDATA%\Programs\`). It never touches `Program Files` and needs no administrator rights.
4. Start-menu and desktop shortcuts are created automatically.
5. The app launches when installation finishes, and the first launch opens the setup wizard — see [QUICK_START.en.md](QUICK_START.en.md).

## Running (portable build)

- Double-click and it runs. No registry entries, no shortcuts.
- It unpacks itself into a temporary folder at launch, so **the first start is slower** than the installed build by a few seconds.
- Note that portable is *not* fully self-contained: settings, sessions and imported material still live in `%APPDATA%\MeetingCopilot\`, shared with an installed copy.
- For a genuinely portable profile, point `MC_USERDATA` at your own folder before launching:

  ```powershell
  $env:MC_USERDATA = "D:\MeetingCopilotData"
  .\MeetingCopilot-<version>-win-x64-portable.exe
  ```

  Everything is then written there. This is an advanced option; normal use needs no environment variables.

---

## Where your data lives

| Content | Path |
|---|---|
| Settings (including encrypted API keys) | `%APPDATA%\MeetingCopilot\settings.json` |
| Sessions (transcript + answers + imported material) | `%APPDATA%\MeetingCopilot\sessions.json` |
| Global knowledge base | `%APPDATA%\MeetingCopilot\knowledge.md` |
| Local Whisper models (if used) | `%APPDATA%\MeetingCopilot\models\` |

Type `%APPDATA%\MeetingCopilot` into the Explorer address bar, or use Settings → Advanced → Diagnostics → "Open the data folder".

**API keys are not stored in clear text**: they are encrypted with Windows DPAPI before being written to `settings.json`, which binds them to the current Windows user — after switching accounts or reinstalling Windows you have to enter them again.

---

## Upgrading

1. Download the new installer and run it; it uninstalls the old build and installs the new one.
2. `%APPDATA%\MeetingCopilot\` is left alone, so **settings, keys and sessions all survive**.
3. This release has no auto-updater. The tray's "Check for updates" opens the Releases page in your browser and lets you decide.

## Uninstalling

- Uninstall from Settings → Apps, or from the Start menu.
- **Uninstalling does not delete your data** (`deleteAppDataOnUninstall: false`), and neither does an upgrade.
- To remove everything, delete `%APPDATA%\MeetingCopilot\` by hand afterwards. Check first that you do not still want the stored sessions.

---

## Extra setup for local transcription

Cloud plans work out of the box. Only the "Local sidecar ASR (FunASR / MOSS)" and "Local Whisper turbo" backends need a Python environment and model weights, and the installer ships **neither**. See [docs/windows/SETUP.md](../windows/SETUP.md).

---

## Related documents

- [QUICK_START.en.md](QUICK_START.en.md) — first meeting in five minutes
- [API_KEYS.en.md](API_KEYS.en.md) — how to get a key from each provider
- [TROUBLESHOOTING.en.md](TROUBLESHOOTING.en.md) — error-code table and fixes
