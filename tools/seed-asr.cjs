/**
 * One-shot seeder: write the streaming cloud ASR config (Aliyun DashScope)
 * into %APPDATA%/MeetingCopilot/settings.json with the key encrypted via
 * safeStorage (must run under Electron for that).
 *
 * Usage (PowerShell):
 *   $env:MC_RT_KEY = 'sk-...'
 *   $env:MC_RT_URL = 'wss://{ws}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference'
 *   npx electron tools/seed-asr.cjs
 * Optional: MC_RT_MODEL (default fun-asr-realtime), MC_RT_BACKEND (default cloud-realtime)
 */
const { app, safeStorage } = require('electron');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

app.setName('MeetingCopilot');

app
  .whenReady()
  .then(() => {
    const key = process.env.MC_RT_KEY; // optional: absent = keep existing key (local ws:// needs none)
    const baseUrl = process.env.MC_RT_URL;
    const model = process.env.MC_RT_MODEL || 'fun-asr-realtime';
    const backend = process.env.MC_RT_BACKEND || 'cloud-realtime';
    if (!baseUrl) {
      console.error('missing MC_RT_URL');
      app.exit(1);
      return;
    }
    const file = join(app.getPath('userData'), 'settings.json');
    const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1 };
    const apiKeyEnc = key
      ? safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(key).toString('base64')
        : 'plain:' + Buffer.from(key, 'utf8').toString('base64')
      : data.asr?.realtime?.apiKeyEnc;
    data.asr = {
      ...(data.asr || {}),
      backend,
      realtime: { baseUrl, model, apiKeyEnc },
    };
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    console.log(`seeded ${file}`);
    console.log(`  backend=${backend} model=${model}`);
    console.log(`  url=${baseUrl}`);
    console.log(`  key: encrypted=${safeStorage.isEncryptionAvailable()}`);
    app.exit(0);
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
