import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DIAGNOSTIC_ERROR_LIMIT,
  LocalPythonProbe,
  buildDiagnosticsReport,
  clearDiagnosticErrors,
  recentDiagnosticErrors,
  recordDiagnosticError,
  type DiagnosticsFacts,
} from '../electron/diagnostics';
import { SettingsStore, type SecretCipher } from '../electron/settings';

const fakeCipher: SecretCipher = {
  available: () => true,
  secure: true,
  encrypt: (plain) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decrypt: (s) => (s.startsWith('enc:') ? Buffer.from(s.slice(4), 'base64').toString('utf8') : ''),
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-diag-'));
  clearDiagnosticErrors();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  clearDiagnosticErrors();
});

describe('recordDiagnosticError', () => {
  it('redacts on the way in, so the buffer never holds key material', () => {
    recordDiagnosticError('provider-test/text-llm', 'HTTP 401 for Bearer sk-livekey12345678');
    const [entry] = recentDiagnosticErrors();
    expect(entry.scope).toBe('provider-test/text-llm');
    expect(entry.message).not.toContain('livekey12345678');
    expect(entry.message).toContain('…[redacted]');
    expect(Date.parse(entry.at)).not.toBeNaN();
  });

  it('keeps only the newest 50 entries', () => {
    for (let i = 0; i < DIAGNOSTIC_ERROR_LIMIT + 20; i++) recordDiagnosticError('asr', `failure ${i}`);
    const all = recentDiagnosticErrors();
    expect(all).toHaveLength(DIAGNOSTIC_ERROR_LIMIT);
    expect(all[0].message).toBe('failure 20');
    expect(all.at(-1)!.message).toBe('failure 69');
  });

  it('truncates a pasted response body and drops empty messages', () => {
    recordDiagnosticError('asr', 'x'.repeat(2000));
    recordDiagnosticError('asr', '');
    const all = recentDiagnosticErrors();
    expect(all).toHaveLength(1);
    expect(all[0].message.length).toBe(400);
  });

  it('hands out copies, so a caller cannot mutate the buffer', () => {
    recordDiagnosticError('asr', 'boom');
    recentDiagnosticErrors()[0].message = 'tampered';
    expect(recentDiagnosticErrors()[0].message).toBe('boom');
  });
});

describe('LocalPythonProbe', () => {
  it('reports unknown until the probe settles, then yes', async () => {
    let release: () => void = () => undefined;
    const probe = new LocalPythonProbe(
      () => new Promise<string>((resolve) => (release = () => resolve('python'))),
    );
    expect(probe.status).toBe('unknown');
    probe.start();
    probe.start(); // idempotent
    expect(probe.status).toBe('unknown');
    release();
    await new Promise((r) => setTimeout(r, 5));
    expect(probe.status).toBe('yes');
  });

  it('reports no when no interpreter can be resolved', async () => {
    const probe = new LocalPythonProbe(() => Promise.reject(new Error('未找到可用 Python')));
    probe.start();
    await new Promise((r) => setTimeout(r, 5));
    expect(probe.status).toBe('no');
  });

  it('never blocks: a probe that has not answered yet stays unknown', async () => {
    const probe = new LocalPythonProbe(() => new Promise(() => undefined));
    probe.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(probe.status).toBe('unknown');
  });

  it('still records an answer that arrives long after the first report', async () => {
    let release: () => void = () => undefined;
    const probe = new LocalPythonProbe(
      () => new Promise<string>((resolve) => (release = () => resolve('python'))),
    );
    probe.start();
    await new Promise((r) => setTimeout(r, 30));
    expect(probe.status).toBe('unknown'); // the report was built with this
    release();
    await new Promise((r) => setTimeout(r, 5));
    expect(probe.status).toBe('yes'); // the next report gets the real answer
  });
});

/** a fully configured profile, exactly like a real user's */
function seededStore(): SettingsStore {
  const store = new SettingsStore(join(dir, 'settings.json'), fakeCipher);
  store.applyPatch({
    llm: {
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-deepseek-supersecret-0001',
      providerId: 'deepseek',
    },
    vision: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
      proxyUrl: '127.0.0.1:7897',
      apiKey: 'AIzaTOPSECRETvaluezz',
    },
    asr: {
      backend: 'cloud-realtime',
      language: 'chinese',
      // deliberately stale: an older build wrote MiMo here and the user has
      // since moved to Aliyun. The report must believe the endpoint, not this.
      providerId: 'mimo',
      realtime: {
        baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
        model: 'fun-asr-realtime',
        apiKey: 'sk-aliyun-supersecret-0002',
      },
    },
    ui: { lang: 'zh' },
    audio: { micEnabled: true },
  });
  store.recordVerification('llm', {
    lastTestAt: '2026-08-17T09:00:00.000Z',
    lastTestOk: true,
    lastTestCode: 'OK',
    latencyMs: 412,
  });
  store.recordVerification('asr-realtime', {
    lastTestAt: '2026-08-17T09:01:00.000Z',
    lastTestOk: false,
    lastTestCode: 'INVALID_KEY',
  });
  return store;
}

function facts(store: SettingsStore, over: Partial<DiagnosticsFacts> = {}): DiagnosticsFacts {
  return {
    appVersion: '0.1.0',
    packaged: false,
    platform: 'win32',
    arch: 'x64',
    osRelease: '10.0.22631',
    electronVersion: '41.1.1',
    nodeVersion: '22.15.0',
    uiLang: 'zh',
    settings: store.data,
    weakCrypto: false,
    knowledgeChars: 4096,
    capture: { active: false, lastStartedAt: '2026-08-17T08:00:00.000Z' },
    asr: { ready: true, ep: 'cloud-rt', gpuSuspect: false, state: 'listening' },
    localPython: 'no',
    errors: recentDiagnosticErrors(),
    generatedAt: new Date('2026-08-17T09:30:00.000Z'),
    ...over,
  };
}

describe('buildDiagnosticsReport', () => {
  it('excludes every secret and every piece of user content', () => {
    const store = seededStore();
    // things that MUST NOT appear, planted where they really live
    recordDiagnosticError(
      'provider-test/asr-realtime',
      'ws error: rejected Authorization: Bearer sk-aliyun-supersecret-0002',
    );
    const report = buildDiagnosticsReport(facts(store));

    for (const secret of [
      'sk-deepseek-supersecret-0001',
      'sk-aliyun-supersecret-0002',
      'AIzaTOPSECRETvaluezz',
      'supersecret',
      'TOPSECRET',
    ]) {
      expect(report).not.toContain(secret);
    }
    // the CIPHERTEXT is just as sensitive as the plaintext
    expect(report).not.toContain(store.data.llm.apiKeyEnc!);
    expect(report).not.toContain(store.data.asr.realtime!.apiKeyEnc!);
    expect(report).not.toContain('enc:');
    expect(report).not.toContain('apiKeyEnc');
    // and the key hint, which is a fragment of the real key
    expect(report).not.toContain('0001');
    expect(report).not.toContain('Authorization: Bearer sk-aliyun');
  });

  it('never carries resume, JD, transcript or answer text', () => {
    const store = seededStore();
    const resume = '张三，五年后端经验，负责过支付网关重构';
    const transcript = '面试官：请介绍一下你最近的项目';
    const answer = '我在上一家公司主导了订单系统的重构';
    // these live in knowledge.md / sessions.json and are deliberately NOT
    // inputs to the report — only their size is
    const report = buildDiagnosticsReport(facts(store, { knowledgeChars: resume.length }));
    expect(report).not.toContain(resume);
    expect(report).not.toContain(transcript);
    expect(report).not.toContain(answer);
    expect(report).toContain(`Knowledge base`);
    expect(report).toContain(`${resume.length} chars (content excluded)`);
  });

  it('states the facts a supporter actually needs', () => {
    const report = buildDiagnosticsReport(facts(seededStore()));
    expect(report).toContain('MeetingCopilot Diagnostic Report');
    expect(report).toContain('Generated locally. Sensitive content and API keys are excluded.');
    expect(report).toContain('0.1.0 (packaged: no)');
    expect(report).toContain('electron 41.1.1 / node 22.15.0');
    expect(report).toContain('win32 x64 10.0.22631');
    expect(report).toContain('ASR backend          : cloud-realtime');
    expect(report).toContain('ASR worker           : ready=yes state=listening ep=cloud-rt');
    expect(report).toContain('LLM provider         : deepseek / deepseek-chat');
    expect(report).toContain('Vision configured    : yes (gemini / gemini-2.5-flash)');
    expect(report).toContain('API keys configured  : llm=yes vision=yes asr-cloud=no asr-realtime=yes');
    expect(report).toContain('Key storage          : OS-encrypted');
    expect(report).toContain('Local python         : no');
    expect(report).toContain('Proxy configured     : yes');
    expect(report).toContain('Audio capture        : idle lastStarted=2026-08-17T08:00:00.000Z');
    expect(report).toContain('Generated at         : 2026-08-17T09:30:00.000Z');
  });

  it('names the ASR provider from the endpoint, not from a stale providerId', () => {
    const store = seededStore();
    expect(store.data.asr.providerId).toBe('mimo'); // the stale value
    const report = buildDiagnosticsReport(facts(store));
    expect(report).toContain('ASR provider         : aliyun-dashscope-cn / fun-asr-realtime');
    expect(report).not.toContain('ASR provider         : mimo');
  });

  it('reports the last connection test per slot', () => {
    const report = buildDiagnosticsReport(facts(seededStore()));
    expect(report).toContain('llm                : OK at 2026-08-17T09:00:00.000Z (412 ms)');
    expect(report).toContain('asr-realtime       : INVALID_KEY at 2026-08-17T09:01:00.000Z');
    expect(report).toContain('vision             : never tested');
    expect(report).toContain('asr-cloud          : never tested');
  });

  it('includes the sanitized ring buffer, or says there is nothing', () => {
    const store = seededStore();
    expect(buildDiagnosticsReport(facts(store))).toContain('Recent errors (sanitized, oldest first, 0):\n  none');

    recordDiagnosticError('sidecar', 'local ASR engine failed to start: port 10097 busy');
    const report = buildDiagnosticsReport(facts(store, { errors: recentDiagnosticErrors() }));
    expect(report).toContain('Recent errors (sanitized, oldest first, 1):');
    expect(report).toContain('[sidecar] local ASR engine failed to start: port 10097 busy');
  });

  it('warns when keys are only obfuscated on this machine', () => {
    const report = buildDiagnosticsReport(facts(seededStore(), { weakCrypto: true }));
    expect(report).toContain('obfuscated only (OS credential store unavailable)');
  });

  it('describes an unconfigured profile without inventing anything', () => {
    const store = new SettingsStore(join(dir, 'fresh.json'), fakeCipher);
    const report = buildDiagnosticsReport(facts(store, { localPython: 'unknown' }));
    expect(report).toContain('ASR backend          : local-realtime');
    expect(report).toContain('ASR provider         : local sidecar / fun-asr-nano');
    expect(report).toContain('Vision configured    : no (not configured)');
    expect(report).toContain('API keys configured  : llm=no vision=no asr-cloud=no asr-realtime=no');
    expect(report).toContain('Local python         : unknown');
    expect(report).toContain('Onboarding           : completed=no plan=none');
  });
});
