/**
 * Accumulates 16 kHz mono input into 1600-sample (100 ms) Float32 frames and
 * posts them to the main thread. Runs on the audio rendering thread — keep it
 * allocation-light.
 */
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1600);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let i = 0;
      while (i < ch.length) {
        const take = Math.min(ch.length - i, this.buf.length - this.n);
        this.buf.set(ch.subarray(i, i + take), this.n);
        this.n += take;
        i += take;
        if (this.n === this.buf.length) {
          const out = this.buf;
          this.port.postMessage(out.buffer, [out.buffer]);
          this.buf = new Float32Array(1600);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
