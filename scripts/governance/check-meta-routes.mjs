// D54: canonical Meta UI has one human route and no friendly-route compatibility surface.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT, trackedFiles } from './lib.mjs';

const FORBIDDEN_META_ROUTES = [
  { route: '/meta/self', source: String.raw`\/meta\/self(?=$|[/?#"'\x60\s)])` },
  { route: '/meta/flows', source: String.raw`\/meta\/flows(?=$|[/?#"'\x60\s)])` },
  { route: '/meta/flow/', source: String.raw`\/meta\/flow\/` },
  {
    route: '/meta/activations',
    source: String.raw`\/meta\/activations(?=$|[/?#"'\x60\s)])`,
  },
  { route: '/meta/activation/', source: String.raw`\/meta\/activation\/` },
  {
    route: '/meta/capabilities',
    source: String.raw`\/meta\/capabilities(?=$|[/?#"'\x60\s)])`,
  },
  { route: '/meta/capability/', source: String.raw`\/meta\/capability\/` },
];

const REASON = 'legacy Meta friendly route is forbidden; use /meta/entity?rel=...';

export function inspectLegacyMetaRoutes(file, source) {
  const violations = [];
  for (const forbidden of FORBIDDEN_META_ROUTES) {
    const pattern = new RegExp(forbidden.source, 'g');
    for (const match of source.matchAll(pattern)) {
      violations.push({
        file,
        line: source.slice(0, match.index).split('\n').length,
        pattern: forbidden.route,
        reason: REASON,
      });
    }
  }
  return violations.sort((left, right) => left.line - right.line);
}

function routeSourceFiles() {
  const production = trackedFiles('apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx').filter(
    (file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file),
  );
  const e2e = trackedFiles('e2e/**/*.ts');
  return [...new Set([...production, ...e2e])].sort();
}

export function checkMetaRoutes() {
  const files = routeSourceFiles();
  const violations = files.flatMap((file) =>
    inspectLegacyMetaRoutes(file, readFileSync(path.join(REPO_ROOT, file), 'utf8')),
  );
  return { files, violations };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const { files, violations } = checkMetaRoutes();
  console.log(`check-meta-routes: scanned ${files.length} production/E2E source file(s)`);
  if (violations.length === 0) {
    console.log('  OK');
    process.exit(0);
  }
  console.log(`  ${violations.length} legacy Meta route violation(s):`);
  for (const violation of violations) {
    console.log(
      `    ${violation.file}:${violation.line}  ${violation.pattern} — ${violation.reason}`,
    );
  }
  process.exit(1);
}
