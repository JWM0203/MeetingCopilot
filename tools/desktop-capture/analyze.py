"""Native-frame metrics + minimal MJPEG AVI (standard library; no downloaded encoder)."""
import json, struct, sys, pathlib, shutil, html
out = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'release/smoke/desktop-capture')
def load(name):
    return json.loads((out/name).read_text(encoding='utf-8-sig'))
def chunk(tag, data):
    return tag + struct.pack('<I',len(data)) + data + (b'\0' if len(data)%2 else b'')
def listing(tag, data): return chunk(b'LIST',tag+data)
report = {'verdict':'BLOCKED','limits':['GDI desktop only; not DXGI, Windows 11, macOS ScreenCaptureKit or meeting remote viewer.','Finite sampled sequence; cannot rule out sub-frame flashes or leakage outside canary/geometry.','Canary/pattern metrics flag suspicious pixels, not general-purpose OCR. Review video and selected frames.','Startup before baseline and intentional protection-setting transition excluded from protected assertion.']}
try:
    run, host = load('run.json'), load('native.json')
    report['mode']=run.get('mode')
    report['baselinePreparation']=run.get('baselinePreparation')
    report['uiGuardVerified']=run.get('uiGuardVerified',False)
    report['knownRuntimeOffIssue']=run.get('knownRuntimeOffIssue')
    frames=[json.loads(l) for l in (out/'frames.jsonl').read_text(encoding='utf-8-sig').splitlines()]
    assert len(frames)>30, 'too few native desktop frames'
    events=run['events']
    def at(stage): return next(e['ms'] for e in events if e['stage']==stage)
    def between(a,b): return [f for f in frames if f['startMs']>=at(a) and f['endMs']<=at(b)]
    baseline=between('baseline','visible-positive-control')
    # Native affinity verification before showing can delay this phase; only fully captured frames qualify.
    control=between('visible-positive-control','visible-hover-control')
    protected=between('protected-start','protected-end')
    post=between('visible-post-control','stop')
    for interval in run.get('additionalProtectedIntervals',[]):
        samples=[f for f in frames if f['startMs']>=interval['start'] and f['endMs']<=interval['end']]
        assert len(samples)>=10, 'roundtrip protected interval missing native frames'
        protected.extend(samples)
    for interval in run.get('roundtripOffControls',[]):
        samples=[f for f in frames if f['startMs']>=interval['start'] and f['endMs']<=interval['end']]
        assert sum(f['canary']>100 for f in samples)>=5, 'runtime OFF roundtrip visible canary missing'
    if run.get('mode')=='runtime-toggle-roundtrip-regression':
        assert run.get('runtimeRoundtripVerified') and len(run.get('uiProtectionRequests',[]))==6, 'six actual UI toggles and preserved renderer required'
    report['runtimeRoundtripVerified']=run.get('runtimeRoundtripVerified',False)
    assert baseline and control and protected and post, 'missing recorded phases'
    assert frames[-1]['endMs'] >= at('stop')-250, 'native recording ended before sequence completion'
    assert run.get('recorder',{}).get('code')==0, 'native recorder did not finish successfully'
    background_ok=[f for f in baseline if f['nonBackground']/f['samples']<0.001]
    assert len(background_ok)>=10, 'pattern baseline not visible: inactive desktop/occlusion/capture failure'
    assert len(set(f['heartbeat'] for f in frames))>1, 'heartbeat frozen: live native desktop not established'
    assert sum(f['canary']>100 for f in control)>=5, 'visible positive control absent from native frames'
    assert sum(f['canary']>100 for f in post)>=5, 'post-control absent: capture may have frozen or failed'
    gaps=[b['startMs']-a['startMs'] for a,b in zip(frames,frames[1:])]
    suspect=[f for f in protected if f['nonBackground']/f['samples']>0.001 or f['canary']>0]
    for f in suspect:
        f['stage']=max((e for e in events if e['ms']<=f['startMs']),key=lambda e:e['ms'])['stage']
    black=[f for f in protected if f['dark']/f['samples']>0.01]
    report.update(verdict='OBSERVED_ANOMALY' if suspect else 'NO_ANOMALY_IN_SAMPLED_FRAMES',
                  frameCount=len(frames), protectedFrameCount=len(protected), suspectFrameCount=len(suspect),
                  blackFrameCount=len(black), canaryFrameCount=sum(f['canary']>0 for f in protected),
                  suspiciousFrames=suspect, maxFrameStartGapMs=max(gaps),
                  actualMeanFps=round((len(frames)-1)*1000/(frames[-1]['startMs']-frames[0]['startMs']),2),
                  native=host, sequenceCompleted=run.get('sequenceCompleted',False),runError=run.get('error'))
    if not run.get('sequenceCompleted') or run.get('error') or run.get('cleanupError') or max(gaps)>250:
        report['verdict']='INCONCLUSIVE';report['reason']='sequence/cleanup failed or capture gap over 250 ms; inspect evidence'
except Exception as e:
    report['reason']=f'{type(e).__name__}: {str(e) or "required capture phase absent"}'
    if 'run' in locals():report['runError']=run.get('error')
# Always retain available raw capture evidence, including failed controls.
try:
    host=load('native.json');frames=[json.loads(l) for l in (out/'frames.jsonl').read_text(encoding='utf-8-sig').splitlines()]
    w,h=host['width'],host['height'];n=len(frames)
    report.setdefault('frameCount',n);report.setdefault('native',host)
    us=max(1,round((frames[-1]['endMs']-frames[0]['startMs'])*1000/n))
    avih=struct.pack('<14I',us,0,0,0x10,n,0,1,w*h*3,w,h,0,0,0,0)
    strh=struct.pack('<4s4sIHHIIIIIIIIhhhh',b'vids',b'MJPG',0,0,0,0,us,1000000,0,n,w*h*3,0xffffffff,0,0,0,w,h)
    strf=struct.pack('<IiiHH4sIiiII',40,w,h,1,24,b'MJPG',w*h*3,0,0,0,0)
    hdrl=listing(b'hdrl',chunk(b'avih',avih)+listing(b'strl',chunk(b'strh',strh)+chunk(b'strf',strf)))
    with (out/'desktop-native.avi').open('wb') as video:
        video.write(b'RIFF\0\0\0\0AVI '+hdrl);start=video.tell();video.write(b'LIST\0\0\0\0movi');index=[]
        for f in frames:
            data=(out/'frames'/f"{f['frame']:06}.jpg").read_bytes();offset=video.tell()-start-8
            index.append(struct.pack('<4sIII',b'00dc',0x10,offset,len(data)));video.write(chunk(b'00dc',data))
        end=video.tell();video.seek(start+4);video.write(struct.pack('<I',end-start-8));video.seek(end)
        video.write(chunk(b'idx1',b''.join(index)));size=video.tell();video.seek(4);video.write(struct.pack('<I',size-8))
    evidence=out/'selected-frames';evidence.mkdir(exist_ok=True);selected={}
    for e in load('events.json'):
        f=min(frames,key=lambda f:abs(f['startMs']-e['ms']-200));selected[f['frame']]=e['stage']
    for f in report.get('suspiciousFrames',[])[:30]:selected[f['frame']]='suspicious-protected-frame'
    rows=[]
    for number,label in sorted(selected.items()):
        name=f'{number:06}.jpg';shutil.copyfile(out/'frames'/name,evidence/name)
        f=frames[number];rows.append(f'<h3>Frame {number}: {html.escape(label)} — UTC epoch {f["startMs"]} ms</h3><img style="max-width:100%" src="selected-frames/{name}">')
    (out/'review.html').write_text('<!doctype html><meta charset="utf-8"><h1>Native Windows GDI desktop capture</h1><p>Use frames.jsonl for exact acquisition times. AVI playback uses mean sample interval, not exact wall-clock timestamps.</p>'+''.join(rows),encoding='utf-8')
    report['video']={'file':'desktop-native.avi','codec':'MJPEG','frameCount':n,'microsecondsPerFrame':us,'note':'Constant mean interval playback; authoritative per-frame start/end UTC timestamps are in frames.jsonl.'}
    # Video contains every original JPEG; retain all if video construction fails.
    shutil.rmtree(out/'frames')
except Exception as e:
    report['videoError']=str(e);report['verdict']='BLOCKED'
(out/'analysis.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='suspiciousFrames'},indent=2))
sys.exit(0 if report['verdict']=='NO_ANOMALY_IN_SAMPLED_FRAMES' else 1)
