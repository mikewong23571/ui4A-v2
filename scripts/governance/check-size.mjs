// T23 GR3: file and module size limits, measured in effective lines (shared 口径 in
// lib.mjs). Limits: non-test .ts/.tsx <= 500; tests (.test./.spec.) <= 800; a leaf
// directory's direct .ts/.tsx files <= 4000 total.
// Current 超限存量 lives in size-baseline.json (shrink-only). Default mode fails on new
// violations, on baselined files that grew, and on stale baseline entries.
// --strict additionally fails until the baseline is empty. --write-baseline regenerates
// the baseline file from the current tree (use only at Red time).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, trackedFiles, effectiveLineCount } from './lib.mjs';

const FILE_LIMIT = 500;
const TEST_LIMIT = 800;
const DIR_LIMIT = 4000;
const BASELINE_PATH = 'scripts/governance/size-baseline.json';

const isTest = (f) => /\.(test|spec)\.tsx?$/.test(f);

export function checkSize() {
  const files = trackedFiles('*.ts', '*.tsx').filter((f) => !f.startsWith('scripts/governance/'));
  const overLimit = [];
  const dirTotals = new Map();

  for (const file of files) {
    const lines = effectiveLineCount(file);
    const limit = isTest(file) ? TEST_LIMIT : FILE_LIMIT;
    if (lines > limit) overLimit.push({ path: file, lines, limit });
    const dir = path.posix.dirname(file);
    dirTotals.set(dir, (dirTotals.get(dir) ?? 0) + lines);
  }
  const overLimitDirs = [...dirTotals.entries()]
    .filter(([, total]) => total > DIR_LIMIT)
    .map(([dir, total]) => ({ path: dir, lines: total, limit: DIR_LIMIT }));

  return { overLimit, overLimitDirs };
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(path.join(REPO_ROOT, BASELINE_PATH), 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return { files: [], dirs: [] };
    throw err;
  }
}

function evaluate(overLimit, overLimitDirs, baseline) {
  const baselineMap = new Map(
    [...(baseline.files ?? []), ...(baseline.dirs ?? [])].map((e) => [e.path, e]),
  );
  const currentMap = new Map([...overLimit, ...overLimitDirs].map((e) => [e.path, e]));

  const newViolations = [];
  const grown = [];
  const stale = [];

  for (const entry of currentMap.values()) {
    const base = baselineMap.get(entry.path);
    if (!base) newViolations.push(entry);
    else if (entry.lines > base.lines) grown.push({ ...entry, baselineLines: base.lines });
  }
  for (const base of baselineMap.values()) {
    if (!currentMap.has(base.path)) stale.push(base);
  }
  const remaining = [...baselineMap.values()].filter((b) => currentMap.has(b.path));
  return { newViolations, grown, stale, remaining };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const strict = process.argv.includes('--strict');
  const writeBaseline = process.argv.includes('--write-baseline');
  const { overLimit, overLimitDirs } = checkSize();

  if (writeBaseline) {
    const baseline = {
      $schema:
        'T23 GR3 shrink-only baseline. files/dirs entries record path + effective lines at Red time; entries must only shrink.',
      files: overLimit.sort((a, b) => b.lines - a.lines),
      dirs: overLimitDirs.sort((a, b) => b.lines - a.lines),
    };
    writeFileSync(path.join(REPO_ROOT, BASELINE_PATH), JSON.stringify(baseline, null, 2) + '\n');
    console.log(
      `check-size: wrote baseline — ${baseline.files.length} file(s), ${baseline.dirs.length} dir(s)`,
    );
    process.exit(0);
  }

  const baseline = loadBaseline();
  const { newViolations, grown, stale, remaining } = evaluate(overLimit, overLimitDirs, baseline);
  console.log(
    `check-size: limits file<=${FILE_LIMIT}, test<=${TEST_LIMIT}, dir<=${DIR_LIMIT} effective lines (GR3)`,
  );
  let failed = false;

  if (newViolations.length > 0) {
    failed = true;
    console.log(`  ${newViolations.length} NEW over-limit item(s):`);
    for (const v of newViolations) console.log(`    ${v.path}: ${v.lines} > ${v.limit}`);
  }
  if (grown.length > 0) {
    failed = true;
    console.log(`  ${grown.length} baselined item(s) grew beyond baseline:`);
    for (const v of grown) console.log(`    ${v.path}: ${v.lines} > baseline ${v.baselineLines}`);
  }
  if (stale.length > 0) {
    failed = true;
    console.log(`  ${stale.length} stale baseline entr(ies) now within limit — remove them:`);
    for (const s of stale) console.log(`    ${s.path}`);
  }
  console.log(`  baseline remaining: ${remaining.length} item(s)`);
  if (strict && remaining.length > 0) {
    failed = true;
    console.log('  strict mode: baseline must be empty:');
    for (const r of remaining) console.log(`    ${r.path}: ${r.lines}`);
  }
  if (!failed) console.log('  OK');
  process.exit(failed ? 1 : 0);
}
