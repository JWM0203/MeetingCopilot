import { PcmCapture } from './pcmCapture';

/** Windows system audio; the main process supplies Electron's loopback source. */
export class LoopbackCapture extends PcmCapture {
  start(onPcm: (pcm: ArrayBuffer, captureTs: number) => void): Promise<void> {
    return this.startStream(
      () => navigator.mediaDevices.getDisplayMedia({ audio: true, video: true }),
      onPcm,
    );
  }
}
