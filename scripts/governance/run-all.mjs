// Runs all T23 governance checks and aggregates exit codes.
// Usage: node scripts/governance/run-all.mjs [--strict]
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const strict = process.argv.includes('--strict');
const checks = ['check-deps.mjs', 'check-compat.mjs', 'check-size.mjs'];

let failed = false;
for (const check of checks) {
  const args = [path.join(dir, check)];
  if (strict && check !== 'check-deps.mjs') args.push('--strict');
  const res = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (res.status !== 0) failed = true;
}

console.log(failed ? 'governance: FAILED' : 'governance: OK');
process.exit(failed ? 1 : 0);
