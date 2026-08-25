import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { T15_PHASE_GH_EVIDENCE } from '../../../../e2e/kits/t15-acceptance-evidence';

describe('T15 U18-U23 acceptance evidence inventory', () => {
  it('routes every story to existing focused evidence without claiming pending live work is done', () => {
    expect(T15_PHASE_GH_EVIDENCE.map((entry) => entry.storyId)).toEqual([
      'U18',
      'U19',
      'U20',
      'U21',
      'U22',
      'U23',
    ]);
    for (const entry of T15_PHASE_GH_EVIDENCE) {
      expect(entry.deterministic.length, entry.storyId).toBeGreaterThan(0);
      for (const path of entry.deterministic) {
        expect(existsSync(resolve(path)), `${entry.storyId}: ${path}`).toBe(true);
      }
      if (entry.focusedLiveEval !== undefined) {
        expect(existsSync(resolve(entry.focusedLiveEval)), entry.storyId).toBe(true);
      }
      expect(entry.liveClosure === 'required' ? entry.remaining.length : 0, entry.storyId).toBe(
        entry.remaining.length,
      );
    }
  });

  it('requires live LLM closure only where model behavior or deployed-profile identity is at stake', () => {
    expect(
      T15_PHASE_GH_EVIDENCE.filter((entry) => entry.liveClosure === 'required').map(
        (entry) => entry.storyId,
      ),
    ).toEqual(['U18', 'U19', 'U20', 'U21', 'U23']);
  });
});
