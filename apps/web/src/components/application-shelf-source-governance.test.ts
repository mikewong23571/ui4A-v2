import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = [
  './application-entry-strip.tsx',
  './applications/application-catalog.ts',
  './applications/application-link.tsx',
  './applications/application-directory.tsx',
]
  .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n');

const installedApplicationNames = [
  'default',
  'publishing',
  'community',
  'development',
  'editorial',
  'governance',
  'todo',
  'ideas',
] as const;

describe('Application shelf runtime source governance (T39 G15 Red)', () => {
  it('does not branch on an installed Application name', () => {
    for (const name of installedApplicationNames) {
      expect(source).not.toMatch(
        new RegExp(`(?:===|!==)\\s*['\"]${name}['\"]|['\"]${name}['\"]\\s*(?:===|!==)`),
      );
    }
  });

  it('does not encode an installed-name inventory, fixed eight-item shelf, or deferred personal state', () => {
    const quotedNames = installedApplicationNames.filter((name) =>
      new RegExp(`['\"]${name}['\"]`).test(source),
    );
    expect(quotedNames.length).toBeLessThan(2);
    expect(source).not.toMatch(/(?:slice|splice)\(\s*0\s*,\s*8\s*\)/);
    expect(source).not.toMatch(
      /\b(?:pinnedApplications|recentApplications|applicationOrderStore)\b/,
    );
  });
});
