/** Save a next-launch preference only. No window, restart or capture API is involved. */
export function saveProtectionPreference<T>(requested: boolean, persist: (next: boolean) => void, snapshot: () => T): T {
  if (typeof requested !== 'boolean') throw new TypeError('Next-launch protection must be boolean');
  persist(requested);
  return snapshot();
}
