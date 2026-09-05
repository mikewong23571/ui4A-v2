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
// T55 FR1.3: dirs at >=90% of the limit are reported with a test/non-test split
// so "near-limit" is interpretable (A04: the pressure is mostly test lines).
const NEAR_LIMIT_RATIO = 0.9;
const BASELINE_PATH = 'scripts/governance/size-baseline.json';

const isTest = (f) => /\.(test|spec)\.tsx?$/.test(f);

/** Per-directory aggregation of effective lines into {total, test, nonTest}. */
export function aggregateDirStats(entries) {
  const stats = new Map();
  for (const { path: filePath, lines, isTest: test } of entries) {
    const dir = path.posix.dirname(filePath);
    const current = stats.get(dir) ?? { total: 0, test: 0, nonTest: 0 };
    if (test) current.test += lines;
    else current.nonTest += lines;
    current.total += lines;
    stats.set(dir, current);
  }
  return stats;
}

export function checkSize() {
  const files = trackedFiles('*.ts', '*.tsx').filter((f) => !f.startsWith('scripts/governance/'));
  const overLimit = [];
  const entries = [];

  for (const file of files) {
    const lines = effectiveLineCount(file);
    const test = isTest(file);
    const limit = test ? TEST_LIMIT : FILE_LIMIT;
    if (lines > limit) overLimit.push({ path: file, lines, limit });
    entries.push({ path: file, lines, isTest: test });
  }
  const dirStats = aggregateDirStats(entries);
  const overLimitDirs = [...dirStats.entries()]
    .filter(([, s]) => s.total > DIR_LIMIT)
    .map(([dir, s]) => ({ path: dir, lines: s.total, limit: DIR_LIMIT, ...s }));
  const nearLimitDirs = [...dirStats.entries()]
    .filter(([, s]) => s.total > DIR_LIMIT * NEAR_LIMIT_RATIO && s.total <= DIR_LIMIT)
    .map(([dir, s]) => ({ path: dir, lines: s.total, limit: DIR_LIMIT, ...s }))
    .sort((a, b) => b.lines - a.lines);

  return { overLimit, overLimitDirs, nearLimitDirs, dirStats };
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
  const { nearLimitDirs } = checkSize();
  console.log(
    `check-size: limits file<=${FILE_LIMIT}, test<=${TEST_LIMIT}, dir<=${DIR_LIMIT} effective lines (GR3)`,
  );
  let failed = false;

  const splitLine = (d) =>
    `    ${d.path}: ${d.lines} total = test ${d.test} + non-test ${d.nonTest} (${Math.round(
      (100 * d.test) / d.lines,
    )}% test)`;
  if (overLimitDirs.length > 0) {
    console.log(`  over-limit dir(s) — test/non-test split:`);
    for (const d of overLimitDirs.sort((a, b) => b.lines - a.lines)) console.log(splitLine(d));
  }
  if (nearLimitDirs.length > 0) {
    console.log(`  near-limit dir(s) (>=${Math.round(NEAR_LIMIT_RATIO * 100)}% of ${DIR_LIMIT}) — test/non-test split:`);
    for (const d of nearLimitDirs) console.log(splitLine(d));
  }

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
