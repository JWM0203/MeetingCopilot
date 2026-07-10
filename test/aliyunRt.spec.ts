import { describe, expect, it } from 'vitest';
import { f32ToPcm16, languageHints, parseServerEvent } from '../electron/asr/aliyunRealtimeEngine';

describe('f32ToPcm16', () => {
  it('converts and clamps float32 to int16 LE', () => {
    const buf = f32ToPcm16(new Float32Array([0, 1, -1, 0.5, 2, -2]));
    expect(buf.length).toBe(12);
    expect(buf.readInt16LE(0)).toBe(0);
    expect(buf.readInt16LE(2)).toBe(0x7fff);
    expect(buf.readInt16LE(4)).toBe(-0x8000);
    expect(buf.readInt16LE(6)).toBe(Math.floor(0.5 * 0x7fff));
    expect(buf.readInt16LE(8)).toBe(0x7fff); // clamped
    expect(buf.readInt16LE(10)).toBe(-0x8000); // clamped
  });

  it('handles empty input', () => {
    expect(f32ToPcm16(new Float32Array(0)).length).toBe(0);
  });
});

describe('languageHints', () => {
  it('maps explicit languages and omits for auto', () => {
    expect(languageHints('chinese')).toEqual(['zh']);
    expect(languageHints('english')).toEqual(['en']);
    expect(languageHints('auto')).toBeUndefined();
    expect(languageHints(undefined)).toBeUndefined();
  });
});

describe('parseServerEvent', () => {
  it('parses a result-generated payload', () => {
    const ev = parseServerEvent(
      JSON.stringify({
        header: { event: 'result-generated', task_id: 't1' },
        payload: {
          output: {
            sentence: { begin_time: 170, end_time: 920, text: '好，我知道了', sentence_end: true },
          },
        },
      }),
    );
    expect(ev?.header?.event).toBe('result-generated');
    expect(ev?.payload?.output?.sentence?.sentence_end).toBe(true);
    expect(ev?.payload?.output?.sentence?.text).toBe('好，我知道了');
  });

  it('parses task-failed error fields', () => {
    const ev = parseServerEvent(
      JSON.stringify({
        header: { event: 'task-failed', error_code: 'CLIENT_ERROR', error_message: 'request timeout' },
        payload: {},
      }),
    );
    expect(ev?.header?.error_code).toBe('CLIENT_ERROR');
  });

  it('returns null on garbage', () => {
    expect(parseServerEvent('not json')).toBeNull();
    expect(parseServerEvent('42')).toBeNull();
  });
});
