/**
 * One-shot smoke seeder: write cloud ASR and/or LLM settings with Electron
 * safeStorage (must run under Electron). Secrets come from the process
 * environment and are never printed.
 *
 * Usage (PowerShell):
 *   $env:MC_RT_KEY = 'sk-...'
 *   $env:MC_RT_URL = 'wss://{ws}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference'
 *   npx electron tools/seed-asr.cjs
 * Optional: MC_LLM_KEY, MC_LLM_URL, MC_LLM_MODEL and MC_RT_* variables.
 */
const { app, safeStorage } = require('electron');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

// Must match electron/main.ts so app.getPath('userData') resolves identically.
app.setName('MeetingCopilot');

app
  .whenReady()
  .then(() => {
    const key = process.env.MC_RT_KEY; // optional: absent = keep existing key (local ws:// needs none)
    const baseUrl = process.env.MC_RT_URL;
    const model = process.env.MC_RT_MODEL || 'fun-asr-realtime';
    const backend = process.env.MC_RT_BACKEND || 'cloud-realtime';
    const localModel = process.env.MC_LOCAL_MODEL;
    const llmKey = process.env.MC_LLM_KEY;
    if (!baseUrl && !llmKey && backend !== 'local-realtime') {
      console.error('missing MC_RT_URL / MC_LLM_KEY / local backend');
      app.exit(1);
      return;
    }
    if (!safeStorage.isEncryptionAvailable() && (key || llmKey)) {
      console.error('safeStorage unavailable; refusing to persist plaintext smoke credentials');
      app.exit(1);
      return;
    }
    const file = join(app.getPath('userData'), 'settings.json');
    const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1 };
    if (backend === 'local-realtime') {
      data.asr = {
        ...(data.asr || {}),
        backend,
        localRealtime: { model: localModel || 'fun-asr-nano' },
      };
    } else if (baseUrl) {
      const apiKeyEnc = key
        ? safeStorage.encryptString(key).toString('base64')
        : data.asr?.realtime?.apiKeyEnc;
      data.asr = {
        ...(data.asr || {}),
        backend,
        realtime: { baseUrl, model, apiKeyEnc },
      };
    }
    if (llmKey) {
      data.llm = {
        ...(data.llm || {}),
        baseUrl: process.env.MC_LLM_URL || 'https://api.deepseek.com/v1',
        model: process.env.MC_LLM_MODEL || 'deepseek-chat',
        apiKeyEnc: safeStorage.encryptString(llmKey).toString('base64'),
      };
    }
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    console.log(`seeded ${file}`);
    if (backend === 'local-realtime') {
      console.log(`  asr backend=${backend} model=${data.asr.localRealtime.model}`);
    } else if (baseUrl) {
      console.log(`  asr backend=${backend} model=${model}`);
    }
    if (llmKey) console.log(`  llm model=${data.llm.model}`);
    console.log('  credentials: encrypted=true');
    app.exit(0);
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
