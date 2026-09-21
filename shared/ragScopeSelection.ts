function normalizeRelativePath(value: string): string | null {
  const raw = value.trim();
  if (!raw || /^[A-Za-z]:[\\/]/.test(raw) || /^[\\/]/.test(raw)) return null;
  const parts = raw.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.some((part) => part === '..')) return null;
  return parts.join('/');
}

export function normalizeRagScopeSelection(
  paths: string[],
  knownPaths: string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  const insensitive = platform === 'win32';
  const key = (value: string) => (insensitive ? value.toLocaleLowerCase('en-US') : value);
  const known = knownPaths
    .map(normalizeRelativePath)
    .filter((value): value is string => value !== null);
  const knownKeys = known.map(key);
  const unique = new Map<string, string>();

  for (const raw of paths) {
    const path = normalizeRelativePath(raw);
    if (!path) continue;
    const pathKey = key(path);
    const exists = knownKeys.some(
      (knownPath) => knownPath === pathKey || knownPath.startsWith(`${pathKey}/`),
    );
    if (exists && !unique.has(pathKey)) unique.set(pathKey, path);
  }

  const byDepth = [...unique.values()].sort((a, b) => {
    const depth = a.split('/').length - b.split('/').length;
    return depth || key(a).localeCompare(key(b), 'en');
  });
  const kept = byDepth.filter((path, index) => {
    const pathKey = key(path);
    return !byDepth
      .slice(0, index)
      .some((parent) => pathKey.startsWith(`${key(parent)}/`));
  });
  return kept.sort((a, b) => key(a).localeCompare(key(b), 'en'));
}
