// T55 FR1.3: the GR3 directory report must split test vs non-test effective
// lines so "near-limit" is interpretable (A04: near-limit dirs are largely
// test lines). Repo-anchored assertion uses the shared effective-line 口径.
import { describe, expect, it } from 'vitest';

import { aggregateDirStats, checkSize } from './check-size.mjs';

describe('GR3 dir report test/non-test split (T55 FR1.3)', () => {
  it('aggregates test and non-test lines per directory', () => {
    const stats = aggregateDirStats([
      { path: 'pkg/a/src/x.ts', lines: 100, isTest: false },
      { path: 'pkg/a/src/x.test.ts', lines: 250, isTest: true },
      { path: 'pkg/a/src/sub/y.ts', lines: 50, isTest: false },
    ]);
    expect(stats.get('pkg/a/src')).toEqual({ total: 350, test: 250, nonTest: 100 });
    expect(stats.get('pkg/a/src/sub')).toEqual({ total: 50, test: 0, nonTest: 50 });
  });

  it('reports the near-limit engine definition dir with non-test lines ≈1134 (±drift)', () => {
    const { dirStats, nearLimitDirs } = checkSize();
    const definition = dirStats.get('packages/engine/src/definition');
    expect(definition).toBeDefined();
    expect(definition.nonTest).toBeGreaterThan(1000);
    expect(definition.nonTest).toBeLessThan(1300);
    expect(definition.total).toBe(definition.test + definition.nonTest);
    expect(
      nearLimitDirs.some((d) => d.path === 'packages/engine/src/definition'),
    ).toBe(true);
  });
});
