import { describe, expect, it } from 'vitest';

import { AppParseError, parseApplicationDefinition } from './parse';

const baseApplication = {
  name: 'publishing',
  title: '内容发布',
  intent: '起草、发布并管理内容',
};

function expectApplicationIssue(candidate: unknown, path: string): void {
  let caught: unknown;
  try {
    parseApplicationDefinition(candidate);
  } catch (error) {
    caught = error;
  }
  expect(caught, `应拒绝非法 ApplicationDefinition: ${path}`).toBeInstanceOf(AppParseError);
  expect((caught as AppParseError).issues.some((issue) => issue.path === path)).toBe(true);
}

describe('ApplicationDefinition cognitive contract (T39 G1 Red)', () => {
  it('accepts system-fallback as the only Application-level cognitive trait', () => {
    expect(
      parseApplicationDefinition({
        ...baseApplication,
        name: 'default',
        cognitive: { version: 1, traits: ['system-fallback'] },
      }),
    ).toMatchObject({
      cognitive: { version: 1, traits: ['system-fallback'] },
    });

    for (const trait of [
      'work-queue',
      'review-queue',
      'output-catalog',
      'task-history',
      'human-responsibility',
      'audit-only',
    ]) {
      expectApplicationIssue(
        { ...baseApplication, cognitive: { version: 1, traits: [trait] } },
        'cognitive.traits[0]',
      );
    }
  });

  it.each([
    ['layout', 'cards'],
    ['device', 'narrow'],
    ['css', '.application { display: grid; }'],
  ])('rejects visual policy %s from Application cognition', (key, value) => {
    expect(() =>
      parseApplicationDefinition({
        ...baseApplication,
        cognitive: { version: 1, [key]: value },
      }),
    ).toThrow(new RegExp(key, 'i'));
  });
});

describe('ApplicationDefinition entry contract (T39 G1 Red)', () => {
  it.each([
    ['primary-create', 'flow:article-drafting'],
    ['primary-task', 'flow:post-status'],
    ['primary-collection', 'articles'],
    ['resume', 'post:first'],
  ])('accepts the closed role %s with a business target', (role, target) => {
    expect(
      parseApplicationDefinition({
        ...baseApplication,
        entry: { target, role },
      }),
    ).toMatchObject({ entry: { target, role } });
  });

  it('rejects the former string entry wire instead of supporting two formats', () => {
    expectApplicationIssue({ ...baseApplication, entry: 'flow:article-drafting' }, 'entry');
  });

  it('rejects unknown roles with an actionable nested issue', () => {
    expectApplicationIssue(
      {
        ...baseApplication,
        entry: { target: 'flow:article-drafting', role: 'featured' },
      },
      'entry.role',
    );
  });

  it.each([
    ['title', '发布文章'],
    ['description', '从这里开始发布'],
    ['layout', 'hero'],
  ])('rejects extra entry presentation field %s', (key, value) => {
    expectApplicationIssue(
      {
        ...baseApplication,
        entry: {
          target: 'flow:article-drafting',
          role: 'primary-create',
          [key]: value,
        },
      },
      `entry.${key}`,
    );
  });

  it.each([
    'meta/flows',
    '_meta/api/entity',
    'workspace:app:publishing',
    'https://example.com/app',
  ])('rejects non-business or implicit cross-site target %s', (target) => {
    expectApplicationIssue(
      {
        ...baseApplication,
        entry: { target, role: 'primary-task' },
      },
      'entry.target',
    );
  });

  it.each(['flows', 'members', 'surfaces'])(
    'rejects Application-owned %s membership because membership derives from Flow.app',
    (key) => {
      expectApplicationIssue({ ...baseApplication, [key]: ['article-drafting'] }, key);
    },
  );
});
