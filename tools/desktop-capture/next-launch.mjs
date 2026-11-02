/** Real desktop next-launch preference regression; no runtime protection setter. */
import assert from 'node:assert/strict';
import { spawn,execFileSync } from 'node:child_process';
import { mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { _electron } from 'playwright';
import { isolatedEnvironment } from '../smoke-verdict.mjs';
const root=resolve(import.meta.dirname,'../..'),output=join(root,'release/smoke/desktop-capture-next-launch');
rmSync(output,{recursive:true,force:true});mkdirSync(output,{recursive:true});
const profile=mkdtempSync(join(tmpdir(),'mc-next-launch-')),backgroundProfile=mkdtempSync(join(tmpdir(),'mc-next-launch-background-'));
const settings={version:2,onboarding:{schemaVersion:1,completed:true},asr:{backend:'cloud'},ui:{lang:'en',autoLaunch:false,opacity:.6,hotkeyToggle:'Control+Alt+F10',hotkeyShot:''}};
writeFileSync(join(profile,'settings.json'),JSON.stringify(settings)); // Intentionally omit stealth: verify default ON.
writeFileSync(join(backgroundProfile,'settings.json'),JSON.stringify({...settings,ui:{...settings.ui,stealth:false,hotkeyToggle:''}}));
const seed={id:'capture-fixture',name:'PUBLIC_CAPTURE_CANARY',createdAt:1,turns:[{id:'canary',kind:'free',label:'PUBLIC CAPTURE TEST',text:'PUBLIC_CANARY_7391 synthetic next-launch test',status:'done'}],segments:[],resumeText:'',jdText:'',memo:''};
writeFileSync(join(profile,'sessions.json'),JSON.stringify({version:1,currentId:seed.id,sessions:[seed]}));
const report={mode:'next-launch-preference-regression',backend:'Windows GDI BitBlt(SRCCOPY|CAPTUREBLT)',events:[],launches:[],preferences:[],additionalProtectedIntervals:[],roundtripOffControls:[],scope:'Synthetic public fixtures. Windows Server GDI only, not Win11, macOS or meeting remote viewer.'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const poll=async(fn,label,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(75);}throw Error('BLOCKED: '+label);};
const event=(stage,detail={})=>{const e={stage,ms:Date.now(),...detail};report.events.push(e);writeFileSync(join(output,'events.json'),JSON.stringify(report.events,null,2));return e;};
const native=args=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',join(import.meta.dirname,'native.ps1'),...args],{encoding:'utf8',timeout:10000}));
let app,page,bgApp,recorder,recorderExit;
const env=isolatedEnvironment(process.env);delete env.ELECTRON_RENDERER_URL;
async function state(){return app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.fromId(globalThis.__captureMain);return{id:w.id,webContentsId:w.webContents.id,visible:w.isVisible(),protected:w.isContentProtected(),opacity:w.getOpacity(),handle:w.getNativeWindowHandle().readBigUInt64LE().toString()};});}
async function affinity(expected){const s=await state(),n=native(['-Mode','Affinity','-Handle',s.handle]);(report.affinity??=[]).push({ms:Date.now(),expected,window:s,native:n});assert.equal(n.ok,true);assert.equal(n.affinity,expected?17:0);assert.equal(s.protected,expected);return s;}
async function closeApp(){const closing=app;await Promise.race([closing.close(),sleep(10000).then(()=>{throw Error('Normal app.quit timed out');})]);assert.equal(closing.process().exitCode,0);app=null;}
async function launch(expected){
 app=await _electron.launch({args:[root],cwd:root,env:{...env,MC_USERDATA:profile},timeout:30000});page=await app.firstWindow();await page.locator('.turn-body').getByText('PUBLIC_CANARY_7391',{exact:false}).waitFor();
 const identity=await app.evaluate(({BrowserWindow,globalShortcut,app})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html'));globalThis.__captureMain=w.id;w.setBounds({x:100,y:100,width:800,height:560});w.show();w.focus();return{pid:process.pid,userData:app.getPath('userData'),hotkeyRegistered:globalShortcut.isRegistered('Control+Alt+F10')};});
 assert.equal(resolve(identity.userData),resolve(profile));assert.equal(identity.hotkeyRegistered,true);
 const s=await page.evaluate(()=>window.mc.getSettings());assert.equal(s.contentProtection.actual,expected);assert.equal(s.contentProtection.ok,true);assert.equal(s.ui.stealth,expected);
 await page.evaluate(()=>{const m=document.createElement('div');m.id='capture-canary';m.textContent='PUBLIC_CANARY_7391';m.style.cssText='position:fixed;bottom:0;left:0;width:300px;height:35px;background:#ff00ff;color:#000;font:20px monospace;z-index:2147483647;pointer-events:none';document.body.append(m);});
 report.launches.push({ms:Date.now(),expected,identity,settings:s.ui,window:await affinity(expected)});await sleep(300);
}
async function preference(requested,current){
 const before=await state(),button=page.locator('.protection-next');
 const notice=await page.locator('.protection-update').innerText();assert.match(notice,/Save your work, then Quit normally and reopen/);assert.match(notice,/Hiding to the tray does not apply changes/);assert.match(notice,/no automatic restart/);
 assert.equal(await page.locator('.protection-current').innerText(),`Current protection: ${current?'On':'Off'}`);
 assert.equal(await button.getAttribute('aria-pressed'),String(!requested));
 await button.click();await poll(async()=>await button.isEnabled()&&await button.getAttribute('aria-pressed')===String(requested),'preference save acknowledgement');
 const saved=await page.evaluate(()=>window.mc.getSettings());assert.equal(saved.ui.stealth,requested);assert.equal(saved.contentProtection.actual,current);assert.equal(saved.contentProtection.ok,true);
 assert.equal(JSON.parse(readFileSync(join(profile,'settings.json'),'utf8')).ui.stealth,requested,'preference must actually reach disk before normal quit');
 assert.equal(await button.innerText(),`Next launch: ${requested?'On':'Off'}`);assert.equal(await page.locator('.protection-current').innerText(),`Current protection: ${current?'On':'Off'}`);await page.locator('.protection-pending').waitFor();
 const after=await affinity(current);assert.equal(after.handle,before.handle);assert.equal(after.webContentsId,before.webContentsId);assert.equal(after.opacity,before.opacity);
 report.preferences.push({ms:Date.now(),requested,current,before,after,settingsPreference:saved.ui.stealth,acknowledgement:saved.contentProtection,pendingText:await page.locator('.protection-pending').innerText(),diskSaved:true,notice});event('preference-saved-current-state-unchanged',{requested,current});await sleep(900);
}
try{
 assert.equal(process.platform,'win32');
 bgApp=await _electron.launch({args:[root],cwd:root,env:{...env,MC_USERDATA:backgroundProfile},timeout:30000});await(await bgApp.firstWindow()).locator('select.session-select').waitFor();
 report.host=await bgApp.evaluate(async({BrowserWindow,screen})=>{const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html'));main.hide();const display=screen.getPrimaryDisplay();const b=new BrowserWindow({...display.bounds,frame:false,skipTaskbar:true,webPreferences:{contextIsolation:true}});await b.loadURL('data:text/html,'+encodeURIComponent('<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:repeating-conic-gradient(#20c0b0 0% 25%,#e0c040 0% 50%) 0/160px 160px}i{position:fixed;left:0;top:0;width:16px;height:16px;background:red}</style><i></i><script>setInterval(()=>document.querySelector("i").style.background=Date.now()%500<250?"red":"blue",100)</script>'));b.setBounds(display.bounds);b.show();return{display,electron:process.versions.electron};});
 recorder=spawn('powershell.exe',['-NoProfile','-File',join(import.meta.dirname,'native.ps1'),'-Output',output],{stdio:['ignore','pipe','pipe']});recorder.stdout.on('data',d=>process.stdout.write(d));recorder.stderr.on('data',d=>process.stderr.write(d));recorderExit=new Promise(r=>{recorder.on('exit',(code,signal)=>r({code,signal}));recorder.on('error',e=>r({error:e.message}));});
 await poll(()=>existsSync(join(output,'ready')),'recorder readiness');
 await poll(()=>{try{const f=readFileSync(join(output,'frames.jsonl'),'utf8').replace(/^\uFEFF/,'').trim().split('\n').map(JSON.parse).slice(-10);return f.length===10&&f.every(x=>x.nonBackground/x.samples<.001&&x.canary===0);}catch{return false;}},'ten clean native baseline frames',12000);
 event('baseline');await sleep(700);await launch(true);event('protected-start');
 await preference(false,true);
 await page.getByRole('button',{name:'New session',exact:true}).hover();await page.locator('.surface-hint').waitFor();event('protected-hover');await sleep(900);await page.keyboard.press('Escape');
 for(let i=0;i<4;i++){const before=await state();execFileSync('powershell.exe',['-NoProfile','-File',join(import.meta.dirname,'native.ps1'),'-Mode','Hotkey'],{timeout:10000});await poll(async()=>(await state()).visible!==before.visible,'actual native hotkey visibility');await affinity(true);event('native-hotkey-confirmed',{iteration:i,...await state()});await sleep(600);}
 event('protected-end');await closeApp();event('normal-quit-before-OFF-relaunch');await launch(false);event('visible-positive-control');await sleep(1500);event('visible-hover-control');
 await preference(true,false);
 for(let cycle=1;cycle<=3;cycle++){await page.evaluate(c=>{const m=document.getElementById('capture-canary');m.style.width=`${300+c*40}px`;m.textContent=`PUBLIC_OFF_CYCLE_${c}`;},cycle);await sleep(300);const start=Date.now();event('OFF-dynamic-redraw',{cycle});await sleep(700);report.roundtripOffControls.push({cycle,start,end:Date.now()});}
 event('visible-post-control');await sleep(1200);await closeApp();event('normal-quit-before-ON-relaunch');await launch(true);
 const start=Date.now();event('final-protected-start');await sleep(1800);report.additionalProtectedIntervals.push({start,end:Date.now()});event('final-protected-end');report.sequenceCompleted=true;
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error);}
finally{
 event('stop');writeFileSync(join(output,'stop'),'stop');
 if(recorder){report.recorder=await Promise.race([recorderExit,sleep(12000).then(()=>({timeout:true}))]);if(report.recorder.timeout){recorder.kill();await Promise.race([recorderExit,sleep(3000)]);}if(report.recorder.code!==0){report.error??='Recorder failed';process.exitCode=1;}}
 for(const a of [app,bgApp])if(a)await Promise.race([a.close(),sleep(10000).then(()=>{throw Error('Cleanup timeout');})]).catch(e=>{report.cleanupError=e.message;a.process()?.kill();process.exitCode=1;});
 writeFileSync(join(output,'run.json'),JSON.stringify(report,null,2));for(const p of [profile,backgroundProfile])rmSync(p,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
