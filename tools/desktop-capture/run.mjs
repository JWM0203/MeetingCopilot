/** Isolated desktop-capture diagnostic. No production hooks or capture API replacements. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { _electron } from 'playwright';
import { isolatedEnvironment } from '../smoke-verdict.mjs';
const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'release/smoke/desktop-capture');
// Dedicated generated-evidence directory only; never reuse stale ready/stop/frames.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const report = { backend: 'Windows GDI BitBlt(SRCCOPY|CAPTUREBLT)', requestedFps: 30, events: [],
  scope: 'Controlled Windows Server desktop, built source Electron app; NOT Windows 11, DXGI, ScreenCaptureKit or a meeting remote-view test. Synthetic public canary content only. Renderer/IPC actions are explicitly labelled; hide/show uses real OS keybd_event input.' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const poll = async (fn, label) => { const end=Date.now()+15000; while(Date.now()<end) {if(await fn())return; await sleep(75);} throw new Error(`BLOCKED: ${label}`); };
const native = args => execFileSync('powershell.exe', ['-NoProfile','-File',join(import.meta.dirname,'native.ps1'),...args], {encoding:'utf8',timeout:10000}).trim();
const profile = mkdtempSync(join(tmpdir(), 'mc-native-capture-'));
writeFileSync(join(profile,'settings.json'), JSON.stringify({version:2,onboarding:{schemaVersion:1,completed:true},asr:{backend:'cloud'},ui:{lang:'en',autoLaunch:false,opacity:1,stealth:true,hotkeyToggle:'Control+Alt+F10'}}));
const seed={id:'capture-fixture',name:'PUBLIC_CAPTURE_CANARY',createdAt:1,turns:[{id:'canary',kind:'free',label:'PUBLIC CAPTURE TEST',text:'PUBLIC_CANARY_7391 — synthetic desktop capture compatibility test',status:'done'}],segments:[],resumeText:'',jdText:'',memo:''};
writeFileSync(join(profile,'sessions.json'),JSON.stringify({version:1,currentId:seed.id,sessions:[seed]}));
let app,page,recorder,recorderExit;
const event = (stage, detail={}) => {report.events.push({stage,ms:Date.now(),...detail}); writeFileSync(join(output,'events.json'),JSON.stringify(report.events,null,2));};
const state = () => app.evaluate(({BrowserWindow}) => {const w=BrowserWindow.fromId(globalThis.__captureMain); return {visible:w.isVisible(),protected:w.isContentProtected(),bounds:w.getBounds(),handle:w.getNativeWindowHandle().readBigUInt64LE().toString()};});
async function requestStealth(requested) {
 const observation={requested,ms:Date.now(),pageUrl:page.url()};
 report.toggleRequests??=[];report.toggleRequests.push(observation);
 const pageWindow=await app.browserWindow(page);
 observation.pageWindow=await pageWindow.evaluate(w=>({id:w.id,webContentsId:w.webContents.id,handle:w.getNativeWindowHandle().readBigUInt64LE().toString(),url:w.webContents.getURL()}));
 await pageWindow.dispose();
 const windows=()=>app.evaluate(({BrowserWindow,app})=>({userData:app.getPath('userData'),selectedMain:globalThis.__captureMain,windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,webContentsId:w.webContents.id,url:w.webContents.getURL(),visible:w.isVisible(),protected:w.isContentProtected(),handle:w.getNativeWindowHandle().readBigUInt64LE().toString()}))}));
 observation.before={settingsStealth:await page.evaluate(async()=>(await window.mc.getSettings()).ui.stealth),...await windows()};
 observation.returned=await page.evaluate(on=>window.mc.setStealth(on),requested);
 observation.after={settingsStealth:await page.evaluate(async()=>(await window.mc.getSettings()).ui.stealth),...await windows()};
 assert.equal(observation.returned,requested,'production IPC return must equal requested boolean');
 assert.equal(observation.after.settingsStealth,requested,'production settings readback must equal requested boolean');
 assert.equal(observation.pageWindow.id,observation.after.selectedMain,'Playwright renderer must correspond to selected main HWND');
 assert.equal(resolve(observation.after.userData),resolve(profile),'production app must use isolated profile');
}
async function affinity(expected, { observeOnly = false } = {}) {
 const until=Date.now()+8000;
 do {
  const s=await state();const a=JSON.parse(native(['-Mode','Affinity','-Handle',s.handle]));
  report.affinity??=[];report.affinity.push({ms:Date.now(),...a,requested:expected,window:s,observeOnly});
  assert.equal(a.ok,true);
  if(observeOnly)return a;
  if(a.affinity===(expected?17:0)){assert.equal(s.protected,expected);return a;}
  await sleep(100);
 } while(Date.now()<until);
 throw new Error(`BLOCKED: Windows native affinity did not reach ${expected?17:0} after visible compositor update; see affinity observations`);
}
try {
 assert.equal(process.platform,'win32','BLOCKED: requires a Windows desktop');
 report.build={commit:process.env.GITHUB_SHA,files:Object.fromEntries(['out/main/index.js','out/preload/index.js'].map(path=>[path,createHash('sha256').update(readFileSync(join(root,path))).digest('hex')]))};
 const env=isolatedEnvironment(process.env);delete env.ELECTRON_RENDERER_URL;
 app=await _electron.launch({args:[root],cwd:root,env:{...env,MC_USERDATA:profile},timeout:45000});
 page=await app.firstWindow();await page.locator('select.session-select').waitFor();
 await page.locator('.turn-body').getByText('PUBLIC_CANARY_7391',{exact:false}).waitFor();
 report.host=await app.evaluate(async ({BrowserWindow,screen,globalShortcut,app})=>{
  const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html'));globalThis.__captureMain=main.id;
  main.hide();const display=screen.getPrimaryDisplay();assertSize(display.bounds);
  function assertSize(b){if(b.width<1000||b.height<700)throw new Error('BLOCKED: desktop too small for controlled fixture');}
  const background=new BrowserWindow({...display.bounds,frame:false,skipTaskbar:true,backgroundColor:'#20c0b0',enableLargerThanScreen:true,webPreferences:{contextIsolation:true}});
  globalThis.__captureBackground=background.id;
  await background.loadURL('data:text/html,'+encodeURIComponent('<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:repeating-conic-gradient(#20c0b0 0% 25%,#e0c040 0% 50%) 0/160px 160px}i{position:fixed;left:0;top:0;width:16px;height:16px;background:red}</style><i></i><script>setInterval(()=>{document.querySelector("i").style.background=Date.now()%500<250?"red":"blue"},100)</script>'));
  background.setBounds(display.bounds);background.show();main.setBounds({x:100,y:100,width:800,height:560});
  return {electron:process.versions.electron,platform:process.platform,display,hotkeyRegistered:globalShortcut.isRegistered('Control+Alt+F10'),version:app.getVersion()};
 });
 assert.equal(report.host.hotkeyRegistered,true,'BLOCKED: native global hotkey not registered');
 // Public canary patch is confined to test renderer; keep genuine production controls/text.
 await page.evaluate(()=>{const marker=document.createElement('div');marker.id='capture-canary';marker.textContent='PUBLIC_CANARY_7391';marker.style.cssText='position:fixed;bottom:0;left:0;width:300px;height:35px;background:#ff00ff;color:#000;font:20px monospace;z-index:2147483647;pointer-events:none';document.body.append(marker);});
 await sleep(600);
 recorder=spawn('powershell.exe',['-NoProfile','-File',join(import.meta.dirname,'native.ps1'),'-Output',output],{stdio:['ignore','pipe','pipe']});
 recorder.stdout.on('data',d=>process.stdout.write(d));recorder.stderr.on('data',d=>process.stderr.write(d));
 recorderExit=new Promise(resolve=>{recorder.on('exit',(code,signal)=>resolve({code,signal}));recorder.on('error',error=>resolve({code:null,error:error.message}));});
 await poll(()=>existsSync(join(output,'ready')),'native GDI recorder did not produce its first frame');
 event('baseline');await sleep(1200);
 await requestStealth(false);await affinity(false,{observeOnly:true});
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.fromId(globalThis.__captureMain);w.show();w.focus();});
 // Hidden HWND affinity can lag the requested property until normal show/composition.
 // Preserve the hidden readback, then require actual native 0 before accepting control.
 await affinity(false);event('visible-positive-control');await sleep(1500);
 await page.getByRole('button',{name:'New session',exact:true}).hover();await page.locator('.surface-hint').waitFor();
 event('visible-hover-control');await sleep(700);
 await page.keyboard.press('Escape');
 event('enable-protection-request');await requestStealth(true);await affinity(true);await sleep(400);
 event('protected-start');await sleep(700);
 await page.getByRole('button',{name:'New session',exact:true}).hover();await page.locator('.surface-hint').waitFor();event('protected-hover');await sleep(900);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'New session',exact:true}).focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');event('protected-keyboard-focus');await sleep(700);await page.keyboard.press('Escape');
 for(let i=0;i<4;i++) {
  const before=await state();event('native-hotkey-request',{iteration:i,before:before.visible});
  native(['-Mode','Hotkey']);await poll(async()=> (await state()).visible!==before.visible,'OS keybd_event global hotkey did not change visibility');
  event('native-hotkey-confirmed',{iteration:i,...await state()});await sleep(600);
 }
 await page.getByRole('button',{name:'Settings',exact:true}).click();event('protected-settings');await sleep(800);await page.getByRole('button',{name:'Cancel',exact:true}).click();
 event('region-request',{input:'production preload pickRegion(), NOT mock; escape uses renderer keyboard'});
 await page.evaluate(()=>{window.__captureRegionResult='pending';window.mc.pickRegion().then(x=>window.__captureRegionResult=x===null?'cancelled':'image').catch(e=>window.__captureRegionResult='error:'+e.message);});
 await poll(()=>app.windows().length===3,'production region overlay did not open');
 const region=app.windows().find(w=>w!==page&&w.url().startsWith('data:text/html;charset=utf-8,'));
 assert.ok(region,'BLOCKED: region window not identified');await region.waitForLoadState();
 event('protected-region-overlay');await sleep(1000);await region.keyboard.press('Escape');
 await poll(()=>page.evaluate(()=>window.__captureRegionResult==='cancelled'),'region cancellation not completed');event('region-cancelled');await sleep(1000);
 event('protected-end');
 await requestStealth(false);await affinity(false);event('visible-post-control');await sleep(1200);
 report.sequenceCompleted=true;
} catch(error) {report.error=error.stack;process.exitCode=1;console.error(error);}
finally {
 event('stop');writeFileSync(join(output,'stop'),'stop');
 if(recorder){
  report.recorder=await Promise.race([recorderExit,sleep(15000).then(()=>({timeout:true}))]);
  if(report.recorder.timeout){recorder.kill();report.recorder.afterKill=await Promise.race([recorderExit,sleep(3000).then(()=>({timeout:true}))]);}
  if(report.recorder.code!==0){report.error??='BLOCKED: native recorder failed or cleanup timed out';process.exitCode=1;}
 }
 if(app)await Promise.race([app.close(),sleep(10000).then(()=>{throw new Error('Electron close timed out');})]).catch(e=>{report.cleanupError=e.message;app.process()?.kill();process.exitCode=1;});
 writeFileSync(join(output,'run.json'),JSON.stringify(report,null,2));
 rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
