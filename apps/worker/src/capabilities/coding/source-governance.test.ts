import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const productionFiles = [
  new URL('./codex.ts', import.meta.url),
  new URL('./workspace.ts', import.meta.url),
  new URL('../../agents/host/codex-transport.ts', import.meta.url),
];

async function productionSource(): Promise<string> {
  return (await Promise.all(productionFiles.map((path) => readFile(path, 'utf8')))).join('\n');
}

describe('coding capability source governance', () => {
  it('keeps Hermes outside runtime and dependencies', async () => {
    expect(await productionSource()).not.toMatch(/hermes/iu);
  });

  it('does not introduce shell interpolation or unsafe sandbox shortcuts', async () => {
    const source = await productionSource();
    expect(source).not.toMatch(/\b(?:exec|spawn)\s*\(/u);
    expect(source).not.toMatch(/shell\s*:\s*true|danger-full-access|bypass|--yolo/iu);
    expect(source).toContain("sandboxMode: input.sandboxMode ?? 'workspace-write'");
    expect(source).toContain("approvalPolicy: 'never'");
  });
});
