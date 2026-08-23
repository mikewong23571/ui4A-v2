import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('Agent Runtime policy source governance', () => {
  it('stays pure and cannot invoke a provider or infrastructure', () => {
    const source = readFileSync(new URL('runtime-policy.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"](?:node:|@openai|@ai-sdk|ai)/i);
    expect(source).not.toMatch(/process\.|fetch\(|postgres|temporal|child_process/i);
    expect(source).not.toMatch(/fallback|yolo|danger-full-access/i);
  });
});
