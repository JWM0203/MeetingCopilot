import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MicCapture } from '../src/audio/micCapture';
import { LoopbackCapture } from '../src/audio/loopbackCapture';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
let tracks: { stop: ReturnType<typeof vi.fn> }[];
let stream: MediaStream;
let acquire: ReturnType<typeof vi.fn>;
let addModule: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
let resume: ReturnType<typeof vi.fn>;
beforeEach(() => {
  tracks = [{ stop: vi.fn() }];
  stream = { getTracks: () => tracks, getAudioTracks: () => tracks, getVideoTracks: () => [] } as unknown as MediaStream;
  acquire = vi.fn().mockResolvedValue(stream);
  addModule = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
  resume = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: acquire, getDisplayMedia: acquire } });
  vi.stubGlobal('AudioContext', class {
    state = 'suspended'; audioWorklet = { addModule }; close = close; resume = resume;
    destination = {}; createMediaStreamSource = () => ({ connect: vi.fn() });
    createGain = () => ({ gain: { value: 1 }, connect: vi.fn() });
  });
  vi.stubGlobal('AudioWorkletNode', class { port = { close: vi.fn() }; connect = vi.fn(); disconnect = vi.fn(); });
});
afterEach(() => vi.unstubAllGlobals());
for (const kind of ['mic', 'loopback'] as const) {
  describe(`${kind} transactional audio capture`, () => {
    const make = () => {
      const cap = kind === 'mic' ? new MicCapture() : new LoopbackCapture();
      const start = () => cap instanceof MicCapture ? cap.start(undefined, vi.fn()) : cap.start(vi.fn());
      return { cap, start };
    };
    it('coalesces double start, resumes suspended audio and releases on stop', async () => {
      const { cap, start } = make();
      await Promise.all([start(), start()]);
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(resume).toHaveBeenCalledTimes(1);
      expect(cap.running).toBe(true);
      await cap.stop();
      expect(cap.running).toBe(false);
      expect(tracks[0].stop).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    });
    it('cleans up failed setup and permits retry', async () => {
      const { cap, start } = make();
      addModule.mockRejectedValueOnce(new Error('worklet failed'));
      await expect(start()).rejects.toThrow('worklet failed');
      expect(cap.running).toBe(false);
      expect(tracks[0].stop).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      await start();
      expect(cap.running).toBe(true);
      await cap.stop();
    });
    it('stop cancels an outstanding permission request without leaking its eventual stream', async () => {
      const { cap, start } = make();
      const permission = deferred<MediaStream>();
      acquire.mockReturnValueOnce(permission.promise);
      const pending = start();
      await cap.stop();
      permission.resolve(stream);
      await expect(pending).rejects.toThrow('cancelled');
      expect(cap.running).toBe(false);
      expect(tracks[0].stop).toHaveBeenCalledTimes(1);
      expect(addModule).not.toHaveBeenCalled();
    });
    it('rejects empty audio streams and releases all tracks', async () => {
      stream.getAudioTracks = () => [];
      const { cap, start } = make();
      await expect(start()).rejects.toThrow('no audio track');
      expect(cap.running).toBe(false);
      expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    });
  });
}
