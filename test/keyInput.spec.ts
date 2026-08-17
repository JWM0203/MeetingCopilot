import { describe, expect, it } from 'vitest';
import { sanitizeApiKeyInput } from '../shared/keyInput';

describe('sanitizeApiKeyInput', () => {
  it('leaves a clean key untouched and reports nothing', () => {
    expect(sanitizeApiKeyInput('sk-abc123')).toEqual({ value: 'sk-abc123', warnings: [] });
  });

  it('handles the empty string', () => {
    expect(sanitizeApiKeyInput('')).toEqual({ value: '', warnings: [] });
    expect(sanitizeApiKeyInput('   ')).toEqual({ value: '', warnings: ['trimmed'] });
  });

  it('trims surrounding whitespace, newlines and tabs', () => {
    expect(sanitizeApiKeyInput('  sk-abc \n')).toEqual({ value: 'sk-abc', warnings: ['trimmed'] });
    expect(sanitizeApiKeyInput('\tsk-abc\r\n')).toEqual({ value: 'sk-abc', warnings: ['trimmed'] });
  });

  it('strips wrapping ASCII quotes', () => {
    expect(sanitizeApiKeyInput('"sk-abc"')).toEqual({ value: 'sk-abc', warnings: ['quotes'] });
    expect(sanitizeApiKeyInput("'sk-abc'")).toEqual({ value: 'sk-abc', warnings: ['quotes'] });
    expect(sanitizeApiKeyInput('`sk-abc`')).toEqual({ value: 'sk-abc', warnings: ['quotes'] });
  });

  it('strips wrapping full-width quotes pasted from Chinese documents', () => {
    expect(sanitizeApiKeyInput('“sk-abc”')).toEqual({ value: 'sk-abc', warnings: ['quotes'] });
    expect(sanitizeApiKeyInput('‘sk-abc’')).toEqual({ value: 'sk-abc', warnings: ['quotes'] });
  });

  it('strips a Bearer prefix copied out of a curl example', () => {
    expect(sanitizeApiKeyInput('Bearer sk-abc')).toEqual({ value: 'sk-abc', warnings: ['bearer'] });
    expect(sanitizeApiKeyInput('bearer\tsk-abc')).toEqual({ value: 'sk-abc', warnings: ['bearer'] });
    expect(sanitizeApiKeyInput('BEARER  sk-abc')).toEqual({ value: 'sk-abc', warnings: ['bearer'] });
  });

  it('peels layered wrappers in one call and reports each kind once', () => {
    const r = sanitizeApiKeyInput('  "Bearer sk-abc"  ');
    expect(r.value).toBe('sk-abc');
    expect(r.warnings.sort()).toEqual(['bearer', 'quotes', 'trimmed']);
  });

  it('reports each warning kind only once even across passes', () => {
    const r = sanitizeApiKeyInput('"  \'sk-abc\'  "');
    expect(r.value).toBe('sk-abc');
    expect(r.warnings.filter((w) => w === 'quotes')).toHaveLength(1);
  });

  it('never mutates interior characters', () => {
    expect(sanitizeApiKeyInput('sk-a b-c')).toEqual({ value: 'sk-a b-c', warnings: [] });
    expect(sanitizeApiKeyInput('sk-with"quote')).toEqual({ value: 'sk-with"quote', warnings: [] });
    expect(sanitizeApiKeyInput('sk-Bearer-token')).toEqual({
      value: 'sk-Bearer-token',
      warnings: [],
    });
  });

  it('does not unwrap ambiguous or unmatched quoting', () => {
    // unmatched
    expect(sanitizeApiKeyInput('"sk-abc')).toEqual({ value: '"sk-abc', warnings: [] });
    expect(sanitizeApiKeyInput("sk-abc'")).toEqual({ value: "sk-abc'", warnings: [] });
    // the quote also appears inside — guessing would corrupt the key
    expect(sanitizeApiKeyInput('"a"+"b"')).toEqual({ value: '"a"+"b"', warnings: [] });
    // an empty pair is not a key; keep it visible to the user
    expect(sanitizeApiKeyInput('""')).toEqual({ value: '""', warnings: [] });
  });

  it('does not treat a bare "bearer" word without separator as a prefix', () => {
    expect(sanitizeApiKeyInput('bearersk-abc')).toEqual({ value: 'bearersk-abc', warnings: [] });
  });
});
