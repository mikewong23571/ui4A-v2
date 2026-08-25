import fc from 'fast-check';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  PRESENTATION_PROTOCOL_VERSION,
  PRESENTATION_SITUATION_VERSION,
  MAX_RENDER_SITUATION_DEPTH,
  MAX_RENDER_SITUATION_NODES,
  completePresentationRequest,
  parseDataLens,
  parsePresentationIntent,
  parsePresentationReceipt,
  parsePresentationRequest,
  parseRenderSituation,
  type DataLens,
  type PresentationRequest,
  type RenderSituation,
} from '../index';

const intent = {
  subject: 'post:first-post',
  intent: 'inspect the selected article',
  constraints: ['prefer wide layout'],
  delivery: 'canvas',
} as const;

describe('thin presentation protocol', () => {
  it('keeps model/runtime intent separate from trusted request identity and authorization context', () => {
    const parsedIntent = parsePresentationIntent(intent);
    const request = completePresentationRequest(parsedIntent, {
      requestId: 'presentation:req-1',
      principal: 'user:mike',
      sourceMessageIds: ['message:42'],
    });

    expect(request).toEqual({
      schemaVersion: PRESENTATION_PROTOCOL_VERSION,
      requestId: 'presentation:req-1',
      principal: 'user:mike',
      ...intent,
      sourceMessageIds: ['message:42'],
    });
    expectTypeOf(request).toEqualTypeOf<PresentationRequest>();
  });

  it('round-trips one serializable request for chat, direct navigation and flow transition', () => {
    for (const sourceMessageIds of [['message:42'], [], []]) {
      const request = parsePresentationRequest({
        schemaVersion: PRESENTATION_PROTOCOL_VERSION,
        requestId: `presentation:req-${sourceMessageIds.length}`,
        principal: 'user:mike',
        ...intent,
        sourceMessageIds,
      });
      expect(parsePresentationRequest(JSON.parse(JSON.stringify(request)))).toEqual(request);
    }
  });

  it('supports an explicit bounded selection subject without Session identity', () => {
    expect(
      parsePresentationIntent({
        subject: { selection: ['post:a', 'post:b'] },
        intent: 'compare',
        delivery: 'canvas',
      }),
    ).toEqual({
      subject: { selection: ['post:a', 'post:b'] },
      intent: 'compare',
      delivery: 'canvas',
    });
    expect(() =>
      parsePresentationIntent({
        subject: { selection: ['post:a', 'post:a'] },
        intent: 'compare',
        delivery: 'canvas',
      }),
    ).toThrow(/duplicate/i);
  });

  it.each(['surface', 'component', 'bind', 'dependency', 'sessionId'])(
    'rejects forbidden presentation payload key %s at every protocol boundary',
    (forbidden) => {
      expect(() => parsePresentationIntent({ ...intent, [forbidden]: {} })).toThrow(forbidden);
      expect(() =>
        parsePresentationRequest({
          schemaVersion: PRESENTATION_PROTOCOL_VERSION,
          requestId: 'presentation:req-1',
          principal: 'user:mike',
          ...intent,
          sourceMessageIds: [],
          [forbidden]: {},
        }),
      ).toThrow(forbidden);
      expect(() =>
        parsePresentationReceipt({
          schemaVersion: PRESENTATION_PROTOCOL_VERSION,
          requestId: 'presentation:req-1',
          status: 'ready',
          [forbidden]: {},
        }),
      ).toThrow(forbidden);
    },
  );

  it('does not let an untrusted model intent smuggle runtime-controlled fields', () => {
    expect(() =>
      parsePresentationIntent({
        ...intent,
        requestId: 'attacker-selected',
        principal: 'admin',
        sourceMessageIds: ['fabricated'],
      }),
    ).toThrow(/requestId/);
  });

  it('validates compact terminal and pending receipts without accepting unrelated data', () => {
    expect(
      parsePresentationReceipt({
        schemaVersion: PRESENTATION_PROTOCOL_VERSION,
        requestId: 'presentation:req-1',
        status: 'ready',
        sidecar: { id: 'sidecar:1', version: 3 },
        surfaceUrl: '/canvas?sidecar=sidecar%3A1&version=3',
      }),
    ).toEqual({
      schemaVersion: PRESENTATION_PROTOCOL_VERSION,
      requestId: 'presentation:req-1',
      status: 'ready',
      sidecar: { id: 'sidecar:1', version: 3 },
      surfaceUrl: '/canvas?sidecar=sidecar%3A1&version=3',
    });

    expect(
      parsePresentationReceipt({
        schemaVersion: PRESENTATION_PROTOCOL_VERSION,
        requestId: 'presentation:req-2',
        status: 'failed',
        reasonCode: 'planner-unavailable',
      }),
    ).toMatchObject({ status: 'failed', reasonCode: 'planner-unavailable' });
  });
});

const baseSituation = {
  schemaVersion: 1,
  roots: [{ rel: 'post:first-post' }],
  intent: 'read article',
  lens: { kind: 'self' },
  audience: {
    principal: 'user:mike',
    policyScope: 'application:publishing',
    role: 'editor',
    deviceClass: 'desktop',
  },
  budget: { maxDepth: 2, maxNodes: 20 },
} as const;

describe('render situation and bounded data lens', () => {
  it('round-trips every supported lens without admitting a query language', () => {
    const lenses: DataLens[] = [
      { kind: 'self' },
      { kind: 'members' },
      { kind: 'selection' },
      { kind: 'relations', relations: ['collection', 'artifact'] },
      { kind: 'flow', include: ['current-node', 'context', 'outputs', 'history'] },
      { kind: 'graph', relations: ['collection', 'item', 'source'] },
    ];

    for (const lens of lenses) {
      const situation = parseRenderSituation({ ...baseSituation, lens });
      expect(parseRenderSituation(JSON.parse(JSON.stringify(situation)))).toEqual(situation);
      expect(parseDataLens(lens)).toEqual(lens);
      expectTypeOf(situation).toEqualTypeOf<RenderSituation>();
    }
    expect(PRESENTATION_SITUATION_VERSION).toBe(1);
  });

  it.each([
    [{ ...baseSituation, query: 'select *' }, 'query'],
    [{ ...baseSituation, roots: [{ rel: 'post:first-post', title: 'leak' }] }, 'title'],
    [{ ...baseSituation, audience: { ...baseSituation.audience, tenant: 'publishing' } }, 'tenant'],
    [{ ...baseSituation, budget: { ...baseSituation.budget, timeout: 1000 } }, 'timeout'],
    [{ ...baseSituation, lens: { kind: 'self', where: { published: true } } }, 'where'],
    [{ ...baseSituation, lens: { kind: 'sql', statement: 'select *' } }, 'kind'],
  ])('rejects unknown or open-query fields in strict nested schemas', (candidate, field) => {
    expect(() => parseRenderSituation(candidate)).toThrow(field);
  });

  it.each([
    [{ maxDepth: 0, maxNodes: 1 }, 'maxDepth'],
    [{ maxDepth: 1.5, maxNodes: 1 }, 'maxDepth'],
    [{ maxDepth: MAX_RENDER_SITUATION_DEPTH + 1, maxNodes: 1 }, 'maxDepth'],
    [{ maxDepth: 1, maxNodes: 0 }, 'maxNodes'],
    [{ maxDepth: 1, maxNodes: 1.5 }, 'maxNodes'],
    [{ maxDepth: 1, maxNodes: MAX_RENDER_SITUATION_NODES + 1 }, 'maxNodes'],
  ])('rejects invalid, zero or excessive traversal budgets', (budget, field) => {
    expect(() => parseRenderSituation({ ...baseSituation, budget })).toThrow(field);
  });

  it('rejects empty, duplicate or over-budget roots and unbounded selectors', () => {
    expect(() => parseRenderSituation({ ...baseSituation, roots: [] })).toThrow(/roots/);
    expect(() =>
      parseRenderSituation({
        ...baseSituation,
        roots: [{ rel: 'post:first-post' }, { rel: 'post:first-post' }],
      }),
    ).toThrow(/unique/);
    expect(() =>
      parseRenderSituation({
        ...baseSituation,
        roots: [{ rel: 'post:first-post' }, { rel: 'post:welcome' }],
        budget: { maxDepth: 1, maxNodes: 1 },
      }),
    ).toThrow(/maxNodes/);
    expect(() => parseDataLens({ kind: 'relations', relations: [] })).toThrow(/relations/);
    expect(() => parseDataLens({ kind: 'graph', relations: ['item', 'item'] })).toThrow(/unique/);
    expect(() => parseDataLens({ kind: 'flow', include: ['unknown'] })).toThrow(/include/);
  });

  it('rejects session identifiers recursively at every nesting depth', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('sessionId', 'session', 'sessionKey'),
        fc.constantFrom('root', 'audience', 'budget', 'lens'),
        (sessionKey, location) => {
          const candidate: Record<string, unknown> = structuredClone(baseSituation);
          const target =
            location === 'root' ? candidate : (candidate[location] as Record<string, unknown>);
          target[sessionKey] = 'session:secret';
          expect(() => parseRenderSituation(candidate)).toThrow(/session/i);
        },
      ),
    );
    expect(() =>
      parseDataLens({ kind: 'graph', relations: ['item'], nested: { session_id: 'secret' } }),
    ).toThrow(/session/i);
  });

  it('round-trips bounded situations under generated authorized identities and budgets', () => {
    const token = fc.stringMatching(/^[a-z][a-z0-9:-]{0,20}$/);
    fc.assert(
      fc.property(
        fc.uniqueArray(token, { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 1, max: MAX_RENDER_SITUATION_DEPTH }),
        fc.integer({ min: 8, max: MAX_RENDER_SITUATION_NODES }),
        (rels, maxDepth, maxNodes) => {
          const situation = {
            ...baseSituation,
            roots: rels.map((rel) => ({ rel })),
            budget: { maxDepth, maxNodes },
          };
          expect(parseRenderSituation(JSON.parse(JSON.stringify(situation)))).toEqual(situation);
        },
      ),
    );
  });
});
