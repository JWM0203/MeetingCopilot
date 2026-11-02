# No-secret desktop/package gates

`desktop-gates.yml` is shared by PR/push CI and release builds. A draft release
cannot be created unless **all four** jobs pass: Linux, Windows Server, macOS ARM64 and macOS Intel.
Release uploads include only tested Windows installers and checksums, never logs
or user profiles. These are unsigned beta artifacts; macOS is an unsigned app
smoke, not a signed/notarized distribution gate.

## Coverage

- All runners: locked install/patch check, TypeScript, JS and stdlib Python tests,
  production build, source app and unpacked app boot.
- Real first-run wizard + its preload IPC, then isolated configured-main startup
  + renderer/preload/main LLM IPC. The latter must return the expected missing-key
  error; merely printing the hook prefix (including `threw`) **fails**.
- Main-window scenarios explicitly set `MC_SMOKE_NATIVE=1`: real Electron must
  require `onnxruntime-node`, load its platform N-API binary and list supported
  backends. This catches packaged native loader failures without downloading a
  model. **Module load is not inference or GPU-execution validation.**
- Windows Server 2022: unpacked app, actual portable launcher (including its
  extraction), silent per-user NSIS install into a path containing spaces,
  installed executable boot/IPC, silent uninstall and executable removal.
- Separate native `macos-15` (ARM64) and `macos-15-intel` jobs cover both Mac
  architectures. Windows Server is **not Windows 11**. Runner labels are documented
  in the [official GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Each scenario uses fresh temporary `MC_USERDATA`; inherited `MC_*` hooks and Node
injection variables are removed. The main profile selects an **unconfigured cloud
ASR backend** so no local model download, sidecar, API key, or provider call is
needed. Its expected ASR configuration error is not proof ASR works. Nothing adds
`--disable-gpu`, disables hardware acceleration, or automatically installs a VC
runtime to hide loader failures.

**Not tested**: paid provider connectivity/quality, downloaded ASR models,
physical microphone/loopback devices, OS permission prompts, real conferencing
screen-share exclusion, consumer Win11, signing, notarization, Gatekeeper or
SmartScreen reputation. Logs explicitly report these coverage boundaries.

## Reproduce

After `npm ci && npm run build`:

```sh
node tools/packaged-smoke.mjs --source
# Linux requires a display; CI uses xvfb-run -a before node.
npx --no-install electron-builder --dir --publish never
node tools/packaged-smoke.mjs
# Explicit artifact override (also usable for an installed executable):
node tools/packaged-smoke.mjs --exe /path/to/app --label custom
```

On a **disposable Windows CI runner** (not a personal workstation):

```powershell
npx --no-install electron-builder --win nsis portable --x64 --publish never -c.nsis.runAfterFinish=false
./tools/windows-package-smoke.ps1
```

The NSIS override prevents automatic post-install launch into a real profile.
The wrapper requires `CI` and `RUNNER_TEMP`, refuses an existing installation
folder, and does not elevate. `/D=` and uninstaller `_?=` are final unquoted NSIS
arguments so paths containing spaces work (see
[NSIS command-line contract](https://nsis.sourceforge.io/Docs/Chapter3.html) and
[electron-builder NSIS options](https://www.electron.build/docs/nsis/)).

## Failure evidence

`release/smoke/` contains per-artifact launch logs and neighboring-file inventory.
Windows additionally records OS version, native binary paths/sizes/file versions,
and relevant Application event-log errors if accessible. Workflows upload these
even after a failed smoke; a failure before launch may have no boot log.

Exit codes retain both decimal and unsigned hex: **-1073741515 / 0xC0000135 is
DLL_NOT_FOUND**, a loader/dependency failure, not evidence of the separately seen
0x80000003 breakpoint or a GPU diagnosis. Inventory identifies shipped native
payloads but is not a complete recursive DLL dependency resolver. Use the exact
failing artifact, Windows event evidence and trusted system diagnostics to narrow
the missing dependency; do not label a GPU workaround as a fix.

A premature exit, timeout (90 seconds per scenario), packaging fatal marker,
wrong startup path or invalid IPC response fails the gate. Child process trees
and throwaway profiles are cleaned up; logs remain. Regression verdict tests:
`npx --no-install vitest run test/smoke-verdict.spec.ts`.

### Portable launchers without inherited stdout

The NSIS portable wrapper uses `ExecWait` for the extracted executable. Its
stdout is not accepted as the sole readiness transport: the actual Electron
main process writes nonce-bound JSONL events inside fresh `MC_USERDATA` when
its setup window is created, the wizard renderer calls onboarding IPC, the
native binding loads, and the LLM renderer IPC returns its expected no-key
error. Every launch has a new random nonce; stale, mixed-process, malformed,
wrong-path and renderer-failure evidence fails the gate. A live process alone
never counts as readiness. Both real callback evidence and application process
liveness must survive the three-second settling window; wrapper exit and the
90-second timeout still fail. No timeout or GPU workaround was added.

Only the evidence file (nonce redacted), not the private profile, is retained.
Logs mark the start of intentional process-tree cleanup so a GPU/child-process
warning during teardown can be distinguished from a pre-cleanup failure. Native
module loading and boot IPC still do **not** establish GPU inference or visual
rendering correctness. Windows artifact stages now collect unpacked, portable
and installed/uninstall outcomes independently and fail the job if any fail.
