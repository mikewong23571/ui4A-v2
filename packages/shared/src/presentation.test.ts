import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  PRESENTATION_PROTOCOL_VERSION,
  completePresentationRequest,
  parsePresentationIntent,
  parsePresentationReceipt,
  parsePresentationRequest,
  type PresentationRequest,
} from './index';

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
