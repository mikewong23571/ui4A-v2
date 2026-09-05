// T55 FR1.2a: check-deps must see relative-import escapes that specifier-only
// scanning misses — reaching into another workspace's node_modules or escaping
// the workspace root. Fixtures are injected; default repo scan is unchanged.
import { describe, expect, it } from 'vitest';

import { checkDeps } from './check-deps.mjs';
import { readJson } from './lib.mjs';

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

function scan(files) {
  const sources = new Map(files.map(([file, text]) => [file, text]));
  const importsOf = (file) => {
    const out = [];
    let m;
    for (const line of sources.get(file).split('\n')) {
      IMPORT_RE.lastIndex = 0;
      if ((m = IMPORT_RE.exec(line)) !== null) out.push({ specifier: m[1], line: 1 });
    }
    return out;
  };
  return checkDeps({ files: [...sources.keys()], importsOf, exceptions: [] });
}

describe('GR1 relative-import escape scan (T55 FR1.2a)', () => {
  it('flags a relative import reaching into another workspace node_modules', () => {
    const { violations } = scan([
      [
        'scripts/t22/t22-temporal-probe.ts',
        "import { Client } from '../../apps/worker/node_modules/@temporalio/client/lib/index.js';\n",
      ],
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('scripts/t22/t22-temporal-probe.ts');
    expect(violations[0].reason).toContain('node_modules');
  });

  it('flags a relative import escaping the workspace root', () => {
    const { violations } = scan([
      ['apps/web/src/app/api/leak.ts', "import { x } from '../../../../../../outside.ts';\n"],
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain('escapes the workspace root');
  });

  it('does not flag declared package imports or intra-module relatives', () => {
    const { violations } = scan([
      [
        'scripts/t22/probe.ts',
        "import { Client } from '@temporalio/client';\nimport { helper } from './helper.mjs';\n",
      ],
      ['apps/web/src/chat/a.ts', "import { b } from '../engine/b';\n"],
    ]);
    expect(violations).toEqual([]);
  });

  it('keeps enforcing module direction rules (regression guard)', () => {
    const { violations } = scan([
      ['apps/worker/src/main.ts', "import { something } from '@ui4a/cli';\n"],
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain('must not depend on');
  });
});

describe('fs read disclosures registry (T55 FR1.2b)', () => {
  const expected = [
    'packages/agent/src/governance/t21-source-governance.test.ts',
    'packages/agent/src/governance/t16-acceptance-matrix.test.ts',
  ];

  it('discloses the known cross-workspace file-system read dependencies', () => {
    const disclosures = readJson('scripts/governance/exceptions.json').fsReadDisclosures ?? [];
    const byPath = new Map(disclosures.map((d) => [d.path, d]));
    for (const path of expected) {
      const entry = byPath.get(path);
      expect(entry, `missing disclosure for ${path}`).toBeDefined();
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.retireWhen.length).toBeGreaterThan(0);
    }
  });

  it('disclosure entries are informative only — governance stays green with them', () => {
    const { violations } = checkDeps();
    expect(violations).toEqual([]);
  });
});
