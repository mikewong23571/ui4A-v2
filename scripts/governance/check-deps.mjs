// T23 GR1: module dependency direction check.
// Allowed direction: packages/shared <- packages/engine <- packages/agent; apps compose
// packages only; apps never import each other. Exceptions must be registered in
// scripts/governance/exceptions.json (dependencyExceptions).
import path from 'node:path';
import { trackedFiles, findImports, readJson } from './lib.mjs';

const MODULES = [
  'packages/shared',
  'packages/engine',
  'packages/db',
  'packages/agent',
  'apps/web',
  'apps/worker',
  'apps/cli',
  'apps/agent-runner',
];

const PACKAGE_TO_MODULE = {
  '@ui4a/shared': 'packages/shared',
  '@ui4a/engine': 'packages/engine',
  '@ui4a/db': 'packages/db',
  '@ui4a/agent': 'packages/agent',
  '@ui4a/web': 'apps/web',
  '@ui4a/worker': 'apps/worker',
  '@ui4a/cli': 'apps/cli',
  '@ui4a/agent-runner': 'apps/agent-runner',
};

// Workspace modules each module may depend on (besides itself).
const ALLOWED = {
  'packages/shared': [],
  'packages/engine': ['packages/shared'],
  'packages/agent': ['packages/shared', 'packages/engine'],
  'packages/db': ['packages/shared', 'packages/engine'],
  'apps/web': ['packages/shared', 'packages/engine', 'packages/db', 'packages/agent'],
  'apps/worker': ['packages/shared', 'packages/engine', 'packages/db', 'packages/agent'],
  'apps/cli': [],
  'apps/agent-runner': ['packages/shared'],
};

// External packages banned per module (platform-purity rules; prefix match).
const BANNED_EXTERNAL = {
  'packages/shared': [
    'next',
    'react',
    'react-dom',
    'pg',
    '@temporalio',
    'express',
    'fastify',
    'undici',
    'keycloak',
    'node:http',
    'node:https',
    'node:net',
  ],
  'packages/engine': [
    'next',
    'react',
    'react-dom',
    'pg',
    '@temporalio',
    'express',
    'fastify',
    'undici',
    'node:http',
    'node:https',
    'node:net',
  ],
  'packages/agent': ['next', 'react', 'react-dom', 'pg', '@temporalio'],
  'packages/db': ['next', 'react', 'react-dom', '@temporalio'],
};

function moduleOf(relPath) {
  return MODULES.find((m) => relPath === m || relPath.startsWith(m + '/')) ?? null;
}

function matchesPrefix(specifier, name) {
  return specifier === name || specifier.startsWith(name + '/');
}

function resolveTarget(fromModule, relPath, specifier) {
  if (PACKAGE_TO_MODULE[specifier]) {
    return { kind: 'workspace', module: PACKAGE_TO_MODULE[specifier], resolved: specifier };
  }
  if (specifier.startsWith('.')) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), specifier));
    const targetModule = moduleOf(resolved);
    if (targetModule && targetModule !== fromModule) {
      return { kind: 'workspace', module: targetModule, resolved };
    }
    return null; // intra-module relative import
  }
  return { kind: 'external', name: specifier };
}

function exceptionFor(exceptions, relPath, target) {
  return exceptions.find((e) => {
    if (!relPath.startsWith(e.from)) return false;
    if (target.kind === 'workspace') {
      return (
        target.module === e.to ||
        target.resolved === e.to ||
        target.module.startsWith(e.to + '/') ||
        target.resolved.startsWith(e.to + '/')
      );
    }
    return target.name === e.to || target.name.startsWith(e.to + '/');
  });
}

export function checkDeps() {
  const exceptions = readJson('scripts/governance/exceptions.json').dependencyExceptions ?? [];
  const files = trackedFiles('*.ts', '*.tsx', '*.mts').filter((f) => moduleOf(f));
  const violations = [];
  const usedExceptions = new Set();

  for (const file of files) {
    const fromModule = moduleOf(file);
    for (const { specifier, line } of findImports(file)) {
      const target = resolveTarget(fromModule, file, specifier);
      if (!target) continue;

      if (target.kind === 'workspace') {
        if (target.module === fromModule) continue;
        if (ALLOWED[fromModule].includes(target.module)) continue;
        const ex = exceptionFor(exceptions, file, target);
        if (ex) {
          usedExceptions.add(ex);
          continue;
        }
        violations.push({
          file,
          line,
          specifier,
          reason: `${fromModule} must not depend on ${target.module} (allowed: ${ALLOWED[fromModule].join(', ') || 'none'})`,
        });
      } else {
        const banned = (BANNED_EXTERNAL[fromModule] ?? []).find((b) =>
          matchesPrefix(target.name, b),
        );
        if (!banned) continue;
        const ex = exceptionFor(exceptions, file, target);
        if (ex) {
          usedExceptions.add(ex);
          continue;
        }
        violations.push({
          file,
          line,
          specifier,
          reason: `${fromModule} must not import platform package '${banned}' (platform-purity rule)`,
        });
      }
    }
  }

  const staleExceptions = exceptions.filter((e) => !usedExceptions.has(e));
  return { violations, staleExceptions, usedExceptions: [...usedExceptions] };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { violations, staleExceptions, usedExceptions } = checkDeps();
  console.log(`check-deps: scanned dependency direction (GR1)`);
  for (const ex of usedExceptions) {
    console.log(`  exception in effect: ${ex.from} -> ${ex.to} (${ex.reason})`);
  }
  let failed = false;
  if (violations.length > 0) {
    failed = true;
    console.log(`  ${violations.length} unregistered violation(s):`);
    for (const v of violations) {
      console.log(`    ${v.file}:${v.line}  '${v.specifier}'  — ${v.reason}`);
    }
  }
  if (staleExceptions.length > 0) {
    failed = true;
    console.log(`  ${staleExceptions.length} stale exception(s) with no matching import:`);
    for (const e of staleExceptions) console.log(`    ${e.from} -> ${e.to}`);
  }
  if (!failed) console.log('  OK');
  process.exit(failed ? 1 : 0);
}
