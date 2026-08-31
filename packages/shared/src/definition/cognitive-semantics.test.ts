import { describe, expect, it } from 'vitest';

import * as shared from '../index';

interface CognitiveSemanticsDeclarationV1 {
  version: 1;
  traits?: string[];
  groupRole?: string;
  priority?: string;
  emptyMeaning?: string;
}

type ParseCognitiveSemanticsDeclaration = (
  value: unknown,
) => CognitiveSemanticsDeclarationV1 | undefined;

function parser(): ParseCognitiveSemanticsDeclaration {
  const candidate = (shared as Record<string, unknown>).parseCognitiveSemanticsDeclaration;
  expect(
    candidate,
    'shared must export the strict CognitiveSemanticsV1 declaration parser',
  ).toBeTypeOf('function');
  return candidate as ParseCognitiveSemanticsDeclaration;
}

describe('CognitiveSemanticsV1 declaration', () => {
  it('accepts only the irreducible semantic vocabulary required by T39', () => {
    const parse = parser();

    expect(
      parse({
        version: 1,
        traits: ['system-fallback', 'review-queue', 'human-responsibility', 'audit-only'],
        groupRole: 'responsibility',
        priority: 'high',
        emptyMeaning: 'no-current-responsibility',
      }),
    ).toEqual({
      version: 1,
      traits: ['system-fallback', 'review-queue', 'human-responsibility', 'audit-only'],
      groupRole: 'responsibility',
      priority: 'high',
      emptyMeaning: 'no-current-responsibility',
    });

    for (const trait of [
      'system-fallback',
      'work-queue',
      'review-queue',
      'output-catalog',
      'task-history',
      'human-responsibility',
      'audit-only',
    ]) {
      expect(parse({ version: 1, traits: [trait] })).toEqual({ version: 1, traits: [trait] });
    }
    for (const groupRole of ['responsibility', 'candidate', 'definition', 'system']) {
      expect(parse({ version: 1, groupRole })).toEqual({ version: 1, groupRole });
    }
    for (const priority of ['high', 'normal', 'low']) {
      expect(parse({ version: 1, priority })).toEqual({ version: 1, priority });
    }
    for (const emptyMeaning of [
      'no-current-responsibility',
      'nothing-in-motion',
      'no-results',
      'ready-to-start',
    ]) {
      expect(parse({ version: 1, emptyMeaning })).toEqual({ version: 1, emptyMeaning });
    }
  });

  it.each([
    [{ version: 2 }, /version/i],
    [{ version: 1, traits: ['future-trait'] }, /trait/i],
    [{ version: 1, groupRole: 'miscellaneous' }, /groupRole/i],
    [{ version: 1, priority: 'urgent' }, /priority/i],
    [{ version: 1, emptyMeaning: 'promote-entry' }, /emptyMeaning/i],
  ])('rejects unknown version or vocabulary in %j', (candidate, reason) => {
    expect(() => parser()(candidate)).toThrow(reason);
  });

  it.each([
    ['actions', [{ name: 'approve' }]],
    ['submission', { mode: 'draft' }],
    ['ownership', { application: 'publishing' }],
    ['topology', { collection: 'articles' }],
    ['fields', [{ path: 'properties.fields.title', role: 'identity', overview: true }]],
  ])(
    'rejects repeated %s facts that remain authoritative in their existing contract',
    (key, value) => {
      expect(() => parser()({ version: 1, [key]: value })).toThrow(new RegExp(key, 'i'));
    },
  );

  it.each([
    ['layout', 'table'],
    ['vocabulary', 'card'],
    ['density', 'compact'],
    ['sticky', true],
    ['heading', 'entity-identity'],
    ['device', 'narrow'],
    ['component', 'DecisionCard'],
    ['css', '.responsibility { position: sticky; }'],
    ['responsive', { breakpoint: 390 }],
  ])('rejects visual policy key %s from business and Meta semantics', (key, value) => {
    expect(() => parser()({ version: 1, [key]: value })).toThrow(new RegExp(key, 'i'));
  });

  it('uses an honest absent default instead of manufacturing traits or hints', () => {
    expect(parser()(undefined)).toBeUndefined();
  });
});
