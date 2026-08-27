// T23 GR6: identity resolution scope selection.
// Every resolveTrustedRequestIdentity call under apps/web/src/app must pass a
// scopeCoverage closure in its options argument, so policyScope is selected per
// target rel from the granted set instead of being frozen to the
// defaultPolicyScope literal/config-first entry. Endpoints with no single
// target rel at resolution time, or that never consume policyScope, are
// legitimate exceptions and must be registered in
// scripts/governance/exceptions.json (identity-scope-selection) with reason +
// retireWhen. Unregistered offenders and stale/malformed entries fail the gate.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, trackedFiles, readJson } from './lib.mjs';

const SCAN_PATHSPECS = ['apps/web/src/app/*.ts', 'apps/web/src/app/*.tsx'];
const SECTION = 'identity-scope-selection';
const CALL_RE = /\bresolveTrustedRequestIdentity\s*\(/g;
const SCOPE_COVERAGE_RE = /\bscopeCoverage\b/;

// Blank out string/template contents and comments (preserving newlines so line
// numbers survive), so balanced scanning and identifier search never see
// string or comment text — no false positives from prose mentioning the rule.
export function maskNoise(text) {
  const chars = [...text];
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (chars[k] !== '\n') chars[k] = ' ';
  };
  let i = 0;
  while (i < chars.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      const stop = nl === -1 ? text.length : nl;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const stop = close === -1 ? text.length : close + 2;
      blank(i, stop);
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') j += 2;
        else if (text[j++] === c) break;
      }
      blank(i, Math.min(j, text.length));
      i = j;
    } else {
      i += 1;
    }
  }
  return chars.join('');
}

// Locate every resolveTrustedRequestIdentity call and whether its argument
// region mentions scopeCoverage. A call whose parens cannot be balanced is
// treated as unparseable → conservative violation (hasScopeCoverage: false).
export function findIdentityCallSites(text) {
  const masked = maskNoise(text);
  const sites = [];
  CALL_RE.lastIndex = 0;
  let m;
  while ((m = CALL_RE.exec(masked)) !== null) {
    const open = masked.indexOf('(', m.index);
    let depth = 0;
    let end = -1;
    for (let k = open; k < masked.length; k++) {
      const c = masked[k];
      if (c === '(' || c === '{' || c === '[') depth += 1;
      else if (c === ')' || c === '}' || c === ']') {
        depth -= 1;
        if (depth === 0) {
          end = k;
          break;
        }
      }
    }
    const region = end === -1 ? '' : masked.slice(open, end + 1);
    sites.push({
      line: masked.slice(0, m.index).split('\n').length,
      hasScopeCoverage: SCOPE_COVERAGE_RE.test(region),
    });
  }
  return sites;
}

export function checkIdentityScope({ files, readFile, exceptions } = {}) {
  const targetFiles =
    files ?? trackedFiles(...SCAN_PATHSPECS).filter((f) => !/\.test\.tsx?$/.test(f));
  const read = readFile ?? ((f) => readFileSync(path.join(REPO_ROOT, f), 'utf8'));
  const registry = exceptions ?? readJson('scripts/governance/exceptions.json')[SECTION] ?? [];

  const malformed = registry.filter((e) => !e?.path || !e?.reason || !e?.retireWhen);
  const registered = new Map(registry.filter((e) => e?.path).map((e) => [e.path, e]));

  const violations = [];
  const usedExceptions = new Set();
  for (const file of targetFiles) {
    const offenders = findIdentityCallSites(read(file)).filter((s) => !s.hasScopeCoverage);
    if (offenders.length === 0) continue;
    const entry = registered.get(file);
    if (entry && !malformed.includes(entry)) {
      usedExceptions.add(entry);
      continue;
    }
    violations.push({ file, lines: offenders.map((s) => s.line) });
  }
  // Shrink-only registry: an entry whose file no longer offends must be removed.
  const staleExceptions = registry.filter((e) => e?.path && !usedExceptions.has(e));
  return { violations, staleExceptions, malformed, usedExceptions: [...usedExceptions] };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { violations, staleExceptions, malformed, usedExceptions } = checkIdentityScope();
  console.log(`check-identity-scope: scanned resolveTrustedRequestIdentity call sites (GR6)`);
  for (const ex of usedExceptions) {
    console.log(`  exception in effect: ${ex.path} (${ex.reason})`);
  }
  let failed = false;
  if (violations.length > 0) {
    failed = true;
    console.log(`  ${violations.length} file(s) missing scopeCoverage without registration:`);
    for (const v of violations) console.log(`    ${v.file} (call line(s): ${v.lines.join(', ')})`);
  }
  if (malformed.length > 0) {
    failed = true;
    console.log(
      `  ${malformed.length} malformed ${SECTION} entr(ies) (need path+reason+retireWhen):`,
    );
    for (const e of malformed) console.log(`    ${e?.path ?? JSON.stringify(e)}`);
  }
  if (staleExceptions.length > 0) {
    failed = true;
    console.log(`  ${staleExceptions.length} stale ${SECTION} entr(ies) — file no longer offends:`);
    for (const e of staleExceptions) console.log(`    ${e.path}`);
  }
  if (!failed) console.log('  OK');
  process.exit(failed ? 1 : 0);
}
