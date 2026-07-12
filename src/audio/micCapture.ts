/**
 * Standard audio-input capture. Used for the user's microphone and, on
 * platforms without Electron loopback, for the other-party channel (including
 * virtual inputs such as BlackHole). Feeds the same 16 kHz PCM worklet.
 */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(
    deviceId: string | undefined,
    onPcm: (pcm: ArrayBuffer, captureTs: number) => void,
    options: { audioProcessing?: boolean } = {},
  ): Promise<void> {
    if (this.ctx) return;
    const processing = options.audioProcessing ?? true;
    const constraints: MediaStreamConstraints = {
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: processing,
        noiseSuppression: processing,
        autoGainControl: processing,
      },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule('pcm-worklet.js');
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-worklet');
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onPcm(e.data, Date.now());
    // route through a muted gain so the node is pulled without echoing the mic
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

/** List available microphones (label populated only after a getUserMedia grant). */
export async function listMics(): Promise<{ deviceId: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || '麦克风' }));
}
