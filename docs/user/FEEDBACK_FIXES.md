# Feedback stability update (development, not a verified release)

- Keeps the existing panel-background opacity slider/default; text and controls stay opaque.
- Clears recovered ASR engine warnings without hiding unrelated microphone/capture failures.
- Audio startup releases devices on failure, coalesces repeated starts and cancels stale permission/worklet results after Stop. These are mocked lifecycle tests, not proof of physical loopback/microphone compatibility.
- Session deletion can undo the most recent deletion until the app closes. TXT export includes visible transcript/answers, not imported resume/JD material or hidden memo. Exported meeting content is still private: store/share it appropriately.
- Translation, document import and screenshot results remain attached to their originating session when the user switches sessions.
- Failed text answers have an explicit Retry button. Requests are bounded by a timeout; partial answers are not automatically retried or billed twice. Screenshot failure requires a new capture rather than keeping image data for retry.
- Official DeepSeek endpoints use the current Flash preset and explicit fast (non-thinking) mode; legacy model migration does not change third-party relay endpoints or their model names.
- Optional local document-library retrieval supports multiple documents and per-session scope. It is OFF by default. Enabling it downloads a pinned embedding model and consumes CPU/disk. Selected snippets are sent to the configured answer provider and may add billable tokens. Do not select files you are not permitted to send. RAG failure/timeout falls back to the original answer path; an empty/disabled scope never retrieves.

## Verification boundaries

The automated desktop workflow tests Linux, Windows Server and macOS builds, startup/IPC, and packaged launch. Windows additionally installs/launches/uninstalls NSIS and exercises the real portable launcher with isolated fresh profiles and non-ASCII paths. See `tools/PACKAGING_SMOKE.md`.

A workflow definition is not a passing result. Require green checks for the exact source commit before publication. Windows Server is not Windows 11. Signing/notarization, physical microphone/system audio, BlackHole, OS permission dialogs, real meeting screen sharing and paid provider/model accuracy require separate verification. No anti-monitoring or exam-proctoring bypass is promised.

Never attach API keys, personal settings, transcripts, documents, model caches or raw private logs to issues or CI artifacts. No real provider credentials are included in source tests.

## Hover hints and capture privacy

The reported hover phrase “让 AI 帮我回答这句” matched a native HTML `title` popup. The main overlay now renders hints within its own web surface instead of requesting a separate native tooltip. Accessible control names and keyboard-focus hints remain; Escape, scrolling, clicking, window blur and dismissal clear pending hints. This removes that native-popup path but has not yet been verified against every meeting or recording application.

Capture protection is best-effort, not invisibility. Cursor composition and focus-switch notifications are separate from window pixels; opening the screenshot selector or another window can legitimately change focus. This change does not hide cursors, falsify focus or bypass platform monitoring. A black region can depend on Windows version and capture API and must be reproduced separately.

Electron documents that Windows 10 before version 2004 may capture a black window instead of excluding it, and a new protection setting takes effect on the next desktop composition. On macOS, ScreenCaptureKit applications may capture a window despite `setContentProtection(true)`. Native file dialogs and other windows are not automatically protected by the main window setting. Before sharing sensitive notes, test the exact app/version and capture mode with harmless sample content and review the recipient view/recording. [Electron BrowserWindow documentation](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows).

The status bar now names the saved ASR backend; local mode does not use saved cloud-ASR keys. A text-LLM connection timeout does not establish an ASR endpoint fault. Cloud/CPU/local-sidecar readiness is no longer displayed as a blanket “GPU” success claim.

Linux CI uses the stock Ubuntu 22.04 runner and the default Electron sandbox. Ubuntu 24.04 source startup failed with a sandbox-helper setup error; reusing its preinstalled helper also failed the root/mode safety guard. No permissions, AppArmor settings or sandbox protections were weakened. Ubuntu 22.04 still needs its own successful exact-commit boot/package result and does not prove Ubuntu 24.04 compatibility.


## Capture protection: next launch only / 采集保护：下次启动生效

**Update notice:** New profiles and profiles without a saved protection preference default to ON; existing explicit OFF preferences remain OFF. The toolbar shows current runtime state separately from the next-launch preference. Runtime changes only persist that preference—no native protection setter, automatic restart or window recreation is performed. Finish your work, choose **Quit** (hiding/minimizing to the tray is not quitting), and reopen the app to apply the saved choice. Do not treat “next launch: ON” as protection for the current run. If saving fails, the UI must not claim the new choice was saved.

**更新提示：** 新用户或缺少采集保护设置时默认开启；已有用户明确保存的关闭选项不会被覆盖。界面分别显示当前运行状态和下次启动设置。修改开关只保存偏好，不调用原生保护切换、不自动重启、不重建窗口。请先完成当前工作，选择**退出**（隐藏或最小化到托盘不算退出），再重新打开应用。不能把“下次启动：开”理解为本次已开启；保存失败时也不能显示保存成功。

At startup, the app applies the saved preference and reads Electron's actual state. Unknown/unavailable readback and application failures remain visible rather than being presented as success. Reading current state must not overwrite the independent next-launch preference. A successful readback is **not** proof that every recorder excludes the window: test harmless content in the actual recipient view/recording before sharing sensitive notes. Startup, persistence, full quit/reopen, dynamic visibility and native-capture checks must pass for the exact candidate; a development change is not itself a verified release.

启动时按保存的偏好设置保护并读取实际状态；无法确认或应用失败仍需明确提示。读取当前状态不会覆盖独立的下次启动偏好。实际状态读回成功也不代表所有录屏软件都能排除窗口，请先以无敏感内容实测。当前方案是明确的下次启动设置，不是运行时切换故障已修复的声明。

### Why runtime toggling was removed

Native Windows Server diagnostics observed both runtime toggle directions fail to change the actual window: the old API returned and saved the requested value despite Electron/native affinity retaining the previous state. With startup OFF, harmless canary text remained visible in native GDI frames after requesting ON. Initial observations used direct preload calls, not a demonstrated toolbar ON label. The underlying runtime-toggle cause remains unresolved. The next-launch-only design avoids that unsafe path rather than claiming to repair it; the prior truthful-state warning and native diagnostic evidence remain relevant.

The native recording also exposed MeetingCopilot's own one-time “window hidden” OS notification. That notification is now suppressed while protection is active, requested but not confirmed, or unknown. It remains available once in verified ordinary OFF mode. This changes only the app's own notification—not OS or meeting detection/capture behavior. Reopen using the existing tray icon/menu or configured global hotkey; suppression does not remove either control. Previously displayed OS notifications and other native surfaces are outside this policy.


### Rejected opacity-refresh experiment

Isolated tests initially suggested that reapplying native opacity could enable runtime capture-affinity changes while preserving static pixels. Production capture controls disproved its safety: refreshing before renderer load made the OFF window invisible; refreshing only at runtime allowed affinity changes but froze the native presentation despite subsequent DOM updates. Both production variants have been reverted. The app retains original panel-only transparency, actual-state verification and explicit failure warnings. Diagnostic tests and failed recordings remain available; neither candidate is a supported fix. The runtime-toggle issue remains unresolved, and no global-opacity substitution or renderer recreation is applied.
