import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork } }));
import { RagHost } from '../electron/ragHost';
class Child extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  messages: any[] = [];
  kill = vi.fn(() => { this.emit('exit', 0); });
  postMessage(message: any) { this.messages.push(message); }
}
const ready = { phase:'ready', enabled:true, fileCount:0, chunkCount:0, failedCount:0 };
const options = {rootPath:'/library', indexDir:'/index', modelDir:'/models'};
const flush = async () => { for(let i=0;i<8;i++) await Promise.resolve(); };
function reply(child: Child) { const message = child.messages.at(-1); child.emit('message',{type:'ready',requestId:message.requestId,status:ready,documents:[]}); }
beforeEach(()=>mocks.fork.mockReset());
describe('RagHost recovery',()=>{
 it('recreates a failed initialization child and ignores stale progress',async()=>{
  const first = new Child(), second = new Child();
  mocks.fork.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const host = new RagHost();
  const start = host.start(options);
  const rejection = expect(start).rejects.toThrow('download failed');
  first.emit('message',{type:'error',requestId:first.messages[0].requestId,code:'MODEL_LOAD_FAILED',message:'download failed'});
  await rejection;
  expect(host.isRunning).toBe(false);
  expect(first.kill).toHaveBeenCalled();
  const retry=host.scan('/library'); await flush();
  expect(second.messages[0].type).toBe('init'); reply(second); await flush();
  expect(second.messages.at(-1).type).toBe('scan'); reply(second); await retry;
  first.emit('message',{type:'progress',status:{...ready,phase:'error'}});
  expect(host.currentStatus.phase).toBe('ready');
 });
 it('serializes scans and falls back on query timeout',async()=>{
  const child=new Child();mocks.fork.mockReturnValue(child);
  const host=new RagHost();const start=host.start(options);reply(child);await start;
  const one=host.scan('/library');const two=host.scan('/library',true);await flush();
  expect(child.messages.filter(m=>m.type==='scan')).toHaveLength(1);reply(child);await one;await flush();
  expect(child.messages.filter(m=>m.type==='scan')).toHaveLength(2);reply(child);await two;
  const result=await host.query({query:'hello',scope:{enabled:true}},1);
  expect(result).toMatchObject({fallback:'timeout',context:'',sources:[]});
  expect(child.messages.at(-1).type).toBe('cancel');
 });
 it('invalidates pending queries and queued scans immediately on stop', async()=>{
  const child=new Child();mocks.fork.mockReturnValue(child);
  const host=new RagHost();const start=host.start(options);reply(child);await start;
  const pending=host.query({query:'hello',scope:{enabled:true}},5000);
  const scan=host.scan('/library');
  const rejected=expect(scan).rejects.toThrow('cancelled');
  const stopped=host.stop();
  expect(host.currentStatus.phase).toBe('disabled');
  expect(host.currentDocuments).toEqual([]);
  child.emit('exit',0);
  await stopped;await rejected;
  expect(await pending).toMatchObject({context:'',sources:[],fallback:'error'});
 });

 it('drains worker output without copying private content to parent logs',async()=>{
  const child=new Child();mocks.fork.mockReturnValue(child);
  const host=new RagHost();const started=host.start(options);reply(child);await started;
  const stdout=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  const stderr=vi.spyOn(process.stderr,'write').mockImplementation(()=>true);
  try {
    child.stdout.emit('data',Buffer.from('private-document-sentinel'));
    child.stderr.emit('data',Buffer.from('private-path-sentinel'));
    expect(stdout).not.toHaveBeenCalled();expect(stderr).not.toHaveBeenCalled();
  } finally { stdout.mockRestore();stderr.mockRestore(); }
 });
 it('does not reject stop when child IPC closes concurrently',async()=>{
  const child=new Child();mocks.fork.mockReturnValue(child);
  const host=new RagHost();const started=host.start(options);reply(child);await started;
  child.postMessage=()=>{throw new Error('closed IPC')};
  await expect(host.stop()).resolves.toBeUndefined();
  expect(host.currentStatus.phase).toBe('disabled');
  expect(host.isRunning).toBe(false);
 });

});
