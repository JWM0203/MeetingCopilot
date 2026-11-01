import { PcmCapture } from './pcmCapture';

/** Microphone or virtual audio input, using the same transactional PCM lifecycle. */
export class MicCapture extends PcmCapture {
  start(
    deviceId: string | undefined,
    onPcm: (pcm: ArrayBuffer, captureTs: number) => void,
    options: { audioProcessing?: boolean } = {},
  ): Promise<void> {
    const processing = options.audioProcessing ?? true;
    return this.startStream(() => navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: processing,
        noiseSuppression: processing,
        autoGainControl: processing,
      },
    }), onPcm);
  }
}

/** List available microphones (label populated only after a getUserMedia grant). */
export async function listMics(): Promise<{ deviceId: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label })); // '' → caller renders its default-mic label
}
