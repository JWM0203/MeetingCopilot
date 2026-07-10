import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type AsrEvent,
  type KbSlot,
  type LlmAskPayload,
  type LlmEvent,
  type PublicSettings,
  type SessionsFile,
  type SettingsPatch,
} from '../shared/protocol';

export interface McApi {
  getSettings(): Promise<PublicSettings>;
  setSettings(patch: SettingsPatch): Promise<PublicSettings>;
  importKnowledge(): Promise<{ chars: number }>;
  clearKnowledge(): Promise<{ chars: number }>;
  /** pick a resume/JD document for the current session (.md/.txt/.docx/.pdf) */
  pickKnowledge(slot: KbSlot): Promise<{ name: string; text: string; chars: number } | null>;
  loadSessions(): Promise<SessionsFile>;
  saveSessions(data: SessionsFile): void;
  setStealth(on: boolean): Promise<boolean>;
  sendPcm(buf: ArrayBuffer, captureTs: number, channel: 'them' | 'me'): void;
  captureStarted(): void;
  captureStopped(): void;
  translate(text: string): Promise<string>;
  onAsrEvent(cb: (ev: AsrEvent) => void): () => void;
  /** pull the last ready/status events (call AFTER onAsrEvent subscription) */
  asrReplay(): Promise<{ ready: AsrEvent | null; status: AsrEvent | null }>;
  llmAsk(payload: LlmAskPayload): void;
  shotAsk(payload: {
    requestId: string;
    question: string;
    background?: string;
    imageDataUrl?: string;
  }): void;
  /** capture full screen, drag a stealth region overlay; returns cropped dataURL or null */
  pickRegion(): Promise<string | null>;
  /** overlay-only: fetch the captured background image */
  regionImage(): Promise<string | null>;
  /** overlay-only: report chosen rect */
  regionRect(r: { x: number; y: number; width: number; height: number }): void;
  /** overlay-only: cancel */
  regionCancel(): void;
  llmCancel(requestId: string): void;
  /** P1-6: warm the DeepSeek prefix cache with the session's material;
   * immediate=true warms even when not capturing (▶ start / material import) */
  prewarm(payload: { resume?: string; jd?: string; immediate?: boolean }): void;
  /** P1-5: fold a finished Q&A into the rolling memo ('' = keep the old one) */
  memoUpdate(p: { memo: string; question: string; answer: string }): Promise<string>;
  onLlmEvent(cb: (ev: LlmEvent) => void): () => void;
  onShotHotkey(cb: () => void): () => void;
  hide(): void;
  quit(): void;
}

const api: McApi = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  importKnowledge: () => ipcRenderer.invoke(IPC.knowledgeImport),
  clearKnowledge: () => ipcRenderer.invoke(IPC.knowledgeClear),
  pickKnowledge: (slot) => ipcRenderer.invoke(IPC.knowledgePick, slot),
  loadSessions: () => ipcRenderer.invoke(IPC.sessionsLoad),
  saveSessions: (data) => ipcRenderer.send(IPC.sessionsSave, data),
  setStealth: (on) => ipcRenderer.invoke(IPC.stealthSet, on),
  sendPcm: (buf, captureTs, channel) => ipcRenderer.send(IPC.capturePcm, buf, captureTs, channel),
  captureStarted: () => ipcRenderer.send(IPC.captureStarted),
  captureStopped: () => ipcRenderer.send(IPC.captureStopped),
  translate: (text) => ipcRenderer.invoke(IPC.translateText, text),
  onAsrEvent: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: AsrEvent) => cb(ev);
    ipcRenderer.on(IPC.asrEvent, listener);
    return () => ipcRenderer.removeListener(IPC.asrEvent, listener);
  },
  asrReplay: () => ipcRenderer.invoke(IPC.asrReplay),
  llmAsk: (payload) => ipcRenderer.send(IPC.llmAsk, payload),
  shotAsk: (payload) => ipcRenderer.send(IPC.shotAsk, payload),
  pickRegion: () => ipcRenderer.invoke(IPC.regionPick),
  regionImage: () => ipcRenderer.invoke(IPC.regionImage),
  regionRect: (r) => ipcRenderer.send(IPC.regionRect, r),
  regionCancel: () => ipcRenderer.send(IPC.regionCancel),
  llmCancel: (requestId) => ipcRenderer.send(IPC.llmCancel, requestId),
  prewarm: (payload) => ipcRenderer.send(IPC.llmPrewarm, payload),
  memoUpdate: (p) => ipcRenderer.invoke(IPC.memoUpdate, p),
  onLlmEvent: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: LlmEvent) => cb(ev);
    ipcRenderer.on(IPC.llmEvent, listener);
    return () => ipcRenderer.removeListener(IPC.llmEvent, listener);
  },
  onShotHotkey: (cb) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.shotHotkey, listener);
    return () => ipcRenderer.removeListener(IPC.shotHotkey, listener);
  },
  hide: () => ipcRenderer.send(IPC.winHide),
  quit: () => ipcRenderer.send(IPC.appQuit),
};

contextBridge.exposeInMainWorld('mc', api);
