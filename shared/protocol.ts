/**
 * SDD contract: IPC protocol between main <-> renderer, and the settings schema.
 * Version this file; breaking changes bump PROTOCOL_VERSION.
 */
export const PROTOCOL_VERSION = 1;

// ---------- Settings ----------

export type AsrLanguage = 'auto' | 'chinese' | 'english';
export type AnswerLang = 'chinese' | 'english';
/** who is speaking: the other party (system audio) vs the user (microphone) */
export type Speaker = 'them' | 'me';
/** answer-body font size (right pane only) */
export type FontScale = 'small' | 'medium' | 'large';
/** UI theme; 'system' follows prefers-color-scheme */
export type ThemeMode = 'dark' | 'light' | 'system';
/** UI display language (independent of answerLang, which steers the LLM) */
export type UiLang = 'zh' | 'en';
/** per-session material slots: resume vs job description */
export type KbSlot = 'resume' | 'jd';

export interface SettingsFile {
  version: 1;
  llm: {
    baseUrl: string;
    model: string;
    /** reply language for AI answers (R: 模式选择); default chinese */
    answerLang: AnswerLang;
    /** answer with the vision/multimodal provider instead of the text model */
    answerWithVision?: boolean;
    /** encrypted-at-rest (safeStorage, base64); never exposed raw to renderer */
    apiKeyEnc?: string;
  };
  vision: {
    baseUrl?: string;
    model?: string;
    apiKeyEnc?: string;
    /** proxy for blocked providers (e.g. Gemini): '127.0.0.1:7897'; empty = direct */
    proxyUrl?: string;
  };
  asr: {
    language: AsrLanguage;
    /** override models dir; default %APPDATA%/MeetingCopilot/models */
    modelsDir?: string;
    /** 'local-realtime' = FunASR streaming via the auto-spawned local sidecar;
     * 'local' = whisper turbo on-device; 'cloud' = OpenAI-compatible ASR API;
     * 'cloud-realtime' = remote WebSocket streaming (e.g. Aliyun fun-asr-realtime) */
    backend?: 'local' | 'cloud' | 'cloud-realtime' | 'local-realtime';
    /** cloud ASR provider (used when backend === 'cloud') */
    cloud?: {
      baseUrl?: string;
      model?: string;
      apiKeyEnc?: string;
    };
    /** streaming cloud ASR provider (used when backend === 'cloud-realtime');
     * separate slot so switching backends never clobbers the other's config */
    realtime?: {
      /** wss:// endpoint, e.g. wss://{ws}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference */
      baseUrl?: string;
      model?: string;
      apiKeyEnc?: string;
    };
    /** local streaming sidecar (backend === 'local-realtime'); fixed localhost
     * endpoint, only the model is chosen ('fun-asr-nano' | 'paraformer-zh-streaming') */
    localRealtime?: {
      model?: string;
    };
  };
  ui: {
    stealth: boolean;
    hotkeyToggle: string;
    /** global hotkey for region-screenshot Q&A */
    hotkeyShot: string;
    opacity: number;
    /** answer-body font size (small=13px / medium=16px / large=19px) */
    fontScale: FontScale;
    theme: ThemeMode;
    /** UI display language; absent = follow OS locale (zh → zh, else en) */
    lang?: UiLang;
  };
  audio: {
    /** also capture the microphone (dual-channel transcription: 对方 + 我) */
    micEnabled: boolean;
    /** chosen mic device id ('' / undefined = system default) */
    micDeviceId?: string;
  };
}

/** What the renderer is allowed to see (no secrets). */
export interface PublicSettings {
  version: 1;
  llm: {
    baseUrl: string;
    model: string;
    answerLang: AnswerLang;
    answerWithVision: boolean;
    apiKeySet: boolean;
  };
  vision: { baseUrl?: string; model?: string; proxyUrl?: string; apiKeySet: boolean };
  /** personal knowledge base (resume/notes) loaded from an .md file */
  knowledge: { chars: number };
  asr: {
    language: AsrLanguage;
    modelsDir?: string;
    backend: 'local' | 'cloud' | 'cloud-realtime' | 'local-realtime';
    cloud: { baseUrl?: string; model?: string; apiKeySet: boolean };
    realtime: { baseUrl?: string; model?: string; apiKeySet: boolean };
    localRealtime: { model?: string };
  };
  ui: {
    stealth: boolean;
    hotkeyToggle: string;
    hotkeyShot: string;
    opacity: number;
    fontScale: FontScale;
    theme: ThemeMode;
    lang: UiLang;
  };
  audio: { micEnabled: boolean; micDeviceId?: string };
}

/** Renderer -> main settings update. Plaintext apiKey in transit only. */
export interface SettingsPatch {
  llm?: {
    baseUrl?: string;
    model?: string;
    answerLang?: AnswerLang;
    answerWithVision?: boolean;
    apiKey?: string;
  };
  vision?: { baseUrl?: string; model?: string; proxyUrl?: string; apiKey?: string };
  asr?: {
    language?: AsrLanguage;
    backend?: 'local' | 'cloud' | 'cloud-realtime' | 'local-realtime';
    cloud?: { baseUrl?: string; model?: string; apiKey?: string };
    realtime?: { baseUrl?: string; model?: string; apiKey?: string };
    localRealtime?: { model?: string };
  };
  ui?: {
    stealth?: boolean;
    hotkeyToggle?: string;
    hotkeyShot?: string;
    opacity?: number;
    fontScale?: FontScale;
    theme?: ThemeMode;
    lang?: UiLang;
  };
  audio?: { micEnabled?: boolean; micDeviceId?: string };
}

// ---------- ASR events (main -> renderer) ----------

export interface SegmentTimings {
  /** Date.now() of the first speech sample of the segment */
  speechStartTs: number;
  /** Date.now() of the last audio sample of the segment (speech end) */
  speechEndTs: number;
  /** when VAD closed the segment (speechEndTs + hangover) */
  vadCloseTs: number;
  inferStartTs: number;
  inferEndTs: number;
}

export interface AsrSegmentEvent {
  kind: 'segment';
  id: number;
  text: string;
  lang?: string;
  speaker: Speaker;
  audioMs: number;
  timings: SegmentTimings;
}

export interface AsrReadyEvent {
  kind: 'ready';
  loadMs: number;
  warmMs: number;
  ep: string;
  gpuSuspect: boolean; // true when warm timing suggests CPU fallback
}

export interface AsrStatusEvent {
  kind: 'status';
  state: 'loading' | 'listening' | 'speech' | 'transcribing' | 'stopped';
  queuedSegments: number;
}

export interface AsrErrorEvent {
  kind: 'error';
  message: string;
  fatal: boolean;
}

/** live streaming partial (transient; replaced by the final segment) */
export interface AsrPartialEvent {
  kind: 'partial';
  speaker: Speaker;
  text: string;
}

export type AsrEvent =
  | AsrSegmentEvent
  | AsrPartialEvent
  | AsrReadyEvent
  | AsrStatusEvent
  | AsrErrorEvent;

// ---------- Sessions (multi-conversation, persisted) ----------

export interface StoredTurn {
  id: string;
  kind: 'segment' | 'continuous' | 'free' | 'translate' | 'vision';
  label: string;
  text: string;
  status: 'streaming' | 'done' | 'error';
  error?: string;
}

export interface StoredSession {
  id: string;
  name: string;
  createdAt: number;
  turns: StoredTurn[];
  /** per-session transcript (isolated per meeting, same as the conversation) */
  segments?: import('./transcript').TranscriptSegment[];
  /** true once named (auto from first question, or manually renamed) */
  titled?: boolean;
  /** legacy single-slot KB (pre dual-slot); migrated to the resume slot on load */
  kbName?: string;
  kbText?: string;
  /** dual-slot session material: resume + job description (P0-2) */
  resumeName?: string;
  resumeText?: string;
  jdName?: string;
  jdText?: string;
  /** rolling interview memo (P1): ≤800-char structured summary, async-updated */
  memo?: string;
}

export interface SessionsFile {
  sessions: StoredSession[];
  currentId: string | null;
}

// ---------- LLM (R4): renderer <-> main ----------

export interface LlmAskPayload {
  requestId: string;
  mode: 'segment' | 'continuous' | 'free' | 'translate';
  /** the sentence to answer (segment) or text to translate (translate) */
  question?: string;
  /** free-form question (mode === 'free') */
  freeQuestion?: string;
  /** recent transcript lines, oldest first */
  recentTranscript: string[];
  /** reply language for segment/continuous/free (translate is always zh) */
  answerLang?: AnswerLang;
  /** prior Q&A turns for session coherence (oldest first) */
  history?: { role: 'user' | 'assistant'; content: string }[];
  /** legacy single-slot KB (kept for compat; treated as resume material) */
  background?: string;
  /** dual-slot session material (P0-2) */
  resume?: string;
  jd?: string;
  /** rolling interview memo (P1) */
  memo?: string;
}

export type LlmEvent =
  | { requestId: string; kind: 'delta'; text: string }
  | { requestId: string; kind: 'done'; text: string }
  | { requestId: string; kind: 'error'; message: string };

// ---------- IPC channel names ----------

export const IPC = {
  /** renderer -> main, fire and forget: (ArrayBuffer pcmF32, captureTs, Speaker) */
  capturePcm: 'capture:pcm',
  /** invoke: (text) => string — cheap one-shot translation to Chinese (inline, off-session) */
  translateText: 'llm:translate',
  /** renderer -> main: capture lifecycle */
  captureStarted: 'capture:started',
  captureStopped: 'capture:stopped',
  /** main -> renderer: AsrEvent */
  asrEvent: 'asr:event',
  /** invoke: () => {ready, status} — pull the last ready/status AsrEvents.
   * Cloud engines are ready in ms, BEFORE React subscribes; push-replay on
   * did-finish-load still races the subscription, so the renderer pulls. */
  asrReplay: 'asr:replay',
  /** invoke: () => PublicSettings */
  settingsGet: 'settings:get',
  /** invoke: (SettingsPatch) => PublicSettings */
  settingsSet: 'settings:set',
  /** invoke: () => {chars:number} — import a .md into the GLOBAL default KB (opens dialog) */
  knowledgeImport: 'knowledge:import',
  /** invoke: () => {chars:number} — clear the global default KB */
  knowledgeClear: 'knowledge:clear',
  /** invoke: (KbSlot) => {name,text,chars} | null — pick a resume/JD document
   * (.md/.txt/.docx/.pdf, parsed deterministically) for the CURRENT session */
  knowledgePick: 'knowledge:pick',
  /** invoke: () => SessionsFile — load persisted sessions */
  sessionsLoad: 'sessions:load',
  /** send: (SessionsFile) — persist sessions (debounced by renderer) */
  sessionsSave: 'sessions:save',
  /** invoke: () => string|null — full-screen capture, drag a region (stealth overlay), returns cropped dataURL */
  regionPick: 'region:pick',
  /** invoke (overlay→main): () => string|null — the captured full-screen image to draw */
  regionImage: 'region:image',
  /** send (overlay→main): (rect) — chosen region */
  regionRect: 'region:rect',
  /** send (overlay→main): () — cancel selection */
  regionCancel: 'region:cancel',
  /** invoke: (boolean) => boolean — toggles content protection live */
  stealthSet: 'stealth:set',
  /** send: hide window */
  winHide: 'win:hide',
  /** send: quit app (clean) */
  appQuit: 'app:quit',
  /** main -> renderer: request auto start capture (dev/E2E) */
  autoStart: 'capture:auto-start',
  /** main -> renderer: the screenshot hotkey was pressed */
  shotHotkey: 'shot:hotkey',
  /** renderer -> main: start a streaming answer (LlmAskPayload) */
  llmAsk: 'llm:ask',
  /** renderer -> main: screenshot + vision question ({requestId, question}); answer streams on llmEvent */
  shotAsk: 'shot:ask',
  /** renderer -> main: cancel a running request (requestId) */
  llmCancel: 'llm:cancel',
  /** main -> renderer: LlmEvent stream */
  llmEvent: 'llm:event',
  /** send: ({resume?, jd?}) — warm the DeepSeek KV prefix cache (P1-6):
   * one max_tokens=1 request whose system prompt is byte-identical to real
   * answer requests, so the first real question prefills from cache */
  llmPrewarm: 'llm:prewarm',
  /** invoke: ({memo, question, answer}) => string — async rolling interview
   * memo update (P1-5); cheap off-critical-path deepseek-chat call, '' = keep old */
  memoUpdate: 'llm:memo',
} as const;
