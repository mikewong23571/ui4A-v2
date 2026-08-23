import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('specialization Prompt source governance', () => {
  it('keeps the compiler provider-neutral, dependency-free, and interpolation-free', () => {
    const source = readFileSync(new URL('prompt-compiler.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"](?:node:|ai|@ai-sdk|@openai|mustache)/i);
    expect(source).not.toMatch(/providerNative|chatCompletion|responses\.create/i);
    expect(source).not.toContain('{{{');
    expect(source).not.toMatch(/\.replace\([^\n]+binding/i);
  });
});
