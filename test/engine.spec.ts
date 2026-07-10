import { describe, expect, it } from 'vitest';
import { halfToFloat, isJunkTranscript } from '../electron/asr/engine';

describe('halfToFloat', () => {
  it('decodes common fp16 bit patterns', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x0000)).toBe(0);
    expect(halfToFloat(0x7bff)).toBe(65504); // max half
    expect(halfToFloat(0x3555)).toBeCloseTo(1 / 3, 3);
  });

  it('preserves ordering across the sign boundary (the raw-uint16 trap)', () => {
    // raw uint16: 0xC500 (=-5) > 0x3C00 (=1) — decoded comparison must flip that
    expect(halfToFloat(0xc500)).toBeLessThan(halfToFloat(0x3c00));
  });

  it('handles subnormals and infinities', () => {
    expect(halfToFloat(0x0001)).toBeCloseTo(2 ** -24, 30);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(halfToFloat(0xfc00)).toBe(-Infinity);
    expect(Number.isNaN(halfToFloat(0x7e00))).toBe(true);
  });
});

describe('isJunkTranscript', () => {
  it('filters empty and punctuation-only output', () => {
    expect(isJunkTranscript('')).toBe(true);
    expect(isJunkTranscript('   ')).toBe(true);
    expect(isJunkTranscript(' . ')).toBe(true);
    expect(isJunkTranscript('。。。')).toBe(true);
    expect(isJunkTranscript('~~~')).toBe(true);
  });

  it('filters classic whisper hallucinations (zh + en)', () => {
    expect(isJunkTranscript('谢谢观看')).toBe(true);
    expect(isJunkTranscript('谢谢大家')).toBe(true);
    expect(isJunkTranscript('请不吝点赞 订阅 转发 打赏')).toBe(true);
    expect(isJunkTranscript('字幕由阿明制作')).toBe(true);
    expect(isJunkTranscript('Thank you for watching!')).toBe(true);
    expect(isJunkTranscript('Please like and subscribe')).toBe(true);
    expect(isJunkTranscript('Subtitles by the community')).toBe(true);
  });

  it('keeps real speech', () => {
    expect(isJunkTranscript('你好，世界')).toBe(false);
    expect(isJunkTranscript('Hello world')).toBe(false);
    expect(isJunkTranscript('我们要感谢客户的信任，继续推进项目')).toBe(false);
    expect(isJunkTranscript('Thank you for the introduction, let me answer that')).toBe(false);
  });
});
