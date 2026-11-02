# Native desktop capture diagnostic

Run `node tools/desktop-capture/run.mjs`, then `python tools/desktop-capture/analyze.py` on an interactive Windows desktop after `npm ci && npm run build`. CI uses the existing hosted `windows-2022` runner, no credentials, installs, downloaded capture executables, permission changes or new infrastructure.

This is **real GDI desktop acquisition**, using in-box Windows PowerShell/.NET `BitBlt(SRCCOPY | CAPTUREBLT)` through user32/gdi32. CAPTUREBLT includes ordinary layered windows so the visible transparent-window positive control is meaningful; it does not change display-affinity settings. It does not use `capturePage`, Playwright screenshots, or synthesized renderer video. The app's production region picker independently uses its usual `desktopCapturer`; that is the *action under test*, not the recording backend. Public fake text and a magenta test marker are added only to the isolated renderer. Production code is unchanged.

The native recorder targets 30 fps and saves UTC start/end timestamps for every frame. Video is a standard MJPEG AVI assembled from the actual native JPEG frames using Python's standard library. Playback uses the mean sample interval: `frames.jsonl`, not video time, is authoritative for event correlation. `review.html` and selected native JPEGs support manual inspection. Gaps over 250 ms produce INCONCLUSIVE. Any sampling can miss shorter-than-frame flashes; report actual FPS and maximum gap.

Sequence: patterned background/no-app baseline; unprotected visible text and hover controls; enable content protection and check actual Win32 `GetWindowDisplayAffinity == 0x11`; protected hover/focus, four actual OS `keybd_event` global hotkey presses with observed visibility changes, Settings open/close, real region-picker open/Escape, and final unprotected capture control. Native affinity must reach the requested value within eight seconds or the control is BLOCKED. See the fresh-start variant below for the observed runtime-OFF blocker. Hover/focus and dialog interactions are Playwright renderer input. Region opening uses the production preload API. Hotkeys are native OS input, not IPC substitutes. Initial application startup and the intentional protection-setting transition are outside the protected assertion window. Capture continuously spans every hide/show and overlay transition in that window.

Every native frame is sampled on a four-pixel grid against the known background colors. Non-background pixels >0.1%, any magenta canary, or dark pixels >1% flag evidence for review (not a general OCR guarantee). Controls must show both the clean background and the visible canary, with a changing heartbeat and final visible control; black/frozen/unavailable desktops never pass. All native frames are retained in the AVI, with raw acquisition metrics. No-anomaly means only this finite sequence/backend/host, not universal invisibility. A blocked or anomalous diagnostic deliberately fails its separate workflow rather than silently passing.

Limits: Windows Server is not Windows 11; GDI is not DXGI/Desktop Duplication/Windows Graphics Capture; local recording is not a Teams/Feishu/Tencent recipient's view. Physical monitor flicker, real meeting sharing and macOS capture remain untested. Electron explicitly documents that modern macOS apps using ScreenCaptureKit can capture content-protected windows: https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows . Do not promise exclusion on macOS. Native affinity is configuration evidence, not a universal capture/security guarantee.

## Observed runtime-off blocker and fresh-start control variant

The initial diagnostic starts protected, requests OFF through the production preload API, and checks the correct main HWND. Its third run established IPC return `false` and settings `false`, while Electron and native affinity remained protected/17 after showing and eight seconds. This is an observed runtime-toggle mismatch on this host, **not fixed** by this diagnostic.

The current variant starts the real production app with a fresh isolated profile explicitly OFF, requires native 0 plus visible app/canary control, then enables ON through the production API and requires native17. It executes the same protected transitions. After that assertion window ends, it hides the protected main window and launches a **separate fresh production process/profile OFF** for the post-control (native0 plus visible canary required). The first process remains only to keep its patterned background alive. This does not disable protection in the original window, substitute a mocked app, or hide the known mismatch. If initial OFF or enabling ON fails, the sequence blocks; no further automatic workaround is attempted.

## Actual toolbar failure-handling verification

After a fresh OFF positive control, the current harness clicks the genuine production `Stealth:Off` toolbar button instead of calling the preload setter directly. If enabling is rejected, it requires the persistent protection warning, visible OFF label, `aria-pressed=false`, settings OFF and native affinity0, then records more desktop frames. `uiGuardVerified=true` means only that this failure is now reported truthfully; the capture verdict remains **BLOCKED**, not a privacy pass. If protection actually enables, native17 remains mandatory before the transition sequence. The known earlier backend false-success finding is preserved and is not silently relabelled as fixed capture exclusion.

## Independent fresh-startup protected transitions

`node tools/desktop-capture/run.mjs --startup-protected-transitions` uses separate evidence directory `release/smoke/desktop-capture-startup-protected` and **no runtime protection toggles**. A real app starting OFF provides the visible positive control and neutral background. Its main window is then hidden; a new isolated production process starts ON. Native affinity17, settings ON and registered native hotkey are required before the finite protected assertion window begins. Hover, keyboard focus, four native hide/show hotkeys, Settings and real region-picker/Escape run for approximately 20–30 seconds, then a third fresh OFF production process supplies the native0/visible post-control. Process launches and shutdowns are outside the protected assertion. The original OFF process stays alive solely for its neutral background.

This is scientifically independent of the proven runtime toggle mismatch. Results are separate: a successful sampled startup-protected transition sequence cannot fix, override or erase the runtime-toggle BLOCKED diagnostic. The workflow deliberately preserves both statuses and artifacts; it runs this second sequence after a successful build even when the runtime-toggle diagnostic fails. Initial ON failure blocks this sequence without direct native setters, fallback APIs or security changes.

## Natural baseline stabilization (notifications remain observable)

A completed diagnostic recorded the app's one-shot “still running / window hidden” system toast over the early baseline. That is real capturable app metadata, not secret-answer canary leakage, and its frames are retained. The production first-hide path can emit this notification; no claim is made that hotkeys can never trigger it. In that run the 22.36-second protected sequence itself had no sampled off-pattern pixels, but the initial baseline gate correctly blocked a full pass.

The recorder now starts **before** baseline validation and waits at most12seconds for ten consecutive native frames satisfying the unchanged clean-background criterion. It does not dismiss, disable, filter or mask notifications; pre-baseline contamination remains in the video and recorded frame metadata. The complete protected sequence and post-control then run unchanged. All cleanup still uses Playwright ElectronApplication.close(), whose installed implementation calls Electron app.quit(); it does not invoke a close-to-tray behavior.

### Runtime compatibility regression
The default run now requires three actual toolbar ON/OFF round trips on the same
production HWND and webContents. Each ON requires native affinity 17 and each OFF
requires affinity 0 plus a visible captured canary. All three protected intervals
are analyzed. A CSS panel-opacity fixture of 0.6, current native window opacity,
renderer identity, selected session, and an unsent synthetic DOM input value must
survive. The disabled input value is seeded solely as a renderer-preservation
sentinel; this is not a claim of testing a configured live LLM session. Inspect
initial and final OFF native frames for per-pixel panel transparency and solid
text preservation. The independent startup-protected run remains separate.
Historical failed-toggle artifacts remain evidence of the previous bug; only a
complete new native result can validate the compatibility candidate.

### Next-launch preference behavior (current production contract)
The workflow runs `next-launch.mjs`: omit the saved stealth preference to verify
new-profile default ON, save OFF through the real UI while current native affinity
stays 17, normal app.quit and relaunch the same saved profile to verify OFF, then
save ON while current affinity stays 0 and relaunch to verify ON. Current-state
and next-launch labels, pending indicator, disk-save acknowledgement, unchanged
window identity/native opacity, and registered OS hotkey visibility are required.
The OFF process mutates a public marker three times; real native frame counts
must change, rejecting frozen native presentation. The separate startup sequence
still covers hover, four OS hotkeys, settings and region-picker cancellation.
`run.mjs` without startup mode retains the historical immediate-toggle diagnostic;
it is not the current preference UI contract and is no longer invoked by CI.
No restart is automatic in the product; normal quits here are explicit test steps
after verifying saved preferences. No API keys or live meeting accounts are used.
