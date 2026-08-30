import { readFileSync } from 'node:fs';

import type { ApplicationDefinition, ApplicationEntry, EngineSnapshot } from '@ui4a/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Situation } from '../engine/situation';
import { startRelFromSituation } from './start-chain';

type Applications = NonNullable<EngineSnapshot['applications']>;

function application(name: string, target?: string): ApplicationDefinition {
  return {
    name,
    title: `${name} application`,
    intent: `Operate the ${name} scope`,
    ...(target === undefined
      ? {}
      : {
          entry: {
            target,
            role: 'primary-task',
          } satisfies ApplicationEntry,
        }),
  };
}

function situation({
  site = 'workstation',
  scope = 'publishing',
  focus = null,
}: {
  site?: string;
  scope?: string;
  focus?: Situation['focus'];
} = {}): Situation {
  return {
    principal: 'user:start-chain',
    site,
    scope,
    thread: null,
    focus,
    disclosure: { scope, thread: null, focus },
  };
}

function applications(...definitions: ApplicationDefinition[]): Applications {
  return Object.fromEntries(definitions.map((definition) => [definition.name, definition]));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startRelFromSituation', () => {
  it('uses a string focus as the highest-priority rel without rewriting it', () => {
    const facts = situation({ focus: 'post:welcome' });
    const installed = applications(application('publishing', 'flow:article-drafting'));

    expect(startRelFromSituation(facts, installed)).toBe('post:welcome');
  });

  it('skips a selection focus and reads the scoped application entry', () => {
    const facts = situation({ focus: { selection: ['post:first', 'post:second'] } });
    const installed = applications(application('publishing', 'flow:article-drafting'));

    expect(startRelFromSituation(facts, installed)).toBe('flow:article-drafting');
  });

  it('reads the scoped application entry when focus is absent', () => {
    const installed = applications(application('publishing', 'articles:review-queue'));

    expect(startRelFromSituation(situation(), installed)).toBe('articles:review-queue');
  });

  it.each([
    {
      site: 'workstation',
      missing: 'application',
      installed: applications(),
      expected: 'articles',
    },
    {
      site: 'workstation',
      missing: 'entry',
      installed: applications(application('publishing')),
      expected: 'articles',
    },
    { site: 'meta', missing: 'application', installed: applications(), expected: 'meta/flows' },
    {
      site: 'meta',
      missing: 'entry',
      installed: applications(application('governance')),
      expected: 'meta/flows',
    },
  ] as const)(
    'falls back from a missing $missing on the $site site to $expected',
    ({ site, installed, expected }) => {
      const scope = site === 'meta' ? 'governance' : 'publishing';

      expect(startRelFromSituation(situation({ site, scope }), installed)).toBe(expected);
    },
  );

  it('keeps focus above entry and entry above the site fallback', () => {
    const installed = applications(application('publishing', 'flow:configured-entry'));

    expect(startRelFromSituation(situation({ focus: 'post:focused' }), installed)).toBe(
      'post:focused',
    );
    expect(startRelFromSituation(situation(), installed)).toBe('flow:configured-entry');
    expect(startRelFromSituation(situation(), applications())).toBe('articles');
  });

  it('has a two-fact-input API and performs no reachability probe', () => {
    const fetchProbe = vi.fn(() => {
      throw new Error('start-chain must not probe entity reachability');
    });
    vi.stubGlobal('fetch', fetchProbe);

    expect(startRelFromSituation).toHaveLength(2);
    expect(
      startRelFromSituation(
        situation(),
        applications(application('publishing', 'flow:article-drafting')),
      ),
    ).toBe('flow:article-drafting');
    expect(fetchProbe).not.toHaveBeenCalled();
  });

  it('keeps lexical matching and request inputs out of the start chain source', () => {
    const implementation = readFileSync(new URL('./start-chain.ts', import.meta.url), 'utf8');

    expect(implementation).not.toMatch(/from\s+['"]@ui4a\/agent(?:\/[^'"]*)?['"]/);
    expect(implementation).not.toContain('protocol/match');
    expect(implementation).not.toMatch(/\boverlaps\b/);
    expect(implementation).not.toMatch(/\b(?:fetch|baseUrl|goal)\b/);
  });
});
