// D54: keep cognitive declarations semantic and generic runtimes data-driven.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT, trackedFiles } from './lib.mjs';

const COGNITIVE_KEYS = new Set(['version', 'traits', 'groupRole', 'priority', 'emptyMeaning']);

const GENERIC_RUNTIME_PATHS = [
  'apps/web/src/engine/presentation/*.ts',
  'apps/web/src/components/meta/**/*.ts',
  'apps/web/src/components/meta/**/*.tsx',
  'packages/agent/src/contract/disclosure.ts',
];

const COGNITIVE_REASON = 'cognitive declaration key is outside the D54 closed semantic vocabulary';
const RUNTIME_REASON =
  'generic runtime must branch on contract semantics, not installed names or rels';

function cognitiveDeclarations(bundle) {
  const declarations = [];
  for (const [collectionName, definitions] of [
    ['applications', bundle?.applications],
    ['flows', bundle?.flows],
  ]) {
    if (!Array.isArray(definitions)) continue;
    definitions.forEach((definition, index) => {
      if (
        typeof definition === 'object' &&
        definition !== null &&
        Object.hasOwn(definition, 'cognitive')
      ) {
        declarations.push({
          path: `${collectionName}[${index}].cognitive`,
          value: definition.cognitive,
        });
      }
    });
  }
  return declarations;
}

/** Inspect only definition-level cognitive slots; similarly named business facts are out of scope. */
export function inspectCognitiveBundle(file, bundle) {
  const violations = [];
  for (const declaration of cognitiveDeclarations(bundle)) {
    if (
      typeof declaration.value !== 'object' ||
      declaration.value === null ||
      Array.isArray(declaration.value)
    ) {
      violations.push({
        file,
        pattern: declaration.path,
        reason: 'cognitive declaration must be an object governed by the D54 closed vocabulary',
      });
      continue;
    }
    for (const key of Object.keys(declaration.value)) {
      if (COGNITIVE_KEYS.has(key)) continue;
      violations.push({
        file,
        pattern: `${declaration.path}.${key}`,
        reason: COGNITIVE_REASON,
      });
    }
  }
  return violations;
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function executableLine(line) {
  const trimmed = line.trim();
  return !(
    trimmed === '' ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('*/')
  );
}

/** High-signal textual rule: comparisons, switch cases, and membership checks are branches. */
export function inspectRuntimeSpecialCases(file, source, installedLiterals) {
  const violations = [];
  const literals = [...new Set(installedLiterals)].filter(Boolean).sort();
  source.split('\n').forEach((line, index) => {
    if (!executableLine(line)) return;
    for (const literal of literals) {
      const token = regexEscape(literal);
      const comparison = new RegExp(
        `(?:===|!==|==|!=)\\s*['\"]${token}['\"]|['\"]${token}['\"]\\s*(?:===|!==|==|!=)`,
      );
      const switchCase = new RegExp(`\\bcase\\s+['\"]${token}['\"]\\s*:`);
      const membership = new RegExp(
        `\\.(?:includes|startsWith|endsWith)\\(\\s*['\"]${token}['\"]\\s*\\)`,
      );
      let pattern;
      if (comparison.test(line)) pattern = `comparison with installed literal '${literal}'`;
      else if (switchCase.test(line)) pattern = `switch case for installed literal '${literal}'`;
      else if (membership.test(line))
        pattern = `membership check for installed literal '${literal}'`;
      if (pattern !== undefined) {
        violations.push({ file, line: index + 1, pattern, reason: RUNTIME_REASON });
      }
    }
  });
  return violations;
}

function installedLiterals(bundles) {
  const literals = new Set();
  for (const bundle of bundles) {
    for (const application of bundle.applications ?? []) {
      if (typeof application.name === 'string') literals.add(application.name);
      const entry =
        typeof application.entry === 'string' ? application.entry : application.entry?.target;
      if (typeof entry === 'string') literals.add(entry);
    }
    for (const flow of bundle.flows ?? []) {
      if (typeof flow.name === 'string') literals.add(flow.name);
      for (const collection of flow.collections ?? []) {
        if (typeof collection === 'string') literals.add(collection);
      }
    }
    const instances = bundle.seed?.detail?.instances;
    if (typeof instances === 'object' && instances !== null) {
      for (const [key, instance] of Object.entries(instances)) {
        literals.add(key);
        if (typeof instance?.rel === 'string') literals.add(instance.rel);
      }
    }
  }
  return [...literals];
}

export function checkD54() {
  const violations = [];
  const bundleFiles = trackedFiles('apps/web/src/applications/*.bundle.json');
  const bundles = [];
  for (const file of bundleFiles) {
    try {
      const bundle = JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
      bundles.push(bundle);
      violations.push(...inspectCognitiveBundle(file, bundle));
    } catch (error) {
      violations.push({
        file,
        pattern: 'JSON parse',
        reason: error instanceof Error ? error.message : 'bundle is not valid JSON',
      });
    }
  }

  const runtimeFiles = trackedFiles(...GENERIC_RUNTIME_PATHS).filter(
    (file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file),
  );
  const literals = installedLiterals(bundles);
  for (const file of runtimeFiles) {
    const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    violations.push(...inspectRuntimeSpecialCases(file, source, literals));
  }

  return { violations, bundleFiles, runtimeFiles };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const { violations, bundleFiles, runtimeFiles } = checkD54();
  console.log(
    `check-d54: scanned ${bundleFiles.length} bundle(s) and ${runtimeFiles.length} generic runtime file(s)`,
  );
  if (violations.length === 0) {
    console.log('  OK');
    process.exit(0);
  }
  console.log(`  ${violations.length} D54 violation(s):`);
  for (const violation of violations) {
    const location =
      violation.line === undefined ? violation.file : `${violation.file}:${violation.line}`;
    console.log(`    ${location}  ${violation.pattern} — ${violation.reason}`);
  }
  process.exit(1);
}
