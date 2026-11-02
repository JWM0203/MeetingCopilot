/** Real built Electron application + renderer interaction gate; no provider credentials.
 * Session persistence/export and hints use production handlers. Provider, region picker,
 * ASR readiness and RAG responses are explicitly test-only IPC fixtures installed by
 * Playwright in this isolated process. Never packaged; no production test backdoor.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { isolatedEnvironment, SMOKE_PROFILE_PREFIX } from './smoke-verdict.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'release/smoke/ui');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), SMOKE_PROFILE_PREFIX + 'ui-'));
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ version: 2,
  onboarding: { schemaVersion: 1, completed: true }, asr: { backend: 'cloud' },
  ui: { lang: 'en', autoLaunch: false, opacity: 1 },
}));
const seed = { id: 'fixture-session', name: 'Fixture session', createdAt: 1,
  turns: [{ id: 'fixture-turn', kind: 'free', label: 'Fixture question', text: 'Fixture answer', status: 'done' }],
  segments: [{ id: 1, text: 'Fixture transcript', speaker: 'them', startTs: 1, endTs: 2 },
    { id: 2, text: 'Second fixture transcript for cross-bubble selection', speaker: 'them', startTs: 3, endTs: 4 }],
  resumeText: 'PRIVATE_RESUME_NOT_FOR_EXPORT', jdText: 'PRIVATE_JD_NOT_FOR_EXPORT', memo: 'PRIVATE_MEMO_NOT_FOR_EXPORT',
};
writeFileSync(join(profile, 'sessions.json'), JSON.stringify({ version: 1, currentId: seed.id, sessions: [seed] }));
const results = { platform: process.platform, arch: process.arch, started: new Date().toISOString(), tests: [],
  scope: 'Actual built Electron app, production React UI/preload; isolated no-secret test process. Mock provider/region/RAG and synthetic audio, NOT real providers, desktop capture/privacy, physical microphone or screen-share exclusion.' };
let app, page;
const poll = async (fn, label, timeout = 10000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await fn()) return; await new Promise(r => setTimeout(r, 75)); }
  throw new Error(`Timed out: ${label}`);
};
const shot = async name => { await page.screenshot({ path: join(output, `${name}.png`) }); };
const test = async (name, fn) => {
  try { await fn(); results.tests.push({ name, passed: true }); console.log(`UI_OK ${name}`); }
  catch (error) { results.tests.push({ name, passed: false, error: error.stack }); await shot('failure').catch(() => {}); throw error; }
};
const button = name => page.getByRole('button', { name, exact: true });
const selected = () => page.locator('select.session-select').inputValue();
const options = () => page.locator('select.session-select option').count();
try {
  const env = isolatedEnvironment(process.env);
  delete env.ELECTRON_RENDERER_URL;
  assert.notEqual(process.geteuid?.(), 0, 'Do not run Electron UI tests as root; Playwright would disable sandbox');
  app = await _electron.launch({ args: [root], cwd: root, env: { ...env, MC_USERDATA: profile }, timeout: 45000 });
  app.process().stderr.on('data', chunk => process.stderr.write(chunk));
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  await page.locator('select.session-select').waitFor();
  await poll(async () => await selected() === seed.id, 'initial persisted session loaded');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/index.html'));
    if (!win) throw new Error('Main window absent');
    win.setSize(1400, 900); win.show(); win.focus();
  });
  await test('production session fixture loaded and RAG default off', async () => {
    assert.equal(await selected(), seed.id);
    assert.equal(await page.locator('.turn-body').innerText(), 'Fixture answer');
    assert.equal((await page.evaluate(() => window.mc.getSettings())).rag.enabled, false);
    assert.equal(await button('📚 Library').count(), 0);
    await shot('01-main-default-off');
  });
  await test('same-surface hover, keyboard focus and Escape hints', async () => {
    const hint = button('New session');
    assert.equal(await hint.getAttribute('title'), null);
    const windows = app.windows().length;
    await hint.hover();
    await page.locator('.surface-hint').waitFor();
    assert.equal(await page.locator('.surface-hint').innerText(), 'New session');
    assert.equal(app.windows().length, windows);
    await shot('02-hover-hint');
    await page.keyboard.press('Escape');
    await poll(async () => await page.locator('.surface-hint').count() === 0, 'Escape dismisses hint');
    // Real keyboard navigation, not a synthetic focus event.
    await hint.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    await page.locator('.surface-hint').waitFor();
    await shot('03-keyboard-hint');
    await page.keyboard.press('Escape');
  });
  await test('create, switch, delete, undo and real TXT download', async () => {
    await button('New session').click();
    await poll(async () => await options() === 2, 'new session created');
    const newId = await selected(); assert.notEqual(newId, seed.id);
    assert.equal(await page.locator('.turn').count(), 0);
    await page.locator('select.session-select').selectOption(seed.id);
    await page.locator('.turn-body').getByText('Fixture answer', { exact: true }).waitFor();
    await button('Delete current session (undo available until app closes)').click();
    await poll(async () => await options() === 1, 'session deleted');
    assert.equal(await selected(), newId);
    await button('Undo delete').click();
    await poll(async () => await options() === 2, 'session restored');
    assert.equal(await selected(), seed.id);
    // Electron's real will-download path: save without an OS file-dialog prompt.
    const exportPath = join(output, 'session-export.txt');
    await app.evaluate(({ session }, path) => {
      globalThis.__uiDownload = { state: 'waiting' };
      session.defaultSession.once('will-download', (_event, item) => {
        item.setSavePath(path);
        globalThis.__uiDownload = { state: 'started', filename: item.getFilename() };
        item.once('done', (_event, state) => { globalThis.__uiDownload.state = state; });
      });
    }, exportPath);
    await button('↓ TXT').click();
    // Electron emits session DownloadItem events, not Playwright Page download
    // events on every supported platform. Assert the native item's final state.
    await poll(async () => {
      const download = await app.evaluate(() => globalThis.__uiDownload);
      if (['cancelled', 'interrupted'].includes(download.state)) throw new Error(`TXT download ${download.state}`);
      return download.state === 'completed';
    }, 'native Electron TXT download completed');
    await poll(async () => { try { return readFileSync(exportPath, 'utf8').includes('Fixture answer'); } catch { return false; } }, 'TXT saved');
    const exported = readFileSync(exportPath, 'utf8');
    assert.match(exported, /Fixture transcript/);
    assert.match(exported, /Fixture question/);
    assert.doesNotMatch(exported, /PRIVATE_/);
    await poll(async () => (await page.evaluate(() => window.mc.loadSessions())).sessions.length === 2, 'production persistence debounce');
    await shot('04-session-undo-export');
  });
  await test('production glass theme/opacity settings and compact-window layout preserve solid text', async () => {
    results.glass=[];
    const resize = (width,height) => app.evaluate(({BrowserWindow},{width,height}) => {const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html'));w.setSize(width,height);return w.getSize();},{width,height});
    for (const [theme,width,height,alpha] of [['dark',940,560,.55],['dark',640,380,.6],['light',940,560,.55],['light',640,380,.6]]) {
      await resize(1400,900);await button('Settings').click();
      await page.locator('.settings-row').filter({has:page.locator('label').filter({hasText:/^Theme$/})}).locator('select').selectOption(theme);
      const slider=page.locator('.settings-slider input[type=range]');
      const min=Number(await slider.getAttribute('min')),step=Number(await slider.getAttribute('step'));
      await slider.focus();await slider.press('Home');for(let i=0;i<Math.round((alpha-min)/step);i++)await slider.press('ArrowRight');
      assert.equal(Number(await slider.inputValue()),alpha);
      await button('Save').click();await poll(async()=>await page.locator('.settings').count()===0,'settings save closes production UI');
      assert.equal((await page.evaluate(()=>window.mc.getSettings())).ui.opacity,alpha);
      assert.deepEqual(await resize(width,height),[width,height]);
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const visual=await page.evaluate(()=>{
        const solid=['body','.app','.bubble','.bubble-text','.turn','.turn-body'].map(selector=>({selector,opacity:getComputedStyle(document.querySelector(selector)).opacity}));
        const controls=[...document.querySelectorAll('.titlebar button,.titlebar select,.pane-head button,.pane-head select,.answer-input input,.answer-input button,.statusbar button')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect(),display:getComputedStyle(e).display})).filter(x=>x.display!=='none'&&x.rect.width&&x.rect.height).map(x=>({text:x.text.trim(),left:x.rect.left,right:x.rect.right,top:x.rect.top,bottom:x.rect.bottom}));
        return{theme:document.documentElement.dataset.theme,alpha:getComputedStyle(document.documentElement).getPropertyValue('--app-alpha').trim(),solid,controls,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth};
      });
      assert.equal(visual.theme,theme);assert.equal(Number(visual.alpha),alpha);
      for(const x of visual.solid)assert.equal(x.opacity,'1',`${x.selector}: text must not inherit whole-element alpha`);
      assert.ok(visual.scrollWidth<=visual.width,`horizontal page overflow at ${width}x${height}`);
      for(const x of visual.controls)assert.ok(x.left>=-1&&x.top>=-1&&x.right<=visual.width+1&&x.bottom<=visual.height+1,`clipped control ${JSON.stringify(x)} at ${width}x${height}`);
      results.glass.push(visual);await shot(`glass-${theme}-${width}x${height}`);
    }
    await resize(1400,900);
  });
  // These fixture substitutions exist only inside the test-launched Electron process.
  // No credentials are written, no actual provider/embedding endpoint is called.
  const settings = await page.evaluate(() => window.mc.getSettings());
  await app.evaluate(({ ipcMain, BrowserWindow }, settings) => {
    const s = structuredClone(settings);
    s.llm.apiKeySet = true; s.llm.answerWithVision = true;
    s.vision.apiKeySet = true; s.vision.baseUrl = 'https://fixture.invalid/v1'; s.vision.model = 'fixture-vision';
    s.rag.rootPath = '/test-fixtures';
    const state = { settings: s, region: 'cancel', provider: 'done', shots: [], asks: [], translations: [], cancels: [], capture: [], pcm: 0, pendingRegion: null, pendingScan: null, ragPhase: 'disabled' };
    globalThis.__uiFixture = state;
    const handle = (channel, fn) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, fn); };
    const on = (channel, fn) => { ipcMain.removeAllListeners(channel); ipcMain.on(channel, fn); };
    handle('settings:get', () => s);
    handle('settings:set', (_event, patch) => {
      for (const [key, value] of Object.entries(patch)) s[key] = { ...s[key], ...value };
      if (patch.rag?.enabled !== undefined) state.ragPhase = patch.rag.enabled ? 'ready' : 'disabled';
      return s;
    });
    const status = () => ({ phase: state.ragPhase, fileCount: 1, chunkCount: 1, failedCount: 0 });
    handle('rag:status-get', status);
    handle('rag:documents-get', () => [{ id: 'fixture-doc', state: 'ready', relativePath: 'fixture-notes.txt', name: 'fixture-notes.txt' }]);
    handle('rag:rebuild', event => {
      state.ragPhase = 'embedding'; event.sender.send('rag:status', status());
      return new Promise(resolve => { state.pendingScan = resolve; });
    });
    handle('llm:translate', (_event, text) => { state.translations.push(text); return 'Fixture inline translation (not a live API)'; });
    handle('asr:replay', () => ({ ready: { kind: 'ready', ep: 'fixture' }, status: { kind: 'status', state: 'listening' } }));
    handle('region:pick', () => {
      if (state.region === 'error') throw new Error('fixture picker failure');
      if (state.region === 'cancel') return null;
      return new Promise(resolve => { state.pendingRegion = resolve; });
    });
    const answer = (event, payload, collection) => {
      collection.push(payload);
      if (state.provider === 'hold') return;
      event.sender.send('llm:event', state.provider === 'error'
        ? { kind: 'error', requestId: payload.requestId, message: 'Fixture provider failure (not a live API)' }
        : { kind: 'done', requestId: payload.requestId, text: 'Fixture provider answer (not a live API)' });
    };
    on('shot:ask', (event, p) => answer(event, p, state.shots));
    on('llm:ask', (event, p) => answer(event, p, state.asks));
    on('llm:cancel', (_event, id) => state.cancels.push(id));
    on('llm:prewarm', () => {}); handle('llm:memo', () => '');
    on('capture:started', () => state.capture.push('start'));
    on('capture:stopped', () => state.capture.push('stop'));
    on('capture:pcm', () => state.pcm++);
    // Prevent unrelated real ASR-worker errors replacing the explicit fixture replay.
    for (const w of BrowserWindow.getAllWindows()) {
      const send = w.webContents.send.bind(w.webContents);
      w.webContents.send = (channel, ...args) => { if (channel !== 'asr:event') send(channel, ...args); };
    }
  }, settings);
  await page.reload();
  const camera = page.locator('.answer-input button').filter({ hasText: '📷' });
  await camera.waitFor();
  const state = () => app.evaluate(() => {
    const s = globalThis.__uiFixture;
    return { shots: s.shots, asks: s.asks, translations: s.translations, cancels: s.cancels, capture: s.capture, pcm: s.pcm, regionPending: !!s.pendingRegion };
  });
  const mode = patch => app.evaluate((_electron, patch) => { Object.assign(globalThis.__uiFixture, patch); }, patch);
  const resolveRegion = () => app.evaluate(() => {
    const s = globalThis.__uiFixture;
    s.pendingRegion('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XkAAAAASUVORK5CYII=');
    s.pendingRegion = null;
  });
  await test('mock region cancel/error/retry and delayed screenshot session isolation', async () => {
    const initialTurns = await page.locator('.turn').count();
    await page.locator('.answer-input input').fill('Screenshot fixture question');
    await camera.click();
    assert.equal((await state()).shots.length, 0);
    assert.equal(await page.locator('.turn').count(), initialTurns);
    assert.equal(await page.locator('.answer-input input').inputValue(), 'Screenshot fixture question');
    await mode({ region: 'error' }); await camera.click();
    await page.getByRole('alert').getByText('Screenshot capture failed. Please retry.', { exact: true }).waitFor();
    await shot('05-picker-error-mock');
    await mode({ region: 'pending' }); await camera.click();
    await poll(async () => (await state()).regionPending, 'pending region fixture');
    const origin = await selected();
    await button('New session').click();
    const destination = await selected(); assert.notEqual(origin, destination);
    await page.locator('.answer-input input').fill('Other session draft');
    await resolveRegion();
    await poll(async () => (await state()).shots.length === 1, 'shot request sent');
    assert.equal(await page.locator('.turn').count(), 0);
    assert.equal(await page.locator('.answer-input input').inputValue(), 'Other session draft');
    await page.locator('select.session-select').selectOption(origin);
    await page.locator('.turn-vision .turn-body').getByText('Fixture provider answer (not a live API)', { exact: true }).waitFor();
    assert.equal((await state()).shots[0].question, 'Screenshot fixture question');
    await shot('06-shot-session-isolation-mock');
  });
  await test('mock provider error retry and stream cancellation', async () => {
    await mode({ provider: 'error' });
    await page.locator('.answer-input input').fill('Retry fixture question');
    await page.locator('.answer-input input').press('Enter');
    await page.locator('.answer-error').getByText('Fixture provider failure (not a live API)', { exact: true }).waitFor();
    await mode({ provider: 'done' }); await button('Retry').click();
    await poll(async () => (await state()).asks.length === 2, 'retry sent');
    assert.equal((await state()).asks[1].freeQuestion, 'Retry fixture question');
    await mode({ provider: 'hold' });
    await page.locator('.answer-input input').fill('Cancel fixture question');
    await page.locator('.answer-input input').press('Enter');
    await page.locator('.turn').last().getByRole('button', { name: 'Stop', exact: true }).click();
    await poll(async () => (await state()).cancels.length === 1, 'cancellation IPC');
    assert.equal(await page.locator('.turn').last().locator('.cursor').count(), 0);
    await page.locator('.turn').last().getByText('Generation ended without an answer.', { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('.turn').last().locator('.turn-body').innerText(), /Generating|Analyzing/);
    await shot('07-provider-retry-cancel-mock');
  });
  await test('real partial and cross-bubble selection toolbar routes exact text to mock provider', async () => {
    await mode({ provider: 'done' });
    await page.locator('select.session-select').selectOption(seed.id);
    await page.locator('.bubble-text').filter({ hasText: 'Second fixture transcript' }).waitFor();
    const selectByMouse = async (startIndex, startOffset, endIndex, endOffset) => {
      const points = await page.evaluate(({startIndex,startOffset,endIndex,endOffset}) => {
        const els = document.querySelectorAll('.transcript .bubble-text');
        const point = (index, offset) => { const r = document.createRange(); r.setStart(els[index].firstChild, offset); r.collapse(true); const b = r.getBoundingClientRect(); return {x:b.x,y:b.y+b.height/2}; };
        return {a:point(startIndex,startOffset),b:point(endIndex,endOffset)};
      }, {startIndex,startOffset,endIndex,endOffset});
      await page.mouse.move(points.a.x,points.a.y);await page.mouse.down();await page.mouse.move(points.b.x,points.b.y,{steps:16});await page.mouse.up();
      await page.locator('.sel-popup button').waitFor();
      const popup=await page.locator('.sel-popup').boundingBox();const view=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(popup.x>=0&&popup.y>=0&&popup.x+popup.width<=view.width&&popup.y+popup.height<=view.height,`selection popup clipped: ${JSON.stringify(popup)}`);
      return page.evaluate(() => window.getSelection().toString().trim());
    };
    const partial = await selectByMouse(0,8,0,18);
    assert.equal(partial,'transcript','must select arbitrary substring, not entire bubble');
    const beforePartial = (await state()).asks.length;
    const popupBounds=await page.locator('.sel-popup').boundingBox();const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(popupBounds.x>=0&&popupBounds.y>=0&&popupBounds.x+popupBounds.width<=viewport.width&&popupBounds.y+popupBounds.height<=viewport.height,'floating selection toolbar must not be clipped');
    await shot('12-partial-selection-toolbar');
    await page.locator('.sel-popup button').click();
    await poll(async() => (await state()).asks.length === beforePartial+1,'partial selection request');
    assert.equal((await state()).asks.at(-1).mode,'segment');assert.equal((await state()).asks.at(-1).question,partial);
    assert.equal(await page.locator('.sel-popup').count(),0);
    const across = await selectByMouse(0,8,1,14);
    assert.ok(across.startsWith('transcript'));assert.ok(across.endsWith('Second fixture'));
    const beforeAcross = (await state()).asks.length;
    await shot('13-cross-bubble-selection-toolbar');
    await page.locator('.sel-popup button').click();
    await poll(async() => (await state()).asks.length === beforeAcross+1,'cross-bubble selection request');
    assert.equal((await state()).asks.at(-1).question,across,'exact live selection must reach provider fixture');
    await selectByMouse(0,8,0,18);
    const beforeClear = (await state()).asks.length;
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await poll(async() => await page.locator('.sel-popup').count()===0,'cleared selection removes stale floating toolbar');
    assert.equal((await state()).asks.length,beforeClear);
    // A selection crossing out of the transcript must invalidate, not reuse cached text.
    await selectByMouse(0,8,0,18);
    await page.evaluate(() => {const s=window.getSelection(),r=document.createRange();r.setStart(document.querySelector('.bubble-text').firstChild,8);r.setEnd(document.createTreeWalker(document.querySelector('.turn-body'),NodeFilter.SHOW_TEXT).nextNode(),3);s.removeAllRanges();s.addRange(r);});
    await poll(async() => await page.locator('.sel-popup').count()===0,'outside selection removes stale toolbar');
    await page.evaluate(() => window.getSelection().removeAllRanges());
    assert.equal((await state()).asks.length,beforeClear);
    // Existing per-bubble direct actions remain direct; no demo-only replacement.
    const first = page.locator('.bubble').first();
    await first.getByRole('button',{name:'⚡Ans',exact:true}).click();
    await poll(async() => (await state()).asks.length===beforeClear+1,'direct bubble answer');
    assert.equal((await state()).asks.at(-1).question,seed.segments[0].text);
    await first.getByRole('button',{name:'中',exact:true}).click();
    await first.locator('.bubble-trans').getByText('Fixture inline translation (not a live API)',{exact:true}).waitFor();
    assert.equal((await state()).translations.at(-1),seed.segments[0].text);
    await shot('14-direct-bubble-actions');
    const tiny=await selectByMouse(0,0,0,1);assert.equal(tiny,'F');await shot('15-first-character-selection');
    await button('New session').click();await poll(async()=>await selected()!==seed.id,'switch away from selected transcript');
    await poll(async()=>await page.locator('.sel-popup').count()===0,'session switch invalidates selection toolbar');
    await page.locator('select.session-select').selectOption(seed.id);
    await page.locator('.bubble-text').filter({hasText:'Fixture transcript'}).first().waitFor();
    await selectByMouse(0,8,0,18);
    await page.locator('.pane-transcript .pane-head').getByRole('button',{name:'Clear',exact:true}).click();
    await poll(async()=>await page.locator('.bubble').count()===0&&await page.locator('.sel-popup').count()===0,'clear transcript removes selection toolbar');
  });
  await test('mock RAG disable during indexing ignores stale result; modal hint layering', async () => {
    await button('Settings').click();
    const enable = page.getByRole('checkbox', { name: 'Enable local knowledge', exact: true });
    assert.equal(await enable.isChecked(), false);
    await enable.click();
    await poll(() => enable.isChecked(), 'RAG enable IPC acknowledged');
    await button('Rebuild index / Retry').click();
    await page.getByText('Building local index', { exact: true }).waitFor();
    assert.equal(await enable.isEnabled(), true);
    await enable.click();
    await poll(async () => !await enable.isChecked(), 'RAG disable IPC acknowledged');
    await page.locator('.rag-settings').getByText('Disabled', { exact: true }).waitFor();
    await app.evaluate(() => { globalThis.__uiFixture.pendingScan({ phase: 'ready', fileCount: 99, chunkCount: 99, failedCount: 0 }); });
    // Await observable completion of the pending invoke rather than arbitrary UI timing.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await enable.isChecked(), false);
    assert.equal(await page.locator('.rag-settings').getByText('Index ready', { exact: true }).count(), 0);
    await shot('08-rag-disabled-during-index-mock');
    await enable.click();
    await poll(() => enable.isChecked(), 'RAG enable IPC acknowledged');
    await button('Cancel').click();
    await button('📚 Library').click();
    await page.locator('dialog[open]').waitFor();
    await page.getByRole('checkbox', { name: 'Use knowledge in this session', exact: true }).check();
    await page.locator('dialog span[data-hint]').hover();
    await page.locator('dialog .surface-hint').waitFor();
    assert.equal(await page.locator('body > .surface-hint').count(), 0);
    await shot('09-modal-hint-layer-mock');
    await page.keyboard.press('Escape');
    await poll(async () => await page.locator('dialog[open]').count() === 0, 'Escape closes dialog');
    assert.equal(await page.locator('.surface-hint').count(), 0);
  });
  await test('synthetic audio start/stop twice releases real MediaStream tracks and AudioContexts', async () => {
    // No physical device or permission bypass: getUserMedia returns an oscillator's
    // MediaStreamDestination. Production PcmCapture and AudioWorklet still run.
    await page.evaluate(() => {
      const Original = window.AudioContext;
      const fixture = { contexts: [], sources: [], tracks: [] };
      window.__audioFixture = fixture;
      window.AudioContext = class extends Original { constructor(...args) { super(...args); fixture.contexts.push(this); } };
      const acquire = async () => {
        const context = new Original({ sampleRate: 16000 });
        const osc = context.createOscillator(); const dest = context.createMediaStreamDestination();
        osc.connect(dest); osc.start(); await context.resume();
        fixture.sources.push({ context, osc }); fixture.tracks.push(...dest.stream.getTracks());
        return dest.stream;
      };
      navigator.mediaDevices.getUserMedia = acquire;
      navigator.mediaDevices.getDisplayMedia = acquire;
    });
    const start = page.locator('.titlebar-actions > button').first();
    for (let i = 0; i < 2; i++) {
      const pcmBefore = (await state()).pcm;
      await start.click();
      await poll(async () => (await state()).capture.filter(x => x === 'start').length === i + 1, 'capture start');
      await poll(async () => (await state()).pcm > pcmBefore, 'synthetic PCM traverses real worklet');
      if (i === 0) await shot('10-synthetic-audio-running');
      await start.click();
      await poll(async () => (await state()).capture.filter(x => x === 'stop').length === i + 1, 'capture stop');
      assert.equal(await page.evaluate(() => window.__audioFixture.tracks.every(t => t.readyState === 'ended')), true);
      assert.equal(await page.evaluate(() => window.__audioFixture.contexts.every(c => c.state === 'closed')), true);
    }
    await page.evaluate(async () => { for (const s of window.__audioFixture.sources) { s.osc.stop(); await s.context.close(); } });
    assert.deepEqual((await state()).capture, ['start', 'stop', 'start', 'stop']);
    await shot('11-synthetic-audio-cleaned');
  });
  results.passed = true;
} catch (error) {
  results.passed = false; results.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
  results.finished = new Date().toISOString();
  if (app) await app.close().catch(error => { results.passed = false; results.cleanupError = error.message; console.error('UI cleanup:', error.message); process.exitCode = 1; });
  writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
