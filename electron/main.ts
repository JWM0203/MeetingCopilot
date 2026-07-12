/**
 * MeetingCopilot main process: overlay window, stealth, hotkeys,
 * settings, IPC hub, ASR worker host. PLAN.en.md §5.
 */
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  safeStorage,
  screen,
  session,
} from 'electron';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  captureKindForPlatform,
  whisperExecutionProvidersForPlatform,
} from '../shared/platform';
import { AsrHost } from './asrHost';
import { FunasrSidecar, parseLocalWsPort } from './funasrSidecar';
import { SettingsStore, plainCipher, type SecretCipher } from './settings';
import { KnowledgeStore } from './knowledge';
import { SessionStore } from './sessions';
import { DOC_EXTENSIONS, extractDocText } from './docparse';
import { basename } from 'path';
import { chatOnce, chatStream, type ChatResult } from './llm/adapter';
import { visionChat } from './llm/vision';
import {
  buildAnswerMessages,
  buildMemoUpdateMessages,
  buildPrewarmMessages,
  buildStablePrefix,
  buildTranslateMessages,
  buildVisionMessages,
  clampMemo,
} from './llm/prompts';
import type { PublicSettings, UiLang } from '../shared/protocol';
import {
  IPC,
  type AsrEvent,
  type LlmAskPayload,
  type LlmEvent,
  type SettingsPatch,
} from '../shared/protocol';
import { mainStrings } from './uiStrings';

const MODEL_ID = 'onnx-community/whisper-large-v3-turbo-ONNX';

/** Region-selection overlay: shows the captured screen as an opaque bg (so a
 * content-protected window never renders black locally) and lets the user drag
 * a rectangle. Uses window.mc from the shared preload. */
const regionOverlayHtml = (tip: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;cursor:crosshair;user-select:none}
#img{position:fixed;inset:0;width:100vw;height:100vh;object-fit:fill}
#dim{position:fixed;inset:0;background:rgba(0,0,0,0.35)}
#sel{position:fixed;display:none;border:2px solid #2a6df4;box-shadow:0 0 0 9999px rgba(0,0,0,0.35)}
#tip{position:fixed;top:14px;left:50%;transform:translateX(-50%);color:#fff;background:rgba(0,0,0,0.65);padding:6px 14px;border-radius:8px;font:13px 'Microsoft YaHei',sans-serif;z-index:9}
</style></head><body>
<img id="img"/><div id="dim"></div><div id="sel"></div>
<div id="tip">${tip}</div>
<script>
(async()=>{try{const u=await window.mc.regionImage();if(u){document.getElementById('img').src=u;}}catch(e){}})();
let sx,sy,drag=false;const sel=document.getElementById('sel'),dim=document.getElementById('dim');
function rect(e){return{x:Math.min(sx,e.clientX),y:Math.min(sy,e.clientY),width:Math.abs(e.clientX-sx),height:Math.abs(e.clientY-sy)};}
function upd(e){const r=rect(e);sel.style.left=r.x+'px';sel.style.top=r.y+'px';sel.style.width=r.width+'px';sel.style.height=r.height+'px';}
addEventListener('mousedown',e=>{drag=true;sx=e.clientX;sy=e.clientY;dim.style.display='none';sel.style.display='block';upd(e);});
addEventListener('mousemove',e=>{if(drag)upd(e);});
addEventListener('mouseup',e=>{if(!drag)return;drag=false;const r=rect(e);if(r.width>4&&r.height>4)window.mc.regionRect(r);else window.mc.regionCancel();});
addEventListener('keydown',e=>{if(e.key==='Escape')window.mc.regionCancel();});
</script></body></html>`;

app.setName('MeetingCopilot');

// E2E/demo hook: run against an isolated profile — must precede the
// single-instance lock so a test instance never collides with a real one
if (process.env.MC_USERDATA) app.setPath('userData', process.env.MC_USERDATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap(): void {
  let win: BrowserWindow | null = null;
  let settings: SettingsStore;
  let knowledge: KnowledgeStore;
  let sessionStore: SessionStore;
  let osLang: UiLang = 'zh';
  const asr = new AsrHost();
  const sidecar = new FunasrSidecar();

  /** main-process strings in the current UI language */
  const T = () => mainStrings(settings.data.ui.lang, osLang);

  /** getPublic() + real knowledge char count (KB lives outside settings.json) */
  function publicSettings(): PublicSettings {
    const pub = settings.getPublic();
    pub.knowledge = { chars: knowledge.chars };
    return pub;
  }

  function buildAsrOptions() {
    const a = settings.data.asr;
    const backend = a.backend ?? 'local';
    // each backend has its own config slot so switching never clobbers the others
    let cloud: { baseUrl: string; model: string; apiKey: string } | undefined;
    if (backend === 'local-realtime') {
      // fixed localhost sidecar (auto-spawned); only the model is a choice
      cloud = {
        baseUrl: 'ws://127.0.0.1:10097',
        model: a.localRealtime?.model ?? 'fun-asr-nano',
        apiKey: '',
      };
    } else if (backend === 'cloud-realtime') {
      const rtKey = settings.getRealtimeAsrApiKey() ?? '';
      if (a.realtime?.baseUrl && a.realtime?.model && rtKey) {
        cloud = { baseUrl: a.realtime.baseUrl, model: a.realtime.model, apiKey: rtKey };
      }
    } else if (a.cloud?.baseUrl && a.cloud?.model && settings.getCloudAsrApiKey()) {
      cloud = { baseUrl: a.cloud.baseUrl, model: a.cloud.model, apiKey: settings.getCloudAsrApiKey()! };
    }
    return {
      // the worker treats both realtime flavors identically (same WS engine)
      backend: (backend === 'local-realtime' ? 'cloud-realtime' : backend) as
        | 'local'
        | 'cloud'
        | 'cloud-realtime',
      modelsDir: a.modelsDir ?? join(app.getPath('userData'), 'models'),
      modelId: MODEL_ID,
      ep: whisperExecutionProvidersForPlatform(process.platform),
      language: a.language,
      cloud,
    };
  }

  /** start the ASR worker; a local ws:// realtime backend auto-spawns the
   * python sidecar first (selecting the preset is all the user does) */
  async function startAsr(): Promise<void> {
    const opts = buildAsrOptions();
    const port = opts.backend === 'cloud-realtime' ? parseLocalWsPort(opts.cloud?.baseUrl) : null;
    if (port) {
      try {
        await sidecar.ensureRunning(port, app.getAppPath(), opts.cloud?.model);
        console.log(`[sidecar] local funasr ready on :${port}`);
      } catch (e) {
        const message = T().sidecarFail((e as Error).message);
        console.error(`[sidecar] ${message}`);
        win?.webContents.send(IPC.asrEvent, { kind: 'error', message, fatal: true });
        return;
      }
    } else {
      await sidecar.stop(); // switched away from local — reclaim its RAM/VRAM
    }
    asr.start(opts);
  }

  const safeCipher: SecretCipher = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
  };

  function cipher(): SecretCipher {
    if (safeCipher.available()) return safeCipher;
    console.warn('[security] OS secret storage unavailable; API keys will only be obfuscated');
    return plainCipher;
  }

  function registerHotkeys(): void {
    globalShortcut.unregisterAll();
    const toggle = settings.data.ui.hotkeyToggle;
    const shot = settings.data.ui.hotkeyShot;
    try {
      if (toggle) {
        const ok = globalShortcut.register(toggle, () => {
          if (!win) return;
          if (win.isVisible()) win.hide();
          else {
            win.show();
            win.focus();
          }
        });
        if (!ok) console.warn(`[main] hotkey ${toggle} registration failed (in use?)`);
      }
      if (shot) {
        const ok = globalShortcut.register(shot, () => win?.webContents.send(IPC.shotHotkey));
        if (!ok) console.warn(`[main] shot hotkey ${shot} registration failed (in use?)`);
      }
    } catch (e) {
      console.warn('[main] hotkey register error:', (e as Error).message);
    }
  }

  function createWindow(): void {
    win = new BrowserWindow({
      width: 940,
      height: 560,
      minWidth: 640,
      minHeight: 380,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      resizable: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(settings.data.ui.stealth);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());

    win.webContents.on('did-finish-load', () => {
      // replay cached ASR state for late-attaching renderer
      if (asr.lastReady) win?.webContents.send(IPC.asrEvent, asr.lastReady);
      if (asr.lastStatus) win?.webContents.send(IPC.asrEvent, asr.lastStatus);
      if (process.env.MC_AUTOSTART === '1') {
        // executeJavaScript(code, true) supplies the user gesture that
        // getDisplayMedia needs — used by the E2E smoke test.
        void win?.webContents.executeJavaScript(
          'window.__mcAutoStart && window.__mcAutoStart()',
          true,
        );
      }
      // E2E: exercise the FULL renderer->IPC->main->LLM->stream->renderer path.
      if (process.env.MC_E2E_LLM) {
        const q = process.env.MC_E2E_LLM;
        const js = `(async()=>{const d=[];const done=new Promise(r=>{const off=window.mc.onLlmEvent(e=>{if(e.kind==='delta')d.push(e.text);else if(e.kind==='done'){off();r({ok:true,text:e.text||d.join('')});}else if(e.kind==='error'){off();r({ok:false,error:e.message});}});});window.mc.llmAsk({requestId:'e2e-llm',mode:'free',freeQuestion:${JSON.stringify(q)},recentTranscript:[]});return await done;})()`;
        void win?.webContents
          .executeJavaScript(js, true)
          .then((r) => console.log('[e2e-llm]', JSON.stringify(r)))
          .catch((e) => console.log('[e2e-llm] threw', (e as Error).message));
      }
      if (process.env.MC_E2E_SHOT) {
        const q = process.env.MC_E2E_SHOT;
        const js = `(async()=>{const d=[];const done=new Promise(r=>{const off=window.mc.onLlmEvent(e=>{if(e.kind==='delta')d.push(e.text);else if(e.kind==='done'){off();r({ok:true,text:e.text||d.join('')});}else if(e.kind==='error'){off();r({ok:false,error:e.message});}});});window.mc.shotAsk({requestId:'e2e-shot',question:${JSON.stringify(q)}});return await done;})()`;
        void win?.webContents
          .executeJavaScript(js, true)
          .then((r) => console.log('[e2e-shot]', JSON.stringify(r)))
          .catch((e) => console.log('[e2e-shot] threw', (e as Error).message));
      }
    });

    win.on('closed', () => {
      win = null;
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'));
    }
  }

  app.whenReady().then(() => {
    // users who never chose a UI language get their OS language (zh → zh, else en)
    osLang = app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
    settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), cipher(), osLang);
    knowledge = new KnowledgeStore(join(app.getPath('userData'), 'knowledge.md'));
    sessionStore = new SessionStore(join(app.getPath('userData'), 'sessions.json'));

    // Electron's `audio: loopback` display-media source is Windows-only.
    // macOS/Linux use a selectable ordinary input in the renderer instead.
    if (captureKindForPlatform(process.platform) === 'loopback') {
      session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
        desktopCapturer
          .getSources({ types: ['screen'] })
          .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
          .catch((e) => {
            console.error('[main] display media handler failed:', e);
            callback({});
          });
      });
    }

    // ---- IPC ----
    ipcMain.on(IPC.capturePcm, (_e, buf: ArrayBuffer, captureTs: number, channel: 'them' | 'me') => {
      asr.sendPcm(buf, captureTs, channel === 'me' ? 'me' : 'them');
    });

    // ---- P1-6: DeepSeek prefix-cache prewarm + keep-warm while capturing ----
    // One max_tokens=1 request with the byte-identical stable prefix builds the
    // provider-side KV cache, so the first real answer prefills at 0.1x price
    // and lower latency. Re-ping when the cache would go cold (same pattern as
    // the ASR 45s keep-warm). Real answer requests refresh the cache themselves.
    const PREWARM_IDLE_MS = 4 * 60_000;
    let lastPrefix: string | null = null;
    let lastPrefixActivity = 0; // last time the answer prefix hit the provider
    let capturing = false;
    let keepWarmTimer: NodeJS.Timeout | null = null;

    /** same material fallback as llmAsk — prewarm MUST match real requests byte-for-byte */
    function stablePrefixFor(resume?: string, jd?: string): string {
      const hasMaterial = !!(resume || jd);
      const effResume = resume || (hasMaterial ? '' : knowledge.text);
      return buildStablePrefix(effResume, jd ?? '', settings.data.llm.answerLang);
    }

    async function doPrewarm(prefix: string, reason: string): Promise<void> {
      const apiKey = settings.getLlmApiKey();
      if (!apiKey || settings.data.llm.answerWithVision) return; // vision path ≠ DeepSeek
      lastPrefix = prefix;
      lastPrefixActivity = Date.now();
      try {
        const r = await chatOnce(
          { baseUrl: settings.data.llm.baseUrl, model: settings.data.llm.model, apiKey },
          buildPrewarmMessages(prefix),
          { maxTokens: 1 },
        );
        console.log(
          `[prewarm] ${reason}: cache_hit=${r.usage?.prompt_cache_hit_tokens ?? '?'} cache_miss=${r.usage?.prompt_cache_miss_tokens ?? '?'} prompt=${r.usage?.prompt_tokens ?? '?'}`,
        );
      } catch (e) {
        console.warn('[prewarm] failed:', (e as Error).message);
      }
    }

    ipcMain.on(
      IPC.llmPrewarm,
      (_e, payload: { resume?: string; jd?: string; immediate?: boolean } = {}) => {
        const prefix = stablePrefixFor(payload.resume, payload.jd);
        const dirty = prefix !== lastPrefix;
        const cold = Date.now() - lastPrefixActivity >= PREWARM_IDLE_MS;
        if (!dirty && !cold) return;
        if (payload.immediate || capturing) {
          void doPrewarm(prefix, dirty ? 'dirty' : 'refresh');
        } else {
          lastPrefix = null; // mark stale; the next ▶ prewarm sees dirty and reheats
        }
      },
    );

    ipcMain.on(IPC.captureStarted, () => {
      console.log('[main] capture started');
      capturing = true;
      if (!keepWarmTimer) {
        keepWarmTimer = setInterval(() => {
          if (!capturing || !lastPrefix) return;
          if (Date.now() - lastPrefixActivity >= PREWARM_IDLE_MS) {
            void doPrewarm(lastPrefix, 'keep-warm');
          }
        }, 60_000);
      }
    });
    ipcMain.on(IPC.captureStopped, () => {
      console.log('[main] capture stopped');
      capturing = false;
      if (keepWarmTimer) {
        clearInterval(keepWarmTimer);
        keepWarmTimer = null;
      }
      asr.flush();
    });
    ipcMain.handle(IPC.settingsGet, () => publicSettings());
    // pull-based replay: renderer asks after subscribing, so instant-ready
    // cloud engines can't race the subscription (stuck "模型加载中" bug)
    ipcMain.handle(IPC.asrReplay, () => ({ ready: asr.lastReady, status: asr.lastStatus }));
    ipcMain.handle(IPC.settingsSet, (_e, patch: SettingsPatch) => {
      settings.applyPatch(patch);
      if (patch.ui?.hotkeyToggle !== undefined || patch.ui?.hotkeyShot !== undefined) {
        registerHotkeys();
      }
      if (patch.ui?.stealth !== undefined) {
        win?.setContentProtection(patch.ui.stealth);
      }
      // backend/cloud change => rebuild the ASR worker with the new engine.
      // language alone can hot-update without a restart.
      if (
        patch.asr &&
        (patch.asr.backend !== undefined ||
          patch.asr.cloud !== undefined ||
          patch.asr.realtime !== undefined ||
          patch.asr.localRealtime !== undefined)
      ) {
        void asr.stop().then(() => startAsr());
      } else if (patch.asr?.language) {
        asr.setLanguage(patch.asr.language);
      }
      return publicSettings();
    });
    ipcMain.handle(IPC.knowledgeImport, async () => {
      const r = await dialog.showOpenDialog({
        title: T().kbImportTitle,
        filters: [{ name: 'Markdown/Text', extensions: ['md', 'markdown', 'txt'] }],
        properties: ['openFile'],
      });
      if (!r.canceled && r.filePaths[0]) {
        try {
          knowledge.setFromText(readFileSync(r.filePaths[0], 'utf8'));
        } catch (e) {
          console.error('[knowledge] import failed:', (e as Error).message);
        }
      }
      return { chars: knowledge.chars };
    });
    ipcMain.handle(IPC.knowledgeClear, () => {
      knowledge.clear();
      return { chars: knowledge.chars };
    });
    ipcMain.handle(IPC.knowledgePick, async (_e, slot: 'resume' | 'jd' = 'resume') => {
      const r = await dialog.showOpenDialog({
        title: slot === 'jd' ? T().pickJdTitle : T().pickResumeTitle,
        filters: [{ name: T().docFilter, extensions: [...DOC_EXTENSIONS] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      try {
        // deterministic parse (mammoth / pdf-parse) — no LLM in the loop;
        // '' for scanned PDFs, the renderer warns the user
        const text = await extractDocText(r.filePaths[0]);
        return { name: basename(r.filePaths[0]), text, chars: text.length };
      } catch (e) {
        console.error('[knowledge] pick failed:', (e as Error).message);
        return null;
      }
    });
    ipcMain.handle(IPC.sessionsLoad, () => sessionStore.load());
    ipcMain.on(IPC.sessionsSave, (_e, data) => sessionStore.save(data));

    // ---- region screenshot: capture full screen, let the user drag a region
    // on a STEALTH overlay that shows the capture as its (opaque) background —
    // avoids the transparent-window black-screen bug and is excluded from
    // recording via content protection. Returns the cropped image dataURL. ----
    let regionResolve: ((r: { x: number; y: number; width: number; height: number } | null) => void) | null = null;
    let pendingRegionImage: string | null = null;
    let regionWin: BrowserWindow | null = null;

    ipcMain.handle(IPC.regionImage, () => pendingRegionImage);
    ipcMain.on(IPC.regionRect, (_e, r) => {
      const f = regionResolve;
      regionResolve = null;
      regionWin?.close();
      f?.(r);
    });
    ipcMain.on(IPC.regionCancel, () => {
      const f = regionResolve;
      regionResolve = null;
      regionWin?.close();
      f?.(null);
    });

    ipcMain.handle(IPC.regionPick, async () => {
      const disp = screen.getPrimaryDisplay();
      const sf = disp.scaleFactor;
      const w = Math.round(disp.size.width * sf);
      const h = Math.round(disp.size.height * sf);
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
      const src = sources.find((s) => s.display_id === String(disp.id)) ?? sources[0];
      if (!src) return null;
      const full = src.thumbnail;
      pendingRegionImage = full.toDataURL();

      const rect = await new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
        regionResolve = resolve;
        const b = disp.bounds;
        const ov = new BrowserWindow({
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          frame: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          hasShadow: false,
          resizable: false,
          movable: false,
          fullscreenable: false,
          enableLargerThanScreen: true,
          webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true },
        });
        regionWin = ov;
        ov.setContentProtection(true); // selection overlay invisible to recording
        ov.setAlwaysOnTop(true, 'screen-saver');
        ov.on('closed', () => {
          if (regionResolve) {
            const f = regionResolve;
            regionResolve = null;
            f(null);
          }
          regionWin = null;
        });
        void ov.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(regionOverlayHtml(T().regionTip)));
      });

      const img = pendingRegionImage;
      pendingRegionImage = null;
      if (!rect || rect.width < 4 || rect.height < 4 || !img) return null;
      try {
        const cropped = full.crop({
          x: Math.round(rect.x * sf),
          y: Math.round(rect.y * sf),
          width: Math.round(rect.width * sf),
          height: Math.round(rect.height * sf),
        });
        return cropped.toDataURL();
      } catch (e) {
        console.error('[region] crop failed:', (e as Error).message);
        return null;
      }
    });
    ipcMain.handle(IPC.stealthSet, (_e, on: boolean) => {
      settings.applyPatch({ ui: { stealth: on } });
      win?.setContentProtection(on);
      return on;
    });
    ipcMain.on(IPC.winHide, () => win?.hide());
    ipcMain.on(IPC.appQuit, () => app.quit());

    // ---- LLM (R4): streaming answers; key stays in the main process ----
    const llmControllers = new Map<string, AbortController>();
    ipcMain.on(IPC.llmAsk, (_e, payload: LlmAskPayload) => {
      const sendEv = (ev: LlmEvent) => win?.webContents.send(IPC.llmEvent, ev);
      const apiKey = settings.getLlmApiKey();
      if (!apiKey) {
        sendEv({ requestId: payload.requestId, kind: 'error', message: T().noApiKey });
        return;
      }
      const ac = new AbortController();
      llmControllers.set(payload.requestId, ac);
      const isTranslate = payload.mode === 'translate';
      // session dual-slot material first; the global default KB only fills in
      // when the session has nothing (translate stays a clean pass-through)
      const hasMaterial = !!(payload.resume || payload.jd || payload.background);
      const messages = buildAnswerMessages({
        mode: payload.mode,
        question: payload.question,
        freeQuestion: payload.freeQuestion,
        recentTranscript: payload.recentTranscript,
        answerLang: payload.answerLang ?? settings.data.llm.answerLang,
        history: payload.history,
        resume: isTranslate ? undefined : payload.resume,
        jd: isTranslate ? undefined : payload.jd,
        memo: isTranslate ? undefined : payload.memo,
        background: isTranslate ? undefined : payload.background || (hasMaterial ? undefined : knowledge.text),
      });

      // "answer with multimodal": route through the vision provider (proxy-aware,
      // non-streaming). Otherwise stream from the text LLM (direct, fastest).
      const useVision =
        settings.data.llm.answerWithVision &&
        payload.mode !== 'translate' &&
        !!settings.data.vision.baseUrl &&
        !!settings.data.vision.model &&
        !!settings.getVisionApiKey();

      // a real answer request refreshes the provider-side prefix cache itself
      if (!isTranslate && !useVision && payload.mode !== 'free') {
        lastPrefix = stablePrefixFor(payload.resume || payload.background, payload.jd);
        lastPrefixActivity = Date.now();
      }

      const work = useVision
        ? visionChat(
            {
              baseUrl: settings.data.vision.baseUrl!,
              model: settings.data.vision.model!,
              apiKey: settings.getVisionApiKey()!,
              proxyUrl: settings.data.vision.proxyUrl,
            },
            messages,
            ac.signal,
          ).then((text) => {
            sendEv({ requestId: payload.requestId, kind: 'delta', text });
            return { text };
          })
        : chatStream(
            { baseUrl: settings.data.llm.baseUrl, model: settings.data.llm.model, apiKey },
            messages,
            { onDelta: (text) => sendEv({ requestId: payload.requestId, kind: 'delta', text }) },
            ac.signal,
          );

      work
        .then((r) => {
          const u = (r as ChatResult).usage;
          if (u) {
            // prewarm acceptance signal: after a warm, hit ≈ prefix length
            console.log(
              `[llm] done mode=${payload.mode} cache_hit=${u.prompt_cache_hit_tokens ?? '?'} cache_miss=${u.prompt_cache_miss_tokens ?? '?'}`,
            );
          }
          sendEv({ requestId: payload.requestId, kind: 'done', text: r.text });
        })
        .catch((e: Error) => {
          if (ac.signal.aborted) return; // user cancelled — not an error
          console.error('[llm] request failed:', e.message);
          sendEv({ requestId: payload.requestId, kind: 'error', message: e.message });
        })
        .finally(() => llmControllers.delete(payload.requestId));
    });
    ipcMain.on(IPC.llmCancel, (_e, requestId: string) => {
      llmControllers.get(requestId)?.abort();
      llmControllers.delete(requestId);
    });

    // P1-5: fold a finished Q&A into the rolling interview memo. Async and
    // off the critical answer path — renderer serializes calls per session.
    ipcMain.handle(
      IPC.memoUpdate,
      async (_e, p: { memo: string; question: string; answer: string }): Promise<string> => {
        const apiKey = settings.getLlmApiKey();
        if (!apiKey) return '';
        try {
          const r = await chatOnce(
            { baseUrl: settings.data.llm.baseUrl, model: settings.data.llm.model, apiKey },
            buildMemoUpdateMessages(p.memo ?? '', p.question ?? '', p.answer ?? ''),
            { maxTokens: 700, temperature: 0.2 },
          );
          return clampMemo(r.text);
        } catch (e) {
          console.warn('[memo] update failed:', (e as Error).message);
          return '';
        }
      },
    );

    // Cheap one-shot translation to Chinese (inline transcript 对照; off-session,
    // no history pollution). Uses the fast text model (deepseek-chat).
    ipcMain.handle(IPC.translateText, async (_e, text: string) => {
      const apiKey = settings.getLlmApiKey();
      if (!apiKey) throw new Error(T().noApiKeyShort);
      const r = await chatStream(
        { baseUrl: settings.data.llm.baseUrl, model: settings.data.llm.model, apiKey },
        buildTranslateMessages(text),
        { onDelta: () => {} },
      );
      return r.text;
    });

    // ---- R5: screenshot -> vision model. Our own window is excluded from
    // the capture automatically (content protection). ----
    ipcMain.on(
      IPC.shotAsk,
      (_e, payload: { requestId: string; question: string; background?: string; imageDataUrl?: string }) => {
      const sendEv = (ev: LlmEvent) => win?.webContents.send(IPC.llmEvent, ev);
      const vision = settings.data.vision;
      const apiKey = settings.getVisionApiKey();
      if (!vision.baseUrl || !vision.model || !apiKey) {
        sendEv({
          requestId: payload.requestId,
          kind: 'error',
          message: T().noVision,
        });
        return;
      }
      const ac = new AbortController();
      llmControllers.set(payload.requestId, ac);
      // region mode provides a pre-cropped image; else capture the full screen
      const imgP = payload.imageDataUrl
        ? Promise.resolve(payload.imageDataUrl)
        : desktopCapturer
            .getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 900 } })
            .then((sources) => sources[0].thumbnail.toDataURL());
      imgP
        .then((dataUrl) =>
          visionChat(
            { baseUrl: vision.baseUrl!, model: vision.model!, apiKey, proxyUrl: vision.proxyUrl },
            buildVisionMessages(payload.question, dataUrl, payload.background || knowledge.text),
            ac.signal,
          ),
        )
        .then((text) => {
          sendEv({ requestId: payload.requestId, kind: 'delta', text });
          sendEv({ requestId: payload.requestId, kind: 'done', text });
        })
        .catch((e: Error) => {
          if (ac.signal.aborted) return;
          console.error('[vision] request failed:', e.message);
          sendEv({ requestId: payload.requestId, kind: 'error', message: e.message });
        })
        .finally(() => llmControllers.delete(payload.requestId));
    });

    // ---- ASR: warm the worker at launch (PLAN §6.3) ----
    asr.onEvent((ev: AsrEvent) => {
      if (ev.kind === 'segment') {
        const e2e = ev.timings.inferEndTs - ev.timings.speechEndTs;
        console.log(`[asr] #${ev.id} (${ev.lang ?? '?'}, ${ev.audioMs}ms audio, e2e ${e2e}ms) ${ev.text}`);
      } else if (ev.kind === 'ready') {
        console.log(`[asr] ready ep=${ev.ep} load=${ev.loadMs}ms warm=${ev.warmMs}ms gpuSuspect=${ev.gpuSuspect}`);
        if (process.env.MC_E2E_QUIT_ON_ASR_READY === '1') {
          setTimeout(() => app.quit(), 250);
        }
      } else if (ev.kind === 'error') {
        console.error(`[asr] error (fatal=${ev.fatal}): ${ev.message}`);
      } else if (ev.kind === 'status') {
        console.log(`[asr] status=${ev.state} queued=${ev.queuedSegments}`);
      }
      win?.webContents.send(IPC.asrEvent, ev);
    });
    void startAsr();

    registerHotkeys();
    createWindow();
  });

  app.on('second-instance', () => {
    win?.show();
    win?.focus();
  });

  app.on('before-quit', () => {
    globalShortcut.unregisterAll();
    void asr.stop();
    void sidecar.stop();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
