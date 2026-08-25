import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const GENERIC_MODULES = ['run.ts', 'run-fold.ts', 'run-types.ts', 'index.ts'] as const;

describe('generic Agent Run source governance', () => {
  it('contains no specialization, transport or infrastructure branches', () => {
    for (const module of GENERIC_MODULES) {
      const source = readFileSync(new URL(module, import.meta.url), 'utf8');
      expect(source, module).not.toMatch(/coding|writing|codex|git|provider/i);
      expect(source, module).not.toMatch(/node:|postgres|temporal|next\.js/i);
    }
  });
});
