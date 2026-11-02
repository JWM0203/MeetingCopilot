/** Own every resource during setup, including permission prompts and failed worklets. */
export class PcmCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private pending: Promise<void> | null = null;
  private generation = 0;

  get running(): boolean { return this.ctx !== null; }

  protected startStream(
    acquire: () => Promise<MediaStream>,
    onPcm: (pcm: ArrayBuffer, captureTs: number) => void,
  ): Promise<void> {
    if (this.pending) return this.pending;
    if (this.running) return Promise.resolve();
    const generation = ++this.generation;
    const run = async () => {
      let stream: MediaStream | null = null;
      let ctx: AudioContext | null = null;
      let node: AudioWorkletNode | null = null;
      const check = () => {
        if (generation !== this.generation) throw new Error('Audio capture start cancelled');
      };
      try {
        stream = await acquire();
        check();
        for (const track of stream.getVideoTracks()) track.stop();
        if (!stream.getAudioTracks().length) throw new Error('capture stream has no audio track');
        ctx = new AudioContext({ sampleRate: 16000 });
        await ctx.audioWorklet.addModule('pcm-worklet.js');
        check();
        const source = ctx.createMediaStreamSource(stream);
        node = new AudioWorkletNode(ctx, 'pcm-worklet');
        node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (generation === this.generation) onPcm(e.data, Date.now());
        };
        const mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(node);
        node.connect(mute);
        mute.connect(ctx.destination);
        if (ctx.state === 'suspended') await ctx.resume();
        check();
        this.ctx = ctx;
        this.stream = stream;
        this.node = node;
      } catch (error) {
        node?.port.close();
        node?.disconnect();
        for (const track of stream?.getTracks() ?? []) track.stop();
        await ctx?.close().catch(() => undefined);
        throw error;
      }
    };
    const pending = run().finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  async stop(): Promise<void> {
    ++this.generation;
    // Do not wait for a browser permission prompt: invalidate its eventual result.
    this.pending = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    await ctx?.close().catch(() => undefined);
  }
}
