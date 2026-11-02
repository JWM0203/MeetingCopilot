# No-secret Electron UI interaction gate

Run `npm ci`, `npm run build`, then `npm run smoke:ui` on a normal desktop runner
(or `xvfb-run -a npm run smoke:ui` on Ubuntu 22.04). The test refuses root on Linux
because Playwright automatically disables Electron's sandbox for root. Do not add
sandbox, GPU or OS-security bypass flags to make this gate pass.

The test launches the **actual built application** (production main, preload and
React UI), not a component story or browser approximation. It uses an isolated
Unicode temporary profile. No credentials, provider charges, models or real user
files are required. Playwright is an exact-pinned development dependency; it uses
the project's Electron binary, not a separately downloaded browser.

Coverage:

- Production light/dark theme and panel-opacity settings at 940×560 and
  640×380; solid text, visible control bounds and rendered screenshots.
- Real mouse-drag partial/cross-bubble/first-character transcript selections and
  the floating Answer button; exact text reaches an explicitly mocked provider.
  Clearing selection, changing sessions and clearing transcripts invalidate the
  popup. Direct bubble Answer/Translate remain covered with mocked transport.

- Production session load/create/switch/delete/undo/persist and real TXT download;
  imported resume, JD and hidden memo are excluded from export.
- Same-window hover and keyboard hints, Escape dismissal and no extra Electron
  window; screenshot evidence of the hint inside a modal's top layer.
- **Mocked** region picker cancel/error/retry and delayed picker completion after
  session switching; the answer belongs to the originating session and the other
  session's draft is preserved.
- **Mocked** provider error/retry/stream cancellation through real preload IPC.
- RAG off by default; **mocked** in-flight indexing can be disabled without a stale
  result re-enabling the UI. No model is downloaded or index built in this suite.
- Production capture lifecycle and AudioWorklet run twice with an oscillator-fed
  real MediaStream, with track termination and AudioContext closure asserted.
  Input acquisition is synthetic, not a physical mic or actual system loopback.

Mocks are installed through the test's Electron main-process evaluation and are
confined to that launched process. They do not add production app hooks. All
runtime fixture state and temporary profiles are removed when the process exits.

`release/smoke/ui/` contains actual rendered PNGs, the fixture TXT export and a
machine-readable results file. CI preserves these even on failure. A pass does
**not** verify paid provider integration, real desktop region capture, OS privacy
prompts, real microphone/system audio, screen-share exclusion, signing, or
notarization. Screenshot UI-flow fixtures are not evidence of actual capture.

The cloud coding container cannot launch Electron: its socket call is denied
(`process_singleton_posix.cc: socket() failed: Operation not permitted`). This is
not an app failure or a reason to weaken security; the gate runs on the already
authorized hosted desktop runners instead.
