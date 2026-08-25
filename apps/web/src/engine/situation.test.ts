import { describe, expect, it } from 'vitest';

import { assembleSituation, type SituationInput } from './situation';

const presence = {
  principal: 'user:one',
  site: 'meta',
  scope: 'publishing',
  thread: 'thread:presence',
  focus: 'post:presence',
  updatedSeq: 12,
} as const;

const defaults = { site: 'business', scope: 'default' } as const;

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
  it('gives valid explicit parameters priority over presence and defaults', () => {
    expect(
      assembleSituation(
        input({
          explicit: {
            site: 'business',
            scope: 'default',
            thread: 'thread:explicit',
            focus: 'post:explicit',
          },
        }),
      ),
    ).toEqual({
      principal: 'user:one',
      site: 'business',
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
      site: 'business',
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
});
