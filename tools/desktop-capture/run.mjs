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
const startupProtectedMode=process.argv.includes('--startup-protected-transitions');
const output = join(root, 'release/smoke',startupProtectedMode?'desktop-capture-startup-protected':'desktop-capture');
// Dedicated generated-evidence directory only; never reuse stale ready/stop/frames.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const report = { mode:startupProtectedMode?'fresh-startup-protected-transitions':'runtime-toggle-roundtrip-regression', backend: 'Windows GDI BitBlt(SRCCOPY|CAPTUREBLT)', requestedFps: 30, events: [],
  knownRuntimeOffIssue: 'v3: correct main HWND stayed protected/native17 despite production IPC false and settings false. Historical evidence retained. Current runtime roundtrip regression requires actual same-window ON/OFF; startup mode is a separate control.',
  scope: 'Controlled Windows Server desktop, built source Electron app; NOT Windows 11, DXGI, ScreenCaptureKit or a meeting remote-view test. Synthetic public canary content only. Renderer/IPC actions are explicitly labelled; hide/show uses real OS keybd_event input.' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const poll = async (fn, label) => { const end=Date.now()+15000; while(Date.now()<end) {if(await fn())return; await sleep(75);} throw new Error(`BLOCKED: ${label}`); };
const native = args => execFileSync('powershell.exe', ['-NoProfile','-File',join(import.meta.dirname,'native.ps1'),...args], {encoding:'utf8',timeout:10000}).trim();
const profile = mkdtempSync(join(tmpdir(), 'mc-native-capture-'));
writeFileSync(join(profile,'settings.json'), JSON.stringify({version:2,onboarding:{schemaVersion:1,completed:true},asr:{backend:'cloud'},ui:{lang:'en',autoLaunch:false,opacity:startupProtectedMode?1:0.6,stealth:false,hotkeyToggle:startupProtectedMode?'':'Control+Alt+F10',hotkeyShot:''}}));
const seed={id:'capture-fixture',name:'PUBLIC_CAPTURE_CANARY',createdAt:1,turns:[{id:'canary',kind:'free',label:'PUBLIC CAPTURE TEST',text:'PUBLIC_CANARY_7391 — synthetic desktop capture compatibility test',status:'done'}],segments:[],resumeText:'',jdText:'',memo:''};
writeFileSync(join(profile,'sessions.json'),JSON.stringify({version:1,currentId:seed.id,sessions:[seed]}));
let app,page,recorder,recorderExit,postApp,postProfile,controlApp,protectedProfile;
const event = (stage, detail={}) => {report.events.push({stage,ms:Date.now(),...detail}); writeFileSync(join(output,'events.json'),JSON.stringify(report.events,null,2));};
const state = () => app.evaluate(({BrowserWindow}) => {const w=BrowserWindow.fromId(globalThis.__captureMain); return {id:w.id,webContentsId:w.webContents.id,opacity:w.getOpacity(),visible:w.isVisible(),protected:w.isContentProtected(),bounds:w.getBounds(),handle:w.getNativeWindowHandle().readBigUInt64LE().toString()};});
async function waitForCleanBaseline() {
 const started=Date.now(),deadline=started+12000;
 report.baselinePreparation={started,timeoutMs:12000,requiredConsecutiveFrames:10,contaminatedFrames:[]};
 event('recording-ready-await-clean-baseline',{allPreBaselineFramesPreserved:true});
 while(Date.now()<deadline){
  let frames=[];
  try{frames=readFileSync(join(output,'frames.jsonl'),'utf8').replace(/^\uFEFF/,'').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{/* writer may be between writes; try next complete sample */}
  report.baselinePreparation.observedFrames=frames.length;
  report.baselinePreparation.contaminatedFrames=frames.filter(f=>f.nonBackground/f.samples>=0.001||f.canary>0).slice(0,30).map(f=>f.frame);
  const recent=frames.slice(-10);
  if(recent.length===10&&recent.every(f=>f.nonBackground/f.samples<0.001&&f.canary===0)){
   report.baselinePreparation.cleanAt=Date.now();report.baselinePreparation.cleanFrameNumbers=recent.map(f=>f.frame);return;
  }
  await sleep(75);
 }
 throw new Error('BLOCKED: desktop baseline did not naturally become clean for ten consecutive native frames within12s; all contamination retained, no notification suppression');
}
async function requestProtectionViaToolbar(requested=true) {
 const observation={requested,input:'actual Playwright click on production toolbar button',ms:Date.now(),pageUrl:page.url()};
 report.uiProtectionRequest=observation;(report.uiProtectionRequests??=[]).push(observation);
 const pageWindow=await app.browserWindow(page);
 observation.pageWindow=await pageWindow.evaluate(w=>({id:w.id,webContentsId:w.webContents.id,handle:w.getNativeWindowHandle().readBigUInt64LE().toString(),url:w.webContents.getURL()}));
 await pageWindow.dispose();
 const windows=()=>app.evaluate(({BrowserWindow,app})=>({userData:app.getPath('userData'),selectedMain:globalThis.__captureMain,windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,webContentsId:w.webContents.id,url:w.webContents.getURL(),visible:w.isVisible(),protected:w.isContentProtected(),handle:w.getNativeWindowHandle().readBigUInt64LE().toString()}))}));
 observation.before={settingsStealth:await page.evaluate(async()=>(await window.mc.getSettings()).ui.stealth),...await windows()};
 const toggle=page.getByRole('button',{name:/^(Stealth:(On|Off)|Capture protection: unknown)$/});
 const warning=page.getByRole('alert').filter({hasText:'Capture protection could not be applied or confirmed.'});
 assert.equal(await toggle.innerText(),requested?'Stealth:Off':'Stealth:On');
 assert.equal(await warning.count(),0,'fresh OFF baseline must not already contain the failure warning');
 await toggle.click();
 await poll(async()=>await warning.count()>0 || await toggle.getAttribute('aria-pressed')===String(requested),'toolbar protection operation did not resolve');
 await poll(()=>toggle.isEnabled(),'toolbar protection operation still pending');
 observation.after={settingsStealth:await page.evaluate(async()=>(await window.mc.getSettings()).ui.stealth),...await windows(),label:await toggle.innerText(),ariaPressed:await toggle.getAttribute('aria-pressed')};
 assert.equal(observation.pageWindow.id,observation.after.selectedMain,'real UI must correspond to selected main HWND');
 assert.equal(resolve(observation.after.userData),resolve(profile),'production app must use isolated profile');
 if(await warning.count()>0){
  observation.warning=await warning.innerText();
  assert.equal(observation.after.label,requested?'Stealth:Off':'Stealth:On');assert.equal(observation.after.ariaPressed,String(!requested));assert.equal(observation.after.settingsStealth,!requested);
  await affinity(!requested);
  report.uiGuardVerified=true;
  event('ui-protection-failure-truthfully-reported',{label:observation.after.label,actualProtection:!requested});await sleep(1800);
  throw new Error(`BLOCKED: runtime protection request ${requested} failed; truthful guard verified, NOT a compatibility pass.`);
 }
 assert.equal(observation.after.label,requested?'Stealth:On':'Stealth:Off');assert.equal(observation.after.ariaPressed,String(requested));assert.equal(observation.after.settingsStealth,requested);
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
 if(!startupProtectedMode)assert.equal(report.host.hotkeyRegistered,true,'BLOCKED: native global hotkey not registered');
 // Public canary patch is confined to test renderer; keep genuine production controls/text.
 await page.evaluate(()=>{const marker=document.createElement('div');marker.id='capture-canary';marker.textContent='PUBLIC_CANARY_7391';marker.style.cssText='position:fixed;bottom:0;left:0;width:300px;height:35px;background:#ff00ff;color:#000;font:20px monospace;z-index:2147483647;pointer-events:none';document.body.append(marker);});
 await sleep(600);
 recorder=spawn('powershell.exe',['-NoProfile','-File',join(import.meta.dirname,'native.ps1'),'-Output',output],{stdio:['ignore','pipe','pipe']});
 recorder.stdout.on('data',d=>process.stdout.write(d));recorder.stderr.on('data',d=>process.stderr.write(d));
 recorderExit=new Promise(resolve=>{recorder.on('exit',(code,signal)=>resolve({code,signal}));recorder.on('error',error=>resolve({code:null,error:error.message}));});
 await poll(()=>existsSync(join(output,'ready')),'native GDI recorder did not produce its first frame');
 await waitForCleanBaseline();event('baseline');await sleep(1200);
 report.initialControl={settingsStealth:await page.evaluate(async()=>(await window.mc.getSettings()).ui.stealth),window:await state()};
 assert.equal(report.initialControl.settingsStealth,false);await affinity(false);
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.fromId(globalThis.__captureMain);w.show();w.focus();});
 // Fresh production startup with explicit fixture protection OFF, not a retry of
 // the known sticky runtime true-to-false transition. Native 0 is still required.
 await affinity(false);
 if(!startupProtectedMode){
  report.rendererBefore=await page.evaluate(async()=>{window.__capturePreserveToken='PUBLIC_RENDERER_PRESERVE_7391';document.querySelector('.answer-input input').value='PUBLIC_UNSENT_DRAFT_7391';return{token:window.__capturePreserveToken,draft:document.querySelector('.answer-input input').value,alpha:getComputedStyle(document.documentElement).getPropertyValue('--app-alpha').trim(),session:document.querySelector('select.session-select').value,settingsOpacity:(await window.mc.getSettings()).ui.opacity};});
  report.windowBefore=await state();assert.equal(report.rendererBefore.alpha,'0.6');assert.equal(report.rendererBefore.settingsOpacity,0.6);
 }
 event('visible-positive-control');await sleep(1500);
 await page.getByRole('button',{name:'New session',exact:true}).hover();await page.locator('.surface-hint').waitFor();
 event('visible-hover-control');await sleep(700);
 await page.keyboard.press('Escape');
 if(startupProtectedMode){
  event('fresh-protected-process-launch',{outsideProtectedAssertion:true});
  // The OFF control process owns the neutral background only; its main is hidden.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.fromId(globalThis.__captureMain).hide());
  controlApp=app;protectedProfile=mkdtempSync(join(tmpdir(),'mc-native-startup-on-'));
  writeFileSync(join(protectedProfile,'settings.json'),JSON.stringify({version:2,onboarding:{schemaVersion:1,completed:true},asr:{backend:'cloud'},ui:{lang:'en',autoLaunch:false,opacity:1,stealth:true,hotkeyToggle:'Control+Alt+F10',hotkeyShot:''}}));
  writeFileSync(join(protectedProfile,'sessions.json'),JSON.stringify({version:1,currentId:seed.id,sessions:[seed]}));
  app=await _electron.launch({args:[root],cwd:root,env:{...env,MC_USERDATA:protectedProfile},timeout:30000});
  page=await app.firstWindow();await page.locator('.turn-body').getByText('PUBLIC_CANARY_7391',{exact:false}).waitFor();
  report.protectedStartup=await app.evaluate(({BrowserWindow,globalShortcut,app})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html'));globalThis.__captureMain=w.id;w.setBounds({x:100,y:100,width:800,height:560});w.show();w.focus();return{pid:process.pid,userData:app.getPath('userData'),hotkeyRegistered:globalShortcut.isRegistered('Control+Alt+F10'),id:w.id,webContentsId:w.webContents.id,url:w.webContents.getURL()};});
  assert.equal(resolve(report.protectedStartup.userData),resolve(protectedProfile));assert.equal(report.protectedStartup.hotkeyRegistered,true);
  const startupSettings=await page.evaluate(()=>window.mc.getSettings());report.protectedStartup.settingsStealth=startupSettings.ui.stealth;report.protectedStartup.acknowledgement=startupSettings.contentProtection;assert.equal(startupSettings.ui.stealth,true);assert.equal(startupSettings.contentProtection?.actual,true);assert.equal(startupSettings.contentProtection?.ok,true);
  await page.evaluate(()=>{const marker=document.createElement('div');marker.textContent='PUBLIC_CANARY_7391';marker.style.cssText='position:fixed;bottom:0;left:0;width:300px;height:35px;background:#ff00ff;color:#000;font:20px monospace;z-index:2147483647;pointer-events:none';document.body.append(marker);});
  await affinity(true);await sleep(400);
 }else{event('enable-protection-request');await requestProtectionViaToolbar();await affinity(true);await sleep(400);}
 event('protected-start');await sleep(startupProtectedMode?2200:700);
 await page.getByRole('button',{name:'New session',exact:true}).hover();await page.locator('.surface-hint').waitFor();event('protected-hover');await sleep(startupProtectedMode?2000:900);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'New session',exact:true}).focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');event('protected-keyboard-focus');await sleep(startupProtectedMode?1500:700);await page.keyboard.press('Escape');
 for(let i=0;i<4;i++) {
  const before=await state();event('native-hotkey-request',{iteration:i,before:before.visible});
  native(['-Mode','Hotkey']);await poll(async()=> (await state()).visible!==before.visible,'OS keybd_event global hotkey did not change visibility');
  event('native-hotkey-confirmed',{iteration:i,...await state()});await affinity(true);await sleep(startupProtectedMode?1500:600);
 }
 await page.getByRole('button',{name:'Settings',exact:true}).click();event('protected-settings');await sleep(startupProtectedMode?1600:800);await page.getByRole('button',{name:'Cancel',exact:true}).click();
 event('region-request',{input:'production preload pickRegion(), NOT mock; escape uses renderer keyboard'});
 const windowsBeforeRegion=app.windows().length;
 await page.evaluate(()=>{window.__captureRegionResult='pending';window.mc.pickRegion().then(x=>window.__captureRegionResult=x===null?'cancelled':'image').catch(e=>window.__captureRegionResult='error:'+e.message);});
 await poll(()=>app.windows().length===windowsBeforeRegion+1,'production region overlay did not open');
 const region=app.windows().find(w=>w!==page&&w.url().startsWith('data:text/html;charset=utf-8,'));
 assert.ok(region,'BLOCKED: region window not identified');await region.waitForLoadState();
 event('protected-region-overlay');await sleep(startupProtectedMode?1800:1000);
 let regionKeyError;
 try{await region.keyboard.press('Escape');}catch(error){regionKeyError=error;}
 // Escape closes this popup on keydown, so Playwright's subsequent keyup can
 // reject with target-closed. Accept only after the *production* picker reports
 // cancellation, the region is closed, and the main process/window are still live.
 await poll(async()=>region.isClosed() && app.windows().length===windowsBeforeRegion && await page.evaluate(()=>window.__captureRegionResult==='cancelled'),'production region cancellation/closure not completed');
 assert.equal(app.process().exitCode,null,'main process must remain alive after region Escape');assert.equal((await state()).visible,true);
 if(regionKeyError && !/Target page, context or browser has been closed/.test(regionKeyError.message))throw regionKeyError;
 event('region-cancelled',{productionResult:'cancelled',regionClosed:true,keyDispatchClosedAfterCancel:regionKeyError?.message??null});await sleep(startupProtectedMode?2200:1000);
 event('protected-end');
 if(!startupProtectedMode){
  report.additionalProtectedIntervals=[];report.roundtripOffControls=[];
  await requestProtectionViaToolbar(false);await affinity(false);await page.mouse.move(5,5);await sleep(400);
  await page.evaluate(()=>{const m=document.getElementById('capture-canary');m.style.width='340px';m.textContent='PUBLIC_OFF_CYCLE_1';});await sleep(300);
  event('runtime-off-control-1');const firstOffStart=Date.now();await sleep(1000);report.roundtripOffControls.push({start:firstOffStart,end:Date.now()});
  for(let cycle=2;cycle<=3;cycle++){
   event('runtime-on-request',{cycle});await requestProtectionViaToolbar(true);await affinity(true);await sleep(400);
   const start=Date.now();event('roundtrip-protected-start',{cycle});await sleep(1300);
   const end=Date.now();event('roundtrip-protected-end',{cycle});report.additionalProtectedIntervals.push({cycle,start,end});
   await requestProtectionViaToolbar(false);await affinity(false);await page.mouse.move(5,5);await sleep(400);
   await page.evaluate(c=>{const m=document.getElementById('capture-canary');m.style.width=`${300+c*40}px`;m.textContent=`PUBLIC_OFF_CYCLE_${c}`;},cycle);await sleep(300);
   event('runtime-off-control',{cycle});const offStart=Date.now();await sleep(1000);report.roundtripOffControls.push({cycle,start:offStart,end:Date.now()});
  }
  report.rendererAfter=await page.evaluate(async()=>({token:window.__capturePreserveToken,draft:document.querySelector('.answer-input input').value,alpha:getComputedStyle(document.documentElement).getPropertyValue('--app-alpha').trim(),session:document.querySelector('select.session-select').value,settingsOpacity:(await window.mc.getSettings()).ui.opacity}));
  report.windowAfter=await state();assert.deepEqual(report.rendererAfter,report.rendererBefore,'renderer/session/draft/CSS opacity must survive without rebuilding');
  for(const key of ['id','webContentsId','handle','opacity'])assert.equal(report.windowAfter[key],report.windowBefore[key],`same window ${key} must survive`);
  report.runtimeRoundtripVerified=true;event('visible-post-control',{process:'same production main HWND after three actual UI ON/OFF cycles'});await sleep(1200);
 }else{
 // Preserve the observed runtime-off issue; do not bypass it or mark it fixed.
 report.knownIssue='Prior diagnostic v3: production setStealth(false) returned false and settings became false, but correct main HWND remained protected=true/native affinity17 after normal show and 8s. This diagnostic retains that finding. Fresh startup protected mode uses no runtime toggles; post-control uses a separate fresh OFF production process.';
 event('fresh-post-control-launch');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.fromId(globalThis.__captureMain).hide());
 postProfile=mkdtempSync(join(tmpdir(),'mc-native-post-control-'));
 writeFileSync(join(postProfile,'settings.json'),JSON.stringify({version:2,onboarding:{schemaVersion:1,completed:true},asr:{backend:'cloud'},ui:{lang:'en',autoLaunch:false,opacity:1,stealth:false,hotkeyToggle:'',hotkeyShot:''}}));
 writeFileSync(join(postProfile,'sessions.json'),JSON.stringify({version:1,currentId:seed.id,sessions:[seed]}));
 postApp=await _electron.launch({args:[root],cwd:root,env:{...env,MC_USERDATA:postProfile},timeout:30000});
 const postPage=await postApp.firstWindow();await postPage.locator('.turn-body').getByText('PUBLIC_CANARY_7391',{exact:false}).waitFor();
 report.postControl=await postApp.evaluate(({BrowserWindow,app})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html'));w.setBounds({x:100,y:100,width:800,height:560});w.show();w.focus();return{userData:app.getPath('userData'),pid:process.pid,id:w.id,url:w.webContents.getURL(),protected:w.isContentProtected(),handle:w.getNativeWindowHandle().readBigUInt64LE().toString()};});
 assert.equal(resolve(report.postControl.userData),resolve(postProfile));
 report.postControl.native=JSON.parse(native(['-Mode','Affinity','-Handle',report.postControl.handle]));
 assert.equal(report.postControl.protected,false);assert.equal(report.postControl.native.ok,true);assert.equal(report.postControl.native.affinity,0);
 await postPage.evaluate(()=>{const marker=document.createElement('div');marker.textContent='PUBLIC_CANARY_7391';marker.style.cssText='position:fixed;bottom:0;left:0;width:300px;height:35px;background:#ff00ff;color:#000;font:20px monospace;z-index:2147483647;pointer-events:none';document.body.append(marker);});
 event('visible-post-control',{process:'fresh independent unprotected production app',pid:report.postControl.pid});await sleep(1200);
 }
 report.sequenceCompleted=true;
} catch(error) {report.error=error.stack;process.exitCode=1;console.error(error);}
finally {
 event('stop');writeFileSync(join(output,'stop'),'stop');
 if(recorder){
  report.recorder=await Promise.race([recorderExit,sleep(15000).then(()=>({timeout:true}))]);
  if(report.recorder.timeout){recorder.kill();report.recorder.afterKill=await Promise.race([recorderExit,sleep(3000).then(()=>({timeout:true}))]);}
  if(report.recorder.code!==0){report.error??='BLOCKED: native recorder failed or cleanup timed out';process.exitCode=1;}
 }
 if(postApp)await Promise.race([postApp.close(),sleep(10000).then(()=>{throw new Error('Post-control close timed out');})]).catch(e=>{report.cleanupError=e.message;postApp.process()?.kill();process.exitCode=1;});
 if(controlApp)await Promise.race([controlApp.close(),sleep(10000).then(()=>{throw new Error('Control-background close timed out');})]).catch(e=>{report.cleanupError=e.message;controlApp.process()?.kill();process.exitCode=1;});
 if(app)await Promise.race([app.close(),sleep(10000).then(()=>{throw new Error('Electron close timed out');})]).catch(e=>{report.cleanupError=e.message;app.process()?.kill();process.exitCode=1;});
 writeFileSync(join(output,'run.json'),JSON.stringify(report,null,2));
 rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:300});
 if(postProfile)rmSync(postProfile,{recursive:true,force:true,maxRetries:10,retryDelay:300});
 if(protectedProfile)rmSync(protectedProfile,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
