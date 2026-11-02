/** Only official HTTPS endpoints may receive implicit DeepSeek-specific behavior. */
export function isOfficialDeepSeek(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'https:' && url.hostname === 'api.deepseek.com'
      && !url.port && !url.username && !url.password;
  } catch { return false; }
}

export function migrateDeepSeekModel(baseUrl: string, model: string): string {
  if (!isOfficialDeepSeek(baseUrl)) return model;
  if (model === 'deepseek-chat') return 'deepseek-flash';
  // Keep the thinking preset distinct while this documented alias is accepted.
  if (model === 'deepseek-reasoner') return 'deepseek-v4-flash';
  return model;
}

export function deepseekThinking(baseUrl: string, model: string): boolean | undefined {
  if (!isOfficialDeepSeek(baseUrl)) return undefined;
  if (model === 'deepseek-flash' || model === 'deepseek-chat') return false;
  if (model === 'deepseek-v4-flash' || model === 'deepseek-reasoner') return true;
  return undefined;
}
