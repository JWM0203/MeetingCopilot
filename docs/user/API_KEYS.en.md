# API key guide

中文版：[API_KEYS.zh-CN.md](API_KEYS.zh-CN.md)

---

## What an API key is

An API key is a credential you create in a model provider's console. It proves the requests are yours.

- **It is not your account password.** MeetingCopilot never asks for one, in any field.
- **It is a billing credential.** Whoever holds it can spend your quota, so keep it out of chats, screenshots and public repos.
- **It is disposable.** If one leaks, delete it in the provider console and create a new one; your account is unaffected.

## Who charges you

MeetingCopilot is **BYOK (bring your own key)**:

- you create the key at the provider, and the provider bills your usage directly;
- MeetingCopilot has no accounts and no server; it collects no fee, takes no cut and adds no markup;
- every "Test connection" button sends one tiny real request (1 token, ~1.4 s of audio, or a 64×64 image), which may cost a very small amount — and only when you click it.

## Where keys are stored

- Saving strips surrounding whitespace, wrapping quotes and a `Bearer ` prefix for you.
- The key is encrypted with the OS credential store before it is written to the local config file: DPAPI on Windows, Keychain on macOS.
- The decrypted key **exists only in the main process**. The UI layer never receives it — it only sees "Configured" and the last 4 characters.
- If the OS credential store is unavailable, the app warns you *before* the key leaves the settings form: it could then only be obfuscated, not encrypted. Fix the system service first if you can.
- To remove a key: "Delete key" next to the field → "Delete it" → "Save".

---

## Per-provider guides

These are the same steps the in-app help center and the setup wizard show.

### DeepSeek (recommended for AI answers)

Used for: AI answers and inline transcript translation. Default model `deepseek-chat` (non-thinking mode, fastest first token).

1. Open the [DeepSeek open platform](https://platform.deepseek.com/).
2. Sign in with your phone number or email; create an account on first use.
3. Go to the "API keys" page in the left sidebar.
4. Click "Create API key" and give it a recognisable name (e.g. MeetingCopilot).
5. Copy the key immediately — it is usually shown in full only once.
6. Come back to MeetingCopilot and paste it into the AI-answers card.
7. Click "Save and test connection". If the balance is insufficient, top up on the platform and retry.

Common problems:

- `Insufficient Balance`: the key is valid, the account just needs a top-up.
- The key is shown once: if you lost it, delete it and create another — the account is unaffected.

Model options: `deepseek-chat` (fast, default), `deepseek-v4-flash` (reasoning chain first, slower first token), `deepseek-v4-pro` (strongest reasoning; good for review, not for snap answers).

### Alibaba Cloud Model Studio · mainland (recommended for live ASR)

Used for: cloud streaming speech recognition with `fun-asr-realtime` (default) or `paraformer-realtime-v2`, endpoint `wss://dashscope.aliyuncs.com/api-ws/v1/inference`.

1. Open the [Model Studio console](https://bailian.console.aliyun.com/?tab=model).
2. Sign in with your Alibaba Cloud account; register first if you have none.
3. Follow the prompt to activate the Model Studio (Bailian) service.
4. Complete real-name verification — accounts without it cannot create a usable API key.
5. Stay in the main account default workspace (sub-accounts or custom workspaces may lack realtime ASR access).
6. Open the "API-KEY" page from the avatar menu in the top-right corner.
7. Click "Create my API-KEY" and confirm with the default workspace selected.
8. Copy the key, come back to MeetingCopilot and paste it into the speech-recognition card.
9. Click "Save and test connection".

Common problems:

- Permission denied / Access denied: usually Model Studio is not activated, or real-name verification is missing.
- "Model not found": usually means the account belongs to the international site, which uses a different endpoint.
- Key missing after creation: switch back to the main account default workspace on the "API-KEY" page.

> **International accounts (Beta)**: the [international Model Studio console](https://modelstudio.console.aliyun.com/?tab=playground) can create keys too, but its realtime ASR endpoint differs from the mainland one and is still being verified, so this release ships no preset for it. Prefer a mainland account for dependable live captions.

### MiMo · Xiaomi (one key for both ASR and answers, Beta)

Used for: `mimo-v2.5-asr` per-segment ASR, `mimo-v2.5-pro` answers and `mimo-v2.5` screenshot Q&A, all on `https://api.xiaomimimo.com/v1`.

1. Open the [MiMo open platform](https://platform.xiaomimimo.com/).
2. Sign in with your Xiaomi account; register first if you have none.
3. Go to the "API Keys" page in the console.
4. Create a new API key and confirm the name.
5. Copy the key (it starts with `sk-`) — it is usually shown in full only once.
6. Come back to MeetingCopilot and paste it into the field.
7. One key can serve both speech recognition and AI answers (the minimal plan); this is still Beta.
8. Click "Save and test connection"; switch to the recommended plan if ASR is unavailable.

> Per-segment recognition returns whole sentences, so captions trail the speaker more than the streaming plan does. That is the design, not a fault.

### Google Gemini (optional, for screenshot Q&A)

Used for: the vision model, `https://generativelanguage.googleapis.com/v1beta/openai`, model `gemini-2.5-flash`. Screenshot Q&A is optional; skipping it does not affect transcription or text answers.

1. Open the [API key page in Google AI Studio](https://aistudio.google.com/app/apikey).
2. Sign in with your Google account.
3. Click "Create API key" and pick or create a Google Cloud project when asked.
4. Copy the key and paste it into the vision key field (Settings → Advanced → Vision model).
5. Google is usually unreachable directly from mainland China — set a local proxy in "Vision proxy" (e.g. `127.0.0.1:7897`).
6. Visual Q&A is optional and can be skipped; the screenshot button then reports it is not configured.

> For a direct connection inside mainland China, use MiMo's vision model `mimo-v2.5` instead and leave the proxy empty.

### Custom (OpenAI-compatible services)

1. Prepare an OpenAI-compatible base URL (ending in `/v1`) and a model name.
2. Fill in the base URL, model and API key under Settings → Advanced.
3. For safety, MeetingCopilot only ever hands the OS browser a URL from its built-in allowlist of official provider pages — visit a custom provider's site yourself.

---

## When the connection test fails

Every key field has a "Test connection" button. It normalises the wildly different provider errors into a fixed set of codes so you can tell a key problem from a network or account problem. The full table and what to do about each code is in [TROUBLESHOOTING.en.md](TROUBLESHOOTING.en.md).
