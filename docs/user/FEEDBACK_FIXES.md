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


## Runtime capture-protection acknowledgement

A native Windows Server diagnostic observed both runtime toggle directions fail to change the actual window: the old API returned the requested boolean and saved it even though Electron/native affinity retained the previous state. With startup OFF, harmless canary text remained visible in native GDI frames after requesting ON. Those observations used direct preload calls, not a demonstrated toolbar ON label. The underlying cause is not yet established; release remains blocked on this capture-protection issue.

The mitigation now checks Electron's actual state after startup and runtime requests, saves the observed state, and returns a structured failure instead of false success. The toolbar retains the observed state, shows Unknown when readback fails, and displays a persistent warning to stop sharing sensitive content and restart/retest. A successful Electron readback is **not** proof that a particular recorder excludes the window. This change does not repair or bypass the underlying native capture behavior; native GDI and actual toolbar tests must report their real outcome, including BLOCKED.


The native recording also exposed MeetingCopilot's own one-time “window hidden” OS notification. That notification is now suppressed while protection is active, requested but not confirmed, or unknown. It remains available once in verified ordinary OFF mode. This changes only the app's own notification—not OS or meeting detection/capture behavior. Reopen using the existing tray icon/menu or configured global hotkey; suppression does not remove either control. Previously displayed OS notifications and other native surfaces are outside this policy.

A subsequent Windows compatibility change reapplies the existing native window opacity through Electron's `setOpacity(getOpacity())` before a runtime protection request from the loaded renderer. Startup keeps the original protection-setter path: native testing rejected a pre-load opacity refresh because the window did not appear in the OFF capture control. It does not force an opacity value, alter CSS panel transparency, recreate the renderer, or affect macOS/Linux. Isolated native tests showed unchanged translucent-panel/opaque-text pixels and repeated ON/OFF affinity changes; the production build must still pass actual toolbar round trips and capture/visual regression checks. The actual-state warning remains in place if the compatibility step or protection request fails. This is not a general recorder-exclusion guarantee.
