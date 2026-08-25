// T23 GR2: no compatibility code while the project is unreleased.
// - Forbidden legacy paths must not exist.
// - legacy/compat markers are scanned repo-wide; known 存量 lives in
//   exceptions.json compatAllowlist with pendingRemoval: true (baseline, shrink-only).
// Default mode fails on findings outside the allowlist and on stale entries.
// --strict additionally fails while any pendingRemoval entry still matches code.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, trackedFiles, readJson } from './lib.mjs';

// Paths that existed at baseline time and must be deleted by Phase B (GR2 清单).
const FORBIDDEN_PATHS = [
  'apps/worker/src/capabilities/coding/compatibility.ts',
  'apps/worker/src/capabilities/coding/compatibility.test.ts',
  'packages/engine/src/agent-run/legacy-capability-run.ts',
];

const MARKER_RE = /\blegacy\b|\bbackward[- ]?compat\w*|\bcompat(?:ibility|ible|ibilites)?\b/i;
const SCAN_ROOTS = ['apps', 'packages', 'scripts', 'e2e', 'deploy'];

export function checkCompat() {
  const exceptions = readJson('scripts/governance/exceptions.json');
  const allowlist = exceptions.compatAllowlist ?? [];
  const files = trackedFiles('*.ts', '*.tsx', '*.mts').filter(
    (f) => SCAN_ROOTS.some((r) => f.startsWith(r + '/')) && !f.startsWith('scripts/governance/'),
  );

  const forbiddenPresent = FORBIDDEN_PATHS.filter((p) => files.includes(p));

  const findingsByFile = new Map();
  for (const file of files) {
    const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const lines = [];
    text.split('\n').forEach((line, i) => {
      if (MARKER_RE.test(line)) lines.push(i + 1);
    });
    if (lines.length > 0) findingsByFile.set(file, lines);
  }

  const allowlisted = new Map();
  const usedEntries = new Set();
  for (const entry of allowlist) {
    allowlisted.set(entry.path, entry);
  }

  const newFindings = [];
  for (const [file, lines] of findingsByFile) {
    const entry = allowlisted.get(file);
    if (entry) usedEntries.add(entry);
    else newFindings.push({ file, lines });
  }
  const staleEntries = allowlist.filter((e) => !usedEntries.has(e));
  const pendingUsed = allowlist.filter((e) => e.pendingRemoval && usedEntries.has(e));

  return { forbiddenPresent, newFindings, staleEntries, pendingUsed, findingsByFile };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const strict = process.argv.includes('--strict');
  const { forbiddenPresent, newFindings, staleEntries, pendingUsed } = checkCompat();
  console.log('check-compat: scanned legacy/compat markers (GR2)');
  let failed = false;

  if (forbiddenPresent.length > 0) {
    failed = true;
    console.log(`  ${forbiddenPresent.length} forbidden legacy path(s) still exist:`);
    for (const p of forbiddenPresent) console.log(`    ${p}`);
  }
  if (newFindings.length > 0) {
    failed = true;
    console.log(`  ${newFindings.length} file(s) with unregistered compat markers:`);
    for (const f of newFindings) {
      console.log(
        `    ${f.file} (lines: ${f.lines.slice(0, 10).join(', ')}${f.lines.length > 10 ? '…' : ''})`,
      );
    }
  }
  if (staleEntries.length > 0) {
    failed = true;
    console.log(`  ${staleEntries.length} stale compatAllowlist entr(ies) with no markers:`);
    for (const e of staleEntries) console.log(`    ${e.path}`);
  }
  console.log(`  baseline pending removal: ${pendingUsed.length} file(s)`);
  if (strict && pendingUsed.length > 0) {
    failed = true;
    console.log('  strict mode: pendingRemoval baseline must be empty:');
    for (const e of pendingUsed) console.log(`    ${e.path}`);
  }
  if (!failed) console.log('  OK');
  process.exit(failed ? 1 : 0);
}
