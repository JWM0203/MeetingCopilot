/**
 * Pack-time guard for patches/@huggingface+transformers+3.8.1.patch.
 *
 * patch-package only runs on `postinstall`. A CI job that restores a cached
 * node_modules, or an `npm ci --ignore-scripts`, silently ships an UNPATCHED
 * transformers.js — and local Whisper then dies at runtime with
 * "Missing the following inputs: cache_position", inside a packaged installer
 * where nobody can fix it. Fail the build here instead.
 *
 * `cache_position` appears nowhere in the upstream 3.8.1 bundles; every
 * occurrence comes from our patch, so its presence is an exact signal.
 */
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'cache_position';
const TARGETS = [
  // the ESM bundle the ASR worker dynamically imports (electron/asr/engine.ts)
  'node_modules/@huggingface/transformers/dist/transformers.node.mjs',
  // the CJS bundle the silent fallback path would load
  'node_modules/@huggingface/transformers/dist/transformers.node.cjs',
];

const missing = [];
for (const rel of TARGETS) {
  const file = join(repoRoot, rel);
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch (e) {
    missing.push(`${rel} — cannot read (${e.code ?? e.message})`);
    continue;
  }
  if (!source.includes(MARKER)) missing.push(`${rel} — no "${MARKER}" (patch not applied)`);
}

if (missing.length > 0) {
  console.error('\n[verify-patched] transformers.js is NOT patched:\n');
  for (const m of missing) console.error(`  - ${m}`);
  console.error(
    '\nFix: run `npx patch-package` (or reinstall without --ignore-scripts) before packaging.' +
      '\nShipping an unpatched build breaks local Whisper ASR with "Missing the following inputs: cache_position".\n',
  );
  process.exit(1);
}

console.log(`[verify-patched] ok — "${MARKER}" present in ${TARGETS.length} transformers.js bundles`);
