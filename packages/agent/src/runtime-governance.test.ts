import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(name: string): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('AI-first runtime source governance', () => {
  it('product-facing Agent modules do not import or publicly export the legacy rule driver', () => {
    expect(source('./tools.ts')).not.toMatch(/from ['"]\.\/rule-driver['"]/);
    expect(source('./plan.ts')).not.toMatch(/from ['"]\.\/rule-driver['"]/);
    expect(source('./index.ts')).not.toMatch(/export \* from ['"]\.\/rule-driver['"]/);
  });

  it('legacy rule driver is reachable only through an explicitly test-only package subpath', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports?: Record<string, unknown> };

    expect(manifest.exports?.['./testkit/rule-driver']).toBeDefined();
    expect(manifest.exports?.['./rule-driver']).toBeUndefined();
  });

  it('legacy E2E protocol fixtures import the rule driver only through the testkit subpath', () => {
    const directory = new URL('../../../e2e/', import.meta.url);
    for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.ts'))) {
      const content = readFileSync(new URL(name, directory), 'utf8');
      if (!content.includes('createRuleDriver')) continue;
      expect(content, name).toContain("from '@ui4a/agent/testkit/rule-driver'");
      expect(content, name).not.toMatch(
        /import\s*\{[^}]*createRuleDriver[^}]*\}\s*from ['"]@ui4a\/agent['"]/s,
      );
    }
  });
});
