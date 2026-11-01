/** Diagnostic-only official Electron setter matrix. No native setter, security change or renderer migration. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { _electron } from 'playwright';
import { isolatedEnvironment } from '../smoke-verdict.mjs';
const root=resolve(import.meta.dirname,'../..'),output=join(root,'release/smoke/runtime-protection-matrix');
rmSync(output,{recursive:true,force:true});mkdirSync(output,{recursive:true});
const profile=mkdtempSync(join(tmpdir(),'mc-protection-matrix-'));
writeFileSync(join(profile,'settings.json'),JSON.stringify({version:2,onboarding:{schemaVersion:1,completed:true},asr:{backend:'cloud'},ui:{lang:'en',stealth:false,opacity:1,autoLaunch:false,hotkeyToggle:'',hotkeyShot:''}}));
const report={purpose:'Identify dynamic setter behavior vs window configuration; not a universal capture/privacy pass',backend:'Windows GDI BitBlt(SRCCOPY|CAPTUREBLT)',events:[],cases:[],getLastError:'Unavailable for Electron internal SetWindowDisplayAffinity: it executes on another thread/process. Never substitute this recorder process GetLastError as setter evidence.'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label,ms=12000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(80);}throw new Error(label);};
const native=handle=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',join(import.meta.dirname,'native.ps1'),'-Mode','Affinity','-Handle',handle],{encoding:'utf8',timeout:8000}));
const event=(stage,extra={})=>{const e={stage,ms:Date.now(),...extra};report.events.push(e);writeFileSync(join(output,'events.json'),JSON.stringify(report.events,null,2));return e;};
let app,page,recorder,recorderExit;
const state=id=>app.evaluate(({BrowserWindow},id)=>{const w=BrowserWindow.fromId(id);return{id:w.id,visible:w.isVisible(),protected:w.isContentProtected(),bounds:w.getBounds(),opacity:w.getOpacity(),alwaysOnTop:w.isAlwaysOnTop(),handle:w.getNativeWindowHandle().readBigUInt64LE().toString()};},id);
async function observe(id,label,extra={}){const s=await state(id);const n=native(s.handle);const e=event(label,{...extra,window:s,native:n});report.lastObservationMs=e.ms;await sleep(650);return e;}
try{
 assert.equal(process.platform,'win32');const env=isolatedEnvironment(process.env);delete env.ELECTRON_RENDERER_URL;
 app=await _electron.launch({args:[root],cwd:root,env:{...env,MC_USERDATA:profile},timeout:45000});page=await app.firstWindow();await page.locator('select.session-select').waitFor();
 report.host=await app.evaluate(async({BrowserWindow,screen,app})=>{
  const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html'));globalThis.__matrixMain=main.id;main.hide();
  const b=screen.getPrimaryDisplay().bounds;
  const bg=new BrowserWindow({...b,frame:false,skipTaskbar:true,enableLargerThanScreen:true,webPreferences:{contextIsolation:true}});globalThis.__matrixBackground=bg.id;
  await bg.loadURL('data:text/html,'+encodeURIComponent('<style>html,body{margin:0;width:100%;height:100%;background:repeating-conic-gradient(#20c0b0 0% 25%,#e0c040 0% 50%) 0/160px 160px}i{position:fixed;top:0;left:0;width:16px;height:16px}</style><i></i><script>setInterval(()=>document.querySelector("i").style.background=Date.now()%500<250?"red":"blue",100)</script>'));bg.setBounds(b);bg.show();main.setBounds({x:100,y:100,width:800,height:560});
  return {electron:process.versions.electron,chrome:process.versions.chrome,display:screen.getPrimaryDisplay(),mainId:main.id,userData:app.getPath('userData'),pid:process.pid};
 });
 recorder=spawn('powershell.exe',['-NoProfile','-File',join(import.meta.dirname,'native.ps1'),'-Output',output],{stdio:['ignore','pipe','pipe']});recorder.stderr.on('data',d=>process.stderr.write(d));recorder.stdout.on('data',d=>process.stdout.write(d));recorderExit=new Promise(r=>{recorder.on('exit',(code,signal)=>r({code,signal}));recorder.on('error',e=>r({error:e.message}));});
 await wait(()=>existsSync(join(output,'ready')),'Native capture did not start');
 // Natural notification expiration only. Every pre-baseline frame remains recorded.
 event('await-natural-clean-baseline');await wait(()=>{try{const f=readFileSync(join(output,'frames.jsonl'),'utf8').replace(/^\uFEFF/,'').trim().split('\n').map(JSON.parse).slice(-10);return f.length===10&&f.every(x=>x.nonBackground/x.samples<.001);}catch{return false;}},'No clean native baseline');event('baseline');await sleep(500);
 await page.evaluate(()=>{const m=document.createElement('div');m.textContent='PUBLIC_MATRIX_CANARY';m.style.cssText='position:fixed;bottom:0;left:0;background:#ff00ff;color:black;width:320px;height:40px;font:20px monospace;z-index:2147483647';document.body.append(m);});
 await app.evaluate(({BrowserWindow},id)=>{const w=BrowserWindow.fromId(id);w.show();w.focus();},report.host.mainId);
 const mainCase={name:'production-main',options:{transparent:true,frame:false,alwaysOnTop:true,level:'screen-saver',opacity:1},observations:[]};report.cases.push(mainCase);
 mainCase.observations.push(await observe(report.host.mainId,'production-initial-OFF'));
 const ipc=await page.evaluate(()=>window.mc.setStealth(true));mainCase.observations.push(await observe(report.host.mainId,'production-IPC-ON',{returned:ipc}));
 for(const requested of [true,false]){
  const call=await app.evaluate(({BrowserWindow},{id,requested})=>{const w=BrowserWindow.fromId(id);try{const ret=w.setContentProtection(requested);return{returned:ret??null,actual:w.isContentProtected()};}catch(e){return{error:e.message,actual:w.isContentProtected()};}},{id:report.host.mainId,requested});
  mainCase.observations.push(await observe(report.host.mainId,'production-direct-'+(requested?'ON':'OFF'),{requested,call}));
 }
 await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).hide(),report.host.mainId);
 const cases=[
  {name:'opaque-framed-normal',transparent:false,frame:true,alwaysOnTop:false,opacity:1},
  {name:'opaque-frameless-top',transparent:false,frame:false,alwaysOnTop:true,opacity:1},
  {name:'transparent-frameless-normal',transparent:true,frame:false,alwaysOnTop:false,opacity:1},
  {name:'transparent-frameless-top',transparent:true,frame:false,alwaysOnTop:true,opacity:1},
  {name:'opaque-with-opacity',transparent:false,frame:false,alwaysOnTop:true,opacity:.85},
 ];
 for(const config of cases){
  const id=await app.evaluate(async({BrowserWindow},c)=>{
   const w=new BrowserWindow({x:150,y:150,width:640,height:400,show:false,frame:c.frame,transparent:c.transparent,alwaysOnTop:c.alwaysOnTop,skipTaskbar:true,backgroundColor:c.transparent?'#00000000':'#233344',webPreferences:{contextIsolation:true}});
   w.setContentProtection(false);if(c.opacity!==1)w.setOpacity(c.opacity);
   await w.loadURL('data:text/html,'+encodeURIComponent(`<body style="margin:0;background:#233344;color:white;font:24px sans-serif"><h2>${c.name}</h2><p>PUBLIC_MATRIX_CANARY</p><div style="background:#ff00ff;color:black;height:50px">PUBLIC_MATRIX_CANARY</div></body>`));w.show();w.focus();return w.id;
  },config);
  const c={name:config.name,options:config,id,observations:[]};report.cases.push(c);c.observations.push(await observe(id,config.name+'-initial-OFF'));
  for(const requested of [true,false,true,false]){
   const call=await app.evaluate(({BrowserWindow},{id,requested})=>{const w=BrowserWindow.fromId(id);try{w.setContentProtection(requested);return{actual:w.isContentProtected()};}catch(e){return{error:e.message,actual:w.isContentProtected()};}},{id,requested});
   c.observations.push(await observe(id,config.name+'-'+(requested?'ON':'OFF'),{requested,call}));
  }
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).close(),id);
 }
 // Recreate a diagnostic window only; never transplant or destroy the production renderer.
 for(const requested of [true,false]){
  const id=await app.evaluate(async({BrowserWindow},requested)=>{const w=new BrowserWindow({x:150,y:150,width:640,height:400,show:false,transparent:true,frame:false,alwaysOnTop:true,webPreferences:{contextIsolation:true}});w.setContentProtection(requested);await w.loadURL('data:text/html,'+encodeURIComponent('<body style="background:#233344;color:white;font:24px sans-serif">Fresh target state<div style="background:#ff00ff;color:black">PUBLIC_MATRIX_CANARY</div></body>'));w.show();return w.id;},requested);
  const c={name:'fresh-hidden-created-'+(requested?'ON':'OFF'),observations:[await observe(id,'fresh-created-'+(requested?'ON':'OFF'),{requested})]};report.cases.push(c);await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).close(),id);
 }
 event('matrix-complete');report.sequenceCompleted=true;
}catch(e){report.error=e.stack;console.error(e);process.exitCode=1;}
finally{
 event('stop');writeFileSync(join(output,'stop'),'stop');
 if(recorder){
  report.recorder=await Promise.race([recorderExit,sleep(10000).then(()=>({timeout:true}))]);
  if(report.recorder.timeout){recorder.kill();report.recorder.afterKill=await Promise.race([recorderExit,sleep(3000).then(()=>({timeout:true}))]);}
  if(report.recorder.code!==0){report.captureError='Native recorder failed/timed out';process.exitCode=1;}
 }
 try{
  const frames=readFileSync(join(output,'frames.jsonl'),'utf8').replace(/^\uFEFF/,'').trim().split('\n').filter(Boolean).map(JSON.parse);
  report.capture={frames:frames.length,lastFrameEnd:frames.at(-1)?.endMs,lastObservationMs:report.lastObservationMs,canaryFrames:frames.filter(f=>f.canary>100).length,heartbeatStates:new Set(frames.map(f=>f.heartbeat)).size};
  report.captureCoverageComplete=report.recorder?.code===0&&frames.length>20&&report.capture.canaryFrames>0&&report.capture.heartbeatStates>1&&report.capture.lastFrameEnd>=report.lastObservationMs+300;
  if(!report.captureCoverageComplete){report.captureError??='Native capture missing/blank/frozen or truncated before final observation';process.exitCode=1;}
 }catch(e){report.captureCoverageComplete=false;report.captureError=e.message;process.exitCode=1;}
 report.completed=report.sequenceCompleted===true&&report.captureCoverageComplete===true&&!report.error;
 if(app)await Promise.race([app.close(),sleep(10000).then(()=>{throw new Error('App close timed out');})]).catch(e=>{report.cleanupError=e.message;report.completed=false;app.process()?.kill();process.exitCode=1;});
 writeFileSync(join(output,'matrix.json'),JSON.stringify(report,null,2));
 // Analyzer intentionally cannot certify this matrix as a normal protected sequence.
 // Its video writer still packages all native frames; matrix.json is the result source.
 writeFileSync(join(output,'run.json'),JSON.stringify(report,null,2));
 rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
