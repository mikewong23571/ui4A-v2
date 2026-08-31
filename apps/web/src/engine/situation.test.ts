import { describe, expect, it } from 'vitest';

import { assembleSituation, grantedPolicyScopes, type SituationInput } from './situation';

const presence = {
  principal: 'user:one',
  site: 'meta',
  scope: 'publishing',
  thread: 'thread:presence',
  focus: 'post:presence',
  updatedSeq: 12,
} as const;

const defaults = { site: 'workstation' } as const;

function input(overrides: Partial<SituationInput> = {}): SituationInput {
  return {
    principal: 'user:one',
    grantedScopes: ['default', 'publishing'],
    presence,
    defaults,
    ...overrides,
  };
}

describe('situation assembler', () => {
  it('treats explicit null as a cleared application, thread and focus', () => {
    expect(
      assembleSituation(
        input({
          explicit: { scope: null, thread: null, focus: null },
        }),
      ),
    ).toMatchObject({
      scope: undefined,
      thread: null,
      focus: null,
      disclosure: { scope: undefined, thread: null, focus: null },
    });
  });

  it('normalizes production policy claim names without admitting infrastructure scopes', () => {
    expect(grantedPolicyScopes(['ui4a:read', 'ui4a:policy:publishing', 'default'])).toEqual([
      'publishing',
      'default',
    ]);
  });

  it('gives valid explicit parameters priority over presence and defaults', () => {
    expect(
      assembleSituation(
        input({
          explicit: {
            site: 'workstation',
            scope: 'default',
            thread: 'thread:explicit',
            focus: 'post:explicit',
          },
        }),
      ),
    ).toEqual({
      principal: 'user:one',
      site: 'workstation',
      scope: 'default',
      thread: 'thread:explicit',
      focus: 'post:explicit',
      disclosure: {
        scope: 'default',
        thread: 'thread:explicit',
        focus: 'post:explicit',
      },
    });
  });

  it('uses presence as structured assistance when explicit values are absent', () => {
    expect(assembleSituation(input())).toMatchObject({
      site: 'meta',
      scope: 'publishing',
      thread: 'thread:presence',
      focus: 'post:presence',
    });
  });

  it('supports CLI/headless callers without presence and keeps explicit scope authorized', () => {
    expect(
      assembleSituation(
        input({
          presence: undefined,
          explicit: { scope: 'publishing', focus: 'post:cli' },
        }),
      ),
    ).toMatchObject({
      site: 'workstation',
      scope: 'publishing',
      thread: null,
      focus: 'post:cli',
    });
  });

  it('skips an ungranted explicit scope and chooses the authorized auxiliary scope', () => {
    expect(
      assembleSituation(
        input({
          explicit: { scope: 'governance' },
          grantedScopes: ['publishing'],
        }),
      ).scope,
    ).toBe('publishing');
  });

  it('stays unlocated instead of stealing the first grant when no valid lens exists', () => {
    const grants = ['publishing', 'governance'] as const;
    const situation = assembleSituation(
      input({
        grantedScopes: grants,
        presence: undefined,
        explicit: undefined,
        defaults: { site: 'workstation' },
      }),
    );

    expect(situation.scope).toBeUndefined();
    expect(situation.disclosure.scope).toBeUndefined();
    expect(grants).toEqual(['publishing', 'governance']);
  });

  it('drops invalid attention candidates to unlocated without changing the grant envelope', () => {
    const grants = ['publishing', 'governance'] as const;
    const situation = assembleSituation(
      input({
        grantedScopes: grants,
        presence: { ...presence, scope: 'outside-presence' },
        explicit: { scope: 'outside-explicit' },
        defaults: { site: 'workstation' },
      }),
    );

    expect(situation.scope).toBeUndefined();
    expect(situation.disclosure.scope).toBeUndefined();
    expect(grants).toEqual(['publishing', 'governance']);
  });

  it('fails closed on an empty grant envelope even when candidates exist', () => {
    // D48-R8: 空 grantedScopes = 无任何已授权 scope,候选(presence 上报)不构成授权。
    expect(() =>
      assembleSituation(input({ grantedScopes: [], explicit: { scope: 'publishing' } })),
    ).toThrowError('situation has no authorized policy scope');
  });

  it('fails closed on an empty grant envelope without leaning on presence or defaults', () => {
    expect(() => assembleSituation(input({ grantedScopes: [] }))).toThrowError(
      'situation has no authorized policy scope',
    );
  });
});
