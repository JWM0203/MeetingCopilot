# macOS port specification

Status: implemented and verified  
Baseline: `5f2743d9bc73e81ab1efa1cc03a2684a85bbc9c8`  
Target: Apple silicon macOS, while preserving existing Windows behavior

## 1. Context

MeetingCopilot is currently Windows-only. Its Electron, React, LLM, cloud ASR,
persistence, and IPC layers are mostly portable, but four assumptions block a
useful macOS build:

1. system-audio capture always requests Electron's `audio: 'loopback'`, which
   Electron documents as Windows-only;
2. the FunASR sidecar uses a hard-coded Windows Python path and `taskkill`;
3. local Whisper requests DirectML before CPU;
4. smoke scripts and startup instructions are Windows-specific.

The first target is an Apple M2 MacBook Air with 8 GB RAM, macOS 26.4.1, Node
24, npm 11, and Homebrew Python 3.11. Resource use is part of correctness: the
local sidecar must not load both large ASR models when only one is selected.

## 2. Goals and non-goals

### Goals

- P0: build, launch, persist encrypted settings, call an OpenAI-compatible LLM,
  and transcribe through a cloud ASR backend on macOS.
- Preserve Windows loopback, DirectML, hotkey, and sidecar behavior.
- Provide a reliable macOS input path for microphones and virtual audio
  devices, with explicit guidance for meeting/system audio.
- P1: run local FunASR on Apple silicon, preferring available MPS and falling
  back to CPU.
- Keep secrets out of source, logs, renderer-visible state, tests, and commits.
- Supply automated contract tests and repeatable macOS smoke procedures.

### Non-goals

- Claiming macOS window invisibility. Newer ScreenCaptureKit clients may capture
  a window despite Electron `setContentProtection(true)`.
- Silently installing or bundling a third-party virtual audio driver.
- Adding a native ScreenCaptureKit addon in this contribution.
- Guaranteeing useful local Whisper latency on an 8 GB machine. FunASR is the
  supported local-first macOS path; Whisper CPU remains a fallback.
- Committing API keys, model weights, local settings, or generated recordings.

## 3. Functional requirements

### R-MAC-001: portable application boot

`npm install`, `npm run typecheck`, `npm test`, `npm run build`, and the Electron
development entry point work on `darwin-arm64`. Windows behavior is not removed.

### R-MAC-002: platform-aware defaults

New macOS settings use familiar `Command`-based shortcuts. Existing saved
shortcuts remain unchanged. User data continues to use Electron `userData`.

### R-SEC-001: secret storage

LLM, vision, and ASR keys stay write-only in the renderer contract and use
Electron `safeStorage` (Keychain on macOS). A plaintext fallback is warned about
and never presented as equivalent security.

### R-CLOUD-001: OpenAI-compatible text model

Given base URL, model, and key, the adapter completes non-streaming prewarm and
a streaming answer on macOS. Errors never include the key.

### R-CLOUD-002: cloud ASR

The existing realtime WebSocket (reference: Alibaba DashScope) and per-segment
OpenAI-compatible (reference: MiMo) contracts remain supported. At least one
passes a live end-to-end macOS smoke test with real audio.

### R-AUDIO-001: capture source abstraction

Windows continues to use Electron loopback for the `them` channel. macOS never
requests the unsupported loopback token; it offers a selectable input device
for `them`, so a physical microphone or user-installed virtual device such as
BlackHole can feed the existing PCM worklet. The independent `me` channel stays
available. UI/docs state the platform limitation honestly.

### R-LOCAL-001: portable FunASR lifecycle

Python resolution precedence is `MC_FUNASR_PYTHON`, a documented project-local
virtual environment, then discoverable `python3`/`python`. Errors are actionable.
Owned sidecars terminate as process trees on Windows and POSIX; external
sidecars are reused and never killed.

### R-LOCAL-002: Apple-silicon execution

For `--device auto`, select CUDA, then MPS only when PyTorch reports it built
and available, then CPU. Failed MPS model initialization retries on CPU.

### R-LOCAL-003: bounded memory

Only the selected model is loaded: `fun-asr-nano` maps to `nano`, and
`paraformer-zh-streaming` maps to `paraformer`. Switching models restarts an
owned sidecar. The app never defaults to loading `both` on the target Mac.

### R-LOCAL-004: local smoke test

A checked-in 16 kHz fixture traverses the local WebSocket protocol and produces
a non-empty final transcript. Report device, model, load/inference time, and
observed memory; do not require exact nondeterministic transcript text.

## 4. Design decisions

- Extend the existing ASR worker/PCM/event contracts instead of forking a
  macOS-specific architecture.
- Deliver cloud first, separating app portability from multi-GB model runtime.
- Use ordinary macOS audio inputs; virtual routing remains an explicit user
  choice because Electron loopback is Windows-only.
- Certify FunASR before local Whisper. FunASR documents MPS support, whereas the
  current JS Whisper path is designed around DirectML.

## 5. TDD verification matrix

Implementation follows red-green-refactor in this order:

| Test ID | Requirement | Verification |
|---|---|---|
| T-001 | R-MAC-002 | macOS Command defaults; unchanged Windows defaults |
| T-002 | R-AUDIO-001 | loopback only on Windows; input capture on macOS |
| T-003 | R-LOCAL-001 | Python resolver precedence and missing-runtime error |
| T-004 | R-LOCAL-001 | `taskkill` on Windows; process-group signal on POSIX |
| T-005 | R-LOCAL-002 | CUDA > available MPS > CPU, with MPS failure fallback |
| T-006 | R-LOCAL-003 | each UI model maps to exactly one sidecar model |
| T-007 | R-SEC-001 | public settings and errors/logs contain no secret |
| T-008 | R-CLOUD-001 | mock server validates streaming/non-streaming LLM |
| T-009 | R-CLOUD-002 | mock WS/HTTP servers validate cloud ASR contracts |
| T-010 | R-MAC-001 | typecheck, full unit suite, and production build pass |
| T-011 | R-CLOUD-001/2 | live audio -> cloud transcript -> cloud answer |
| T-012 | R-LOCAL-004 | fixture -> local sidecar -> non-empty final transcript |

No phase is accepted while its new tests fail or an existing Windows contract
test regresses.

## 6. Delivery phases and gates

### Phase 0A: baseline and failing tests

Install locked dependencies; record test/typecheck/build; then add failing
platform, capture, process, device-selection, and secret-redaction tests.

Gate: baseline status is known and new tests fail for intended reasons.

### Phase 0B: cloud path on macOS

Implement platform defaults and selectable `them` input; make loopback setup
conditional; add portable smoke commands/docs; verify Keychain settings; run
live cloud ASR and LLM smoke tests.

Gate: T-001, T-002, and T-007 through T-011 pass.

### Phase 1: local inference

Implement Python discovery, portable process lifecycle, MPS/CPU fallback, and
single-model loading. Create an ignored Python 3.11 environment, install pinned
dependencies, and run fixture then interactive capture smoke tests.

Gate: T-003 through T-006, T-010, and T-012 pass without swap/fatal memory
pressure on the 8 GB target.

### Phase 2: contribution

Update both READMEs, review secrets/generated/binary/unrelated changes, run the
matrix, commit on `codex/macos-cloud-local-adaptation`, push to a user-owned
fork, open a focused PR against `JWM0203/MeetingCopilot:main`, and track review.

## 7. Required live credentials

Minimum P0:

1. one OpenAI-compatible text LLM key (DeepSeek recommended); and
2. one cloud ASR key: Alibaba DashScope realtime (recommended) or MiMo
   per-segment.

Optional: a vision key for screenshot Q&A, or both ASR providers if both live
paths must be certified. Keys enter only through app settings or temporary
process environment, never tracked files or snapshots.

## 8. Known risks

- macOS permission and Keychain prompts require interactive acceptance.
- Actual meeting/system audio may require a virtual audio input.
- Electron's macOS content protection is not reliable against newer
  ScreenCaptureKit clients, so the app must not promise stealth.
- PyTorch has a current macOS 26 MPS availability report; CPU retry is required.
- Only one local backend/model may be active on the 8 GB target.

## 9. References

- Electron session API: https://www.electronjs.org/docs/latest/api/session
- Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- Electron BrowserWindow: https://www.electronjs.org/docs/latest/api/browser-window
- FunASR MPS option: https://github.com/modelscope/FunASR/blob/main/docs/tutorial/README.md

## 10. Verification ledger (target Mac)

Validated on 2026-07-11:

- Baseline before implementation: 125 Vitest tests passed, typecheck passed,
  and the production Electron build passed.
- T-001/T-002: platform, settings, and capture-strategy tests passed; macOS
  production build uses input capture and never registers Windows loopback.
- T-003 through T-006: seven TypeScript sidecar tests and three dependency-free
  Python device/fallback tests passed.
- T-007: Keychain-backed smoke settings reported `credentials: encrypted=true`;
  repository scan found none of the live credential identifiers.
- T-008/T-011 (LLM): the production adapter completed non-streaming and
  streaming DeepSeek requests; the full Electron renderer -> IPC -> main ->
  provider -> renderer smoke finished with `E2E_LLM_OK`.
- T-009/T-011 (ASR): the built ASR worker streamed bundled Chinese and English
  fixtures through DashScope, produced 24 partials plus final segments on both
  speaker channels, and finished with `SMOKE_OK`.
- T-010: all 133 Vitest tests, all three Python tests, both TypeScript configs,
  Python byte-compilation, dependency consistency, and the production Electron
  build pass after implementation.
- T-012: the local Python 3.11 environment uses the pinned, ABI-matched
  PyTorch/torchaudio 2.11 pair. In the real non-sandboxed runtime PyTorch used
  Apple MPS successfully. The selected paraformer model produced 29 partials
  and non-empty final segments through the built worker (`SMOKE_OK`); steady
  streaming calls were typically 29-47 ms. Electron then discovered `.venv`,
  spawned only paraformer, connected the worker, reached listening state, and
  reaped the process on exit (`E2E_LOCAL_OK`, no remaining sidecar process).
