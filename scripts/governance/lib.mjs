// Shared helpers for governance checks. Pure Node, no dependencies.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

/** git-tracked files matching the given pathspecs, repo-relative posix paths. */
export function trackedFiles(...pathspecs) {
  const out = execFileSync('git', ['ls-files', '--', ...pathspecs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

/** Effective lines: non-empty and not pure-comment lines. Shared T23 GR3 口径. */
export function effectiveLineCount(relPath) {
  const text = readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
  let n = 0;
  for (const line of text.split('\n')) {
    if (/^\s*$/.test(line)) continue;
    if (/^\s*(\/\/|\/?\*|<!--|-->)/.test(line)) continue;
    n++;
  }
  return n;
}

const STATIC_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]/g;

/** All module specifiers referenced by a file, with 1-based line numbers. */
export function findImports(relPath) {
  const text = readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
  const results = [];
  const collect = (re) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      results.push({ specifier: m[1], line });
    }
  };
  collect(STATIC_RE);
  collect(DYNAMIC_RE);
  collect(REQUIRE_RE);
  return results;
}

export function readJson(relPath) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relPath), 'utf8'));
}

export function fileExists(relPath, tracked) {
  return tracked.includes(relPath);
}
