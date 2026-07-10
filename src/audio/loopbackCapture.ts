/**
 * System-audio loopback capture via getDisplayMedia. The main process's
 * setDisplayMediaRequestHandler answers with { audio: 'loopback' }, so this
 * captures the system mix without any native module (PLAN §4.2).
 */
export class LoopbackCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(onPcm: (pcm: ArrayBuffer, captureTs: number) => void): Promise<void> {
    if (this.ctx) return;
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    // video track is only there because getDisplayMedia requires it
    for (const t of stream.getVideoTracks()) t.stop();
    if (stream.getAudioTracks().length === 0) {
      throw new Error('loopback stream has no audio track');
    }

    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule('pcm-worklet.js');
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-worklet');
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      onPcm(e.data, Date.now());
    };
    // A worklet node is only pulled when connected towards the destination;
    // route through a zero gain so nothing is audible.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);

    this.ctx = ctx;
    this.stream = stream;
    this.node = node;
  }

  async stop(): Promise<void> {
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    if (this.ctx) {
      await this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
