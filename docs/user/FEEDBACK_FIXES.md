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
