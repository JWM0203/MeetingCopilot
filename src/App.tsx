import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnswerLang,
  AsrEvent,
  KbSlot,
  LlmAskPayload,
  PublicSettings,
  StoredSession,
} from '../shared/protocol';
import {
  appendSegment,
  nextSegmentId,
  percentile,
  reindexSegments,
  type TranscriptSegment,
} from '../shared/transcript';
import { isLikelyQuestion } from '../shared/textHeuristics';
import { captureKindForPlatform } from '../shared/platform';
import { LoopbackCapture } from './audio/loopbackCapture';
import { MicCapture, listMics } from './audio/micCapture';
import { TranscriptPanel } from './components/TranscriptPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusBar } from './components/StatusBar';
import { AnswerSession, type AnswerTurn } from './components/AnswerSession';
import { I18nProvider, getDict, type Dict } from './i18n';

export interface AsrUiState {
  phase: 'loading' | 'ready' | 'error';
  ep?: string;
  gpuSuspect?: boolean;
  workerState: 'loading' | 'listening' | 'speech' | 'transcribing' | 'stopped';
  lastError?: string;
}

export interface HudStats {
  lastE2eMs?: number;
  lastInferMs?: number;
  p50?: number;
  p95?: number;
  count: number;
}

const MAX_TURNS = 200;
// v2: only the last 8 turns ride along verbatim — the rolling memo carries
// older context, keeping per-request tokens flat as the interview runs long
const HISTORY_TURNS = 8;

let seq = 0;
const uid = (p: string) => `${p}-${++seq}-${Date.now()}`;

function newSession(name: string): StoredSession {
  return { id: uid('s'), name, createdAt: Date.now(), turns: [], segments: [] };
}

/** legacy single-slot KB → resume slot (dual-slot material, P0-2) */
function migrateKbSlots(s: StoredSession, fallbackName: string): StoredSession {
  if (!s.kbText || s.resumeText) return s;
  const { kbName, kbText, ...rest } = s;
  return { ...rest, resumeName: kbName ?? fallbackName, resumeText: kbText };
}

/** first-question topic → a short session title */
function deriveName(text: string, fallback: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return fallback;
  return t.length > 14 ? t.slice(0, 14) + '…' : t;
}

export function App() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [asr, setAsr] = useState<AsrUiState>({ phase: 'loading', workerState: 'loading' });
  const [capturing, setCapturing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHud, setShowHud] = useState(true);
  const [hud, setHud] = useState<HudStats>({ count: 0 });
  const [continuous, setContinuous] = useState(false);
  const [mics, setMics] = useState<{ deviceId: string; label: string }[]>([]);
  const [micActive, setMicActive] = useState(false);
  const [partials, setPartials] = useState<{ them?: string; me?: string }>({});
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [currentId, setCurrentId] = useState<string>('');
  const [kbNotice, setKbNotice] = useState<string | null>(null);

  const loopbackRef = useRef<LoopbackCapture | null>(null);
  const themInputRef = useRef<MicCapture | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const settingsRef = useRef<PublicSettings | null>(null);
  const e2eSamples = useRef<number[]>([]);
  const sessionsRef = useRef<StoredSession[]>([]);
  const currentIdRef = useRef<string>('');
  const answerLangRef = useRef<AnswerLang>('chinese');
  const loaded = useRef(false);

  // UI language: settings-driven; ref mirror so stable callbacks stay fresh
  const t = getDict(settings?.ui.lang);
  const tRef = useRef<Dict>(t);
  tRef.current = t;

  if (!loopbackRef.current) loopbackRef.current = new LoopbackCapture();
  if (!themInputRef.current) themInputRef.current = new MicCapture();
  if (!micRef.current) micRef.current = new MicCapture();
  settingsRef.current = settings;
  sessionsRef.current = sessions;
  currentIdRef.current = currentId;

  const current = useMemo(
    () => sessions.find((s) => s.id === currentId) ?? null,
    [sessions, currentId],
  );
  const segments = current?.segments ?? [];

  const patchSession = useCallback((id: string, fn: (s: StoredSession) => StoredSession) => {
    setSessions((list) => list.map((s) => (s.id === id ? fn(s) : s)));
  }, []);

  const appendTurn = useCallback(
    (sessionId: string, turn: AnswerTurn) => {
      patchSession(sessionId, (s) => {
        const turns = [...s.turns, turn];
        return { ...s, turns: turns.length > MAX_TURNS ? turns.slice(turns.length - MAX_TURNS) : turns };
      });
    },
    [patchSession],
  );

  const buildHistory = useCallback((): { role: 'user' | 'assistant'; content: string }[] => {
    const s = sessionsRef.current.find((x) => x.id === currentIdRef.current);
    if (!s) return [];
    const done = s.turns.filter((t) => t.status === 'done' && t.kind !== 'translate').slice(-HISTORY_TURNS);
    return done.flatMap((t) => [
      { role: 'user' as const, content: t.label },
      { role: 'assistant' as const, content: t.text },
    ]);
  }, []);

  /** current session's dual-slot material (resume / JD / rolling memo) */
  const currentMaterial = useCallback((): { resume?: string; jd?: string; memo?: string } => {
    const s = sessionsRef.current.find((x) => x.id === currentIdRef.current);
    return {
      resume: s?.resumeText || undefined,
      jd: s?.jdText || undefined,
      memo: s?.memo || undefined,
    };
  }, []);

  /** P1-6: ask main to warm the DeepSeek prefix cache for the current material */
  const prewarm = useCallback(
    (immediate: boolean) => {
      const m = currentMaterial();
      window.mc.prewarm({ resume: m.resume, jd: m.jd, immediate });
    },
    [currentMaterial],
  );

  // P1-5: rolling memo — fold each finished Q&A in asynchronously, one update
  // at a time per session (promise chain), never on the answer critical path
  const memoChain = useRef(new Map<string, Promise<void>>());
  const enqueueMemoUpdate = useCallback(
    (sid: string, question: string, answer: string) => {
      if (!question.trim() || !answer.trim()) return;
      const prev = memoChain.current.get(sid) ?? Promise.resolve();
      const next = prev
        .then(async () => {
          const old = sessionsRef.current.find((x) => x.id === sid)?.memo ?? '';
          const memo = await window.mc.memoUpdate({ memo: old, question, answer });
          if (memo) patchSession(sid, (s) => ({ ...s, memo }));
        })
        .catch(() => {});
      memoChain.current.set(sid, next);
    },
    [patchSession],
  );

  /** auto-name a session from its first real question (once) */
  const maybeTitle = useCallback(
    (sid: string, text?: string) => {
      if (!text?.trim()) return;
      patchSession(sid, (s) =>
        s.titled ? s : { ...s, name: deriveName(text, tRef.current.app.newSession), titled: true },
      );
    },
    [patchSession],
  );

  const askLlm = useCallback(
    (mode: 'segment' | 'continuous' | 'free' | 'translate', text?: string) => {
      const sid = currentIdRef.current;
      if (!sid) return;
      const requestId = uid('req');
      const segs = sessionsRef.current.find((x) => x.id === sid)?.segments ?? [];
      // continuous: resolve the actual question NOW — the other party's latest
      // line — so the turn label (and thus session history) carries the real
      // question instead of a constant '对方最新发言' (v1 history-label bug)
      let question = text;
      if (mode === 'continuous') {
        for (let i = segs.length - 1; i >= 0; i--) {
          if ((segs[i].speaker ?? 'them') === 'them') {
            question = segs[i].text;
            break;
          }
        }
      }
      const label = question ?? (mode === 'continuous' ? tRef.current.app.latestRemark : '');
      appendTurn(sid, { id: requestId, kind: mode, label, text: '', status: 'streaming' });
      if (mode === 'segment' || mode === 'free') maybeTitle(sid, text);
      const material = mode === 'translate' ? {} : currentMaterial();
      const payload: LlmAskPayload = {
        requestId,
        mode,
        question: mode === 'free' ? undefined : question,
        freeQuestion: mode === 'free' ? text : undefined,
        recentTranscript: segs.slice(-30).map((s) => s.text),
        answerLang: answerLangRef.current,
        history: mode === 'translate' ? undefined : buildHistory(),
        ...material,
      };
      window.mc.llmAsk(payload);
    },
    [appendTurn, buildHistory, currentMaterial, maybeTitle],
  );

  const askShot = useCallback(
    (question: string, imageDataUrl?: string) => {
      const sid = currentIdRef.current;
      if (!sid) return;
      const requestId = uid('shot');
      appendTurn(sid, {
        id: requestId,
        kind: 'vision',
        label: question || tRef.current.app.readShot,
        text: '',
        status: 'streaming',
      });
      maybeTitle(sid, question || tRef.current.app.shotQuestion);
      const m = currentMaterial();
      const background = [m.resume, m.jd].filter(Boolean).join('\n\n') || undefined;
      window.mc.shotAsk({ requestId, question, background, imageDataUrl });
    },
    [appendTurn, currentMaterial, maybeTitle],
  );

  /** region screenshot flow (📷 button or hotkey): drag a region, then ask */
  const doRegionShot = useCallback(async () => {
    const img = await window.mc.pickRegion();
    if (img) askShot('', img);
  }, [askShot]);

  // ---- boot: load settings + sessions ----
  useEffect(() => {
    void window.mc.getSettings().then((s) => {
      setSettings(s);
      answerLangRef.current = s.llm.answerLang;
    });
    void window.mc.loadSessions().then((f) => {
      if (f.sessions.length) {
        // heal legacy duplicate segment ids (worker counter used to reset per
        // engine rebuild — translations then landed on multiple bubbles)
        setSessions(
          f.sessions.map((s) =>
            migrateKbSlots(
              { ...s, segments: reindexSegments(s.segments ?? []) },
              tRef.current.app.legacyKbName,
            ),
          ),
        );
        setCurrentId(f.currentId && f.sessions.some((s) => s.id === f.currentId) ? f.currentId : f.sessions[0].id);
      } else {
        const s = newSession(tRef.current.app.sessionN(1));
        setSessions([s]);
        setCurrentId(s.id);
      }
      loaded.current = true;
    });

    const handleAsrEvent = (ev: AsrEvent) => {
      if (ev.kind === 'ready') {
        setAsr((s) => ({ ...s, phase: 'ready', ep: ev.ep, gpuSuspect: ev.gpuSuspect, workerState: 'listening' }));
      } else if (ev.kind === 'status') {
        setAsr((s) => ({ ...s, workerState: ev.state }));
      } else if (ev.kind === 'error') {
        setAsr((s) => ({ ...s, phase: ev.fatal ? 'error' : s.phase, lastError: ev.message }));
      } else if (ev.kind === 'partial') {
        setPartials((p) => ({ ...p, [ev.speaker]: ev.text }));
      } else if (ev.kind === 'segment') {
        setPartials((p) => ({ ...p, [ev.speaker]: undefined })); // final replaces the live partial
        const e2eMs = Date.now() - ev.timings.speechEndTs;
        const inferMs = ev.timings.inferEndTs - ev.timings.inferStartTs;
        e2eSamples.current.push(e2eMs);
        if (e2eSamples.current.length > 200) e2eSamples.current.shift();
        setHud({
          lastE2eMs: e2eMs,
          lastInferMs: inferMs,
          p50: percentile(e2eSamples.current, 50),
          p95: percentile(e2eSamples.current, 95),
          count: e2eSamples.current.length,
        });
        const sid = currentIdRef.current;
        setSessions((list) =>
          list.map((s) =>
            s.id === sid
              ? {
                  ...s,
                  segments: appendSegment(s.segments ?? [], {
                    // NOT ev.id: the worker counter resets per engine rebuild,
                    // duplicating ids inside a persisted session
                    id: nextSegmentId(s.segments ?? []),
                    text: ev.text,
                    lang: ev.lang,
                    speaker: ev.speaker,
                    startTs: ev.timings.speechStartTs,
                    endTs: ev.timings.speechEndTs,
                    e2eMs,
                    inferMs,
                  }),
                }
              : s,
          ),
        );
      }
    };
    const off = window.mc.onAsrEvent(handleAsrEvent);
    // instant-ready cloud engines emit ready/status BEFORE this subscription
    // exists — pull the last ones so the UI never sticks at "模型加载中"
    void window.mc.asrReplay().then(({ ready, status }) => {
      if (ready) handleAsrEvent(ready);
      if (status) handleAsrEvent(status);
    });

    const offLlm = window.mc.onLlmEvent((ev) => {
      setSessions((list) =>
        list.map((s) => ({
          ...s,
          turns: s.turns.map((t) => {
            if (t.id !== ev.requestId) return t;
            if (ev.kind === 'delta') return { ...t, text: t.text + ev.text };
            if (ev.kind === 'done') return { ...t, text: ev.text || t.text, status: 'done' };
            return { ...t, status: 'error', error: ev.message };
          }),
        })),
      );
      // fold finished ANSWER turns into the session memo (async, off-path);
      // translate/vision turns are not interview Q&A
      if (ev.kind === 'done') {
        const s = sessionsRef.current.find((x) => x.turns.some((t) => t.id === ev.requestId));
        const t = s?.turns.find((x) => x.id === ev.requestId);
        if (s && t && (t.kind === 'segment' || t.kind === 'continuous' || t.kind === 'free')) {
          enqueueMemoUpdate(s.id, t.label, ev.text || t.text);
        }
      }
    });

    const offShot = window.mc.onShotHotkey(() => void doRegionShot());

    window.__mcAutoStart = () => void startCapture();
    return () => {
      off();
      offLlm();
      offShot();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- persist sessions (debounced) ----
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => window.mc.saveSessions({ sessions, currentId }), 400);
    return () => clearTimeout(t);
  }, [sessions, currentId]);

  // ---- apply UI theme + answer font scale to the document root ----
  useEffect(() => {
    const ui = settings?.ui;
    if (!ui) return;
    document.documentElement.dataset.fontScale = ui.fontScale ?? 'medium';
    const apply = () => {
      const mode = ui.theme ?? 'dark';
      const dark =
        mode === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : mode === 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    if ((ui.theme ?? 'dark') !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings]);

  // auto-dismiss the KB parse notice
  useEffect(() => {
    if (!kbNotice) return;
    const t = setTimeout(() => setKbNotice(null), 8000);
    return () => clearTimeout(t);
  }, [kbNotice]);

  // switching sessions swaps the material → prefix dirty (reheats if capturing)
  useEffect(() => {
    if (!loaded.current || !currentId) return;
    prewarm(false);
  }, [currentId, prewarm]);

  // continuous mode: only the OTHER party's questions trigger it (never my own
  // mic), question-gated + append, per current session.
  const lastSeg = segments.length ? segments[segments.length - 1] : null;
  useEffect(() => {
    if (!continuous || !lastSeg) return;
    if ((lastSeg.speaker ?? 'them') !== 'them') return; // ignore my own voice
    if (!isLikelyQuestion(lastSeg.text)) return;
    const timer = setTimeout(() => askLlm('continuous'), 1100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuous, lastSeg?.id, lastSeg?.endTs]);

  // Windows: Electron system loopback. macOS/Linux: selected ordinary input
  // (typically a virtual audio device for meeting/system audio).
  const startCapture = useCallback(async () => {
    const inputMode = captureKindForPlatform(window.mc.platform) === 'input';
    const cap = inputMode ? themInputRef.current! : loopbackRef.current!;
    if (cap.running) return;
    try {
      if (inputMode) {
        await themInputRef.current!.start(
          settingsRef.current?.audio.themDeviceId,
          (buf, ts) => window.mc.sendPcm(buf, ts, 'them'),
          { audioProcessing: false },
        );
        void listMics().then(setMics).catch(() => undefined);
      } else {
        await loopbackRef.current!.start((buf, ts) => window.mc.sendPcm(buf, ts, 'them'));
      }
      window.mc.captureStarted();
      setCapturing(true);
      prewarm(true); // ▶ = the meeting starts — build the KV prefix cache now
    } catch (e) {
      setAsr((s) => ({ ...s, lastError: tRef.current.app.captureStartFail((e as Error).message) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopCapture = useCallback(async () => {
    const cap =
      captureKindForPlatform(window.mc.platform) === 'input'
        ? themInputRef.current!
        : loopbackRef.current!;
    await cap.stop();
    window.mc.captureStopped();
    setCapturing(false);
  }, []);

  // 🎤 独立麦克风采集：只转麦克风(我)，与系统声音互不影响，按钮直接控制起停
  const toggleMicCapture = useCallback(async () => {
    const mic = micRef.current!;
    if (mic.running) {
      await mic.stop();
      setMicActive(false);
      return;
    }
    try {
      await mic.start(settings?.audio.micDeviceId, (buf, ts) => window.mc.sendPcm(buf, ts, 'me'));
      setMicActive(true);
      if (mics.length === 0) void listMics().then(setMics);
    } catch (e) {
      setAsr((s) => ({ ...s, lastError: tRef.current.app.micStartFail((e as Error).message) }));
    }
  }, [settings, mics]);

  const setSeg = useCallback(
    (segId: number, patch: Partial<TranscriptSegment>) => {
      const sid = currentIdRef.current;
      setSessions((list) =>
        list.map((s) =>
          s.id === sid
            ? { ...s, segments: (s.segments ?? []).map((g) => (g.id === segId ? { ...g, ...patch } : g)) }
            : s,
        ),
      );
    },
    [],
  );

  const translateSegment = useCallback(
    (seg: TranscriptSegment) => {
      if (seg.translating) return; // re-translating an already-translated bubble is allowed
      setSeg(seg.id, { translating: true });
      window.mc
        .translate(seg.text)
        .then((zh) => setSeg(seg.id, { translation: zh, translating: false }))
        .catch(() => setSeg(seg.id, { translation: tRef.current.app.translateFail, translating: false }));
    },
    [setSeg],
  );

  const toggleStealth = useCallback(async () => {
    if (!settings) return;
    const on = await window.mc.setStealth(!settings.ui.stealth);
    setSettings({ ...settings, ui: { ...settings.ui, stealth: on } });
  }, [settings]);

  const toggleAnswerLang = useCallback(async () => {
    if (!settings) return;
    const next: AnswerLang = settings.llm.answerLang === 'chinese' ? 'english' : 'chinese';
    answerLangRef.current = next;
    const updated = await window.mc.setSettings({ llm: { answerLang: next } });
    setSettings(updated);
    answerLangRef.current = updated.llm.answerLang;
    prewarm(false); // lang is part of the stable prefix → mark dirty / reheat
  }, [settings, prewarm]);

  const toggleAnswerModel = useCallback(async () => {
    if (!settings) return;
    const updated = await window.mc.setSettings({ llm: { answerWithVision: !settings.llm.answerWithVision } });
    setSettings(updated);
  }, [settings]);

  const selectMic = useCallback(
    async (deviceId: string) => {
      const updated = await window.mc.setSettings({ audio: { micDeviceId: deviceId || undefined } });
      setSettings(updated);
      // if the mic is currently on, restart it on the newly chosen device
      const mic = micRef.current!;
      if (mic.running) {
        await mic.stop();
        await mic
          .start(deviceId || undefined, (buf, ts) => window.mc.sendPcm(buf, ts, 'me'))
          .catch(() => setMicActive(false));
      }
    },
    [],
  );

  const selectThemInput = useCallback(async (deviceId: string) => {
    const updated = await window.mc.setSettings({ audio: { themDeviceId: deviceId || undefined } });
    setSettings(updated);
    settingsRef.current = updated;
    const input = themInputRef.current!;
    if (input.running) {
      await input.stop();
      await input
        .start(
          deviceId || undefined,
          (buf, ts) => window.mc.sendPcm(buf, ts, 'them'),
          { audioProcessing: false },
        )
        .catch((e) => {
          window.mc.captureStopped();
          setCapturing(false);
          setAsr((s) => ({ ...s, lastError: tRef.current.app.themInputSwitchFail((e as Error).message) }));
        });
    }
  }, []);

  const clearTranscript = useCallback(() => {
    patchSession(currentIdRef.current, (s) => ({ ...s, segments: [] }));
  }, [patchSession]);

  const cancelTurn = useCallback(
    (id: string) => {
      window.mc.llmCancel(id);
      patchSession(currentIdRef.current, (s) => ({
        ...s,
        turns: s.turns.map((t) => (t.id === id ? { ...t, status: 'done' } : t)),
      }));
    },
    [patchSession],
  );

  const createSession = useCallback(() => {
    const s = newSession(tRef.current.app.sessionN(sessionsRef.current.length + 1));
    setSessions((list) => [...list, s]);
    setCurrentId(s.id);
  }, []);

  const deleteSession = useCallback((id: string) => {
    setSessions((list) => {
      const next = list.filter((s) => s.id !== id);
      if (next.length === 0) {
        const s = newSession(tRef.current.app.sessionN(1));
        setCurrentId(s.id);
        return [s];
      }
      setCurrentId((cur) => (cur === id ? next[0].id : cur));
      return next;
    });
  }, []);

  const renameSession = useCallback(
    (id: string, name: string) => {
      patchSession(id, (s) => ({ ...s, name: name.trim() || s.name, titled: true }));
    },
    [patchSession],
  );

  const pickKb = useCallback(
    async (slot: KbSlot) => {
      const r = await window.mc.pickKnowledge(slot);
      if (!r) return;
      if (!r.text.trim()) {
        // deterministic parsers return '' for scanned/image-only PDFs
        setKbNotice(tRef.current.app.kbNoText(r.name));
        return;
      }
      setKbNotice(null);
      patchSession(currentIdRef.current, (s) =>
        slot === 'resume'
          ? { ...s, resumeName: r.name, resumeText: r.text }
          : { ...s, jdName: r.name, jdText: r.text },
      );
      // material changed → reheat the prefix cache with the fresh bytes;
      // patchSession is async (React state), so pass the new slots directly
      window.mc.prewarm({
        resume: slot === 'resume' ? r.text : currentMaterial().resume,
        jd: slot === 'jd' ? r.text : currentMaterial().jd,
        immediate: true,
      });
    },
    [patchSession, currentMaterial],
  );

  const clearKb = useCallback(
    (slot: KbSlot) => {
      patchSession(currentIdRef.current, (s) =>
        slot === 'resume'
          ? { ...s, resumeName: undefined, resumeText: undefined }
          : { ...s, jdName: undefined, jdText: undefined },
      );
      // prefix went stale; reheats now if capturing, else at the next ▶
      window.mc.prewarm({
        resume: slot === 'resume' ? undefined : currentMaterial().resume,
        jd: slot === 'jd' ? undefined : currentMaterial().jd,
      });
    },
    [patchSession, currentMaterial],
  );

  const visionReady =
    !!settings?.llm.answerWithVision &&
    !!settings?.vision.baseUrl &&
    !!settings?.vision.model &&
    !!settings?.vision.apiKeySet;

  return (
    <I18nProvider lang={settings?.ui.lang}>
    <div className="app">
      <header className="titlebar">
        <span className="brand">MeetingCopilot</span>
        <div className="titlebar-actions">
          <button
            className={capturing ? 'btn btn-live' : 'btn btn-primary'}
            onClick={() => (capturing ? void stopCapture() : void startCapture())}
            disabled={asr.phase !== 'ready'}
            title={
              captureKindForPlatform(window.mc.platform) === 'loopback'
                ? capturing
                  ? t.titlebar.stopTitle
                  : t.titlebar.startTitle
                : capturing
                  ? t.titlebar.stopInputTitle
                  : t.titlebar.startInputTitle
            }
          >
            {capturing ? t.titlebar.stop : t.titlebar.start}
          </button>
          {captureKindForPlatform(window.mc.platform) === 'input' && mics.length > 0 && (
            <select
              className="mic-select"
              value={settings?.audio.themDeviceId ?? ''}
              onChange={(e) => void selectThemInput(e.target.value)}
              title={t.titlebar.themDeviceTitle}
            >
              <option value="">{t.titlebar.themDeviceDefault}</option>
              {mics.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {(m.label || t.titlebar.themDeviceDefault).slice(0, 14)}
                </option>
              ))}
            </select>
          )}
          <button
            className={continuous ? 'btn btn-on' : 'btn'}
            onClick={() => setContinuous((v) => !v)}
            title={t.titlebar.continuousTitle}
          >
            {t.titlebar.continuous}
          </button>
          <button
            className={settings?.llm.answerWithVision ? 'btn btn-on' : 'btn'}
            onClick={() => void toggleAnswerModel()}
            title={t.titlebar.modelTitle}
          >
            {settings?.llm.answerWithVision ? t.titlebar.vision : t.titlebar.textOnly}
          </button>
          <button className="btn" onClick={() => void toggleAnswerLang()} title={t.titlebar.answerLangTitle}>
            {t.titlebar.answerLang(settings?.llm.answerLang === 'english')}
          </button>
          <button
            className={micActive ? 'btn btn-live' : 'btn'}
            onClick={() => void toggleMicCapture()}
            title={t.titlebar.micTitle}
          >
            {micActive ? t.titlebar.micOn : t.titlebar.micOff}
          </button>
          {micActive && mics.length > 0 && (
            <select
              className="mic-select"
              value={settings?.audio.micDeviceId ?? ''}
              onChange={(e) => void selectMic(e.target.value)}
              title={t.titlebar.micDeviceTitle}
            >
              <option value="">{t.titlebar.micDefault}</option>
              {mics.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {(m.label || t.titlebar.micDefault).slice(0, 10)}
                </option>
              ))}
            </select>
          )}
          <button
            className={settings?.ui.stealth ? 'btn btn-on' : 'btn'}
            onClick={() => void toggleStealth()}
            title={
              window.mc.platform === 'darwin'
                ? t.titlebar.stealthMacTitle
                : t.titlebar.stealthTitle
            }
          >
            {t.titlebar.stealth(!!settings?.ui.stealth)}
          </button>
          <button className="btn" onClick={() => setShowHud((v) => !v)} title={t.titlebar.hudTitle}>
            HUD
          </button>
          <button className="btn" onClick={() => setShowSettings((v) => !v)} title={t.titlebar.settingsTitle}>
            ⚙
          </button>
          <button className="btn" onClick={() => window.mc.hide()} title={t.titlebar.hideTitle}>
            —
          </button>
          <button className="btn btn-close" onClick={() => window.mc.quit()} title={t.titlebar.quitTitle}>
            ✕
          </button>
        </div>
      </header>

      {showSettings && settings && (
        <SettingsPanel
          settings={settings}
          onSaved={(s) => {
            setSettings(s);
            answerLangRef.current = s.llm.answerLang;
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      <div className="panes">
        <TranscriptPanel
          segments={segments}
          partials={partials}
          onAsk={(text) => askLlm('segment', text)}
          onTranslate={translateSegment}
          onClear={clearTranscript}
        />
        <AnswerSession
          sessions={sessions}
          currentId={currentId}
          turns={current?.turns ?? []}
          resumeName={current?.resumeName}
          resumeChars={current?.resumeText?.length ?? 0}
          jdName={current?.jdName}
          jdChars={current?.jdText?.length ?? 0}
          notice={kbNotice}
          visionReady={visionReady}
          onSwitch={setCurrentId}
          onNew={createSession}
          onDelete={deleteSession}
          onRename={renameSession}
          onPickKb={(slot) => void pickKb(slot)}
          onClearKb={clearKb}
          onCancel={cancelTurn}
          onClear={() => patchSession(currentIdRef.current, (s) => ({ ...s, turns: [] }))}
          onFreeAsk={(q) => askLlm('free', q)}
          onShotAsk={askShot}
        />
      </div>

      <StatusBar asr={asr} capturing={capturing} hud={showHud ? hud : undefined} />
    </div>
    </I18nProvider>
  );
}
