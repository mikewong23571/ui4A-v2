import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CHAT_VIEW_PROTOCOL_VERSION,
  parseClientViewReport,
  parseNavigationCompletion,
  type ClientViewReport,
  type NavigationCompletion,
} from './index';

describe('T21 dual-focus shared contract', () => {
  it('round-trips a bounded client observation without granting authority', () => {
    const report = parseClientViewReport({
      schemaVersion: CHAT_VIEW_PROTOCOL_VERSION,
      clientInstanceId: 'client:one',
      route: '/canvas?focus=post%3Afirst-post',
      subject: 'post:first-post',
      presentationRequestId: 'turn:1:presentation:1',
    });

    expect(report).toEqual({
      schemaVersion: 1,
      clientInstanceId: 'client:one',
      route: '/canvas?focus=post%3Afirst-post',
      subject: 'post:first-post',
      presentationRequestId: 'turn:1:presentation:1',
    });
    expectTypeOf(report).toEqualTypeOf<ClientViewReport>();
  });

  it('keeps one client selection independent from server navigation provenance', () => {
    expect(
      parseClientViewReport({
        schemaVersion: 1,
        clientInstanceId: 'client:two',
        route: '/canvas?roots=post%3Aa%2Cpost%3Ab',
        subject: { selection: ['post:a', 'post:b'] },
      }),
    ).toMatchObject({
      clientInstanceId: 'client:two',
      subject: { selection: ['post:a', 'post:b'] },
    });

    const completion = parseNavigationCompletion({
      schemaVersion: 1,
      navigationId: 'turn:1:navigate:2',
      source: 'agent-navigate',
      sessionId: 'session:one',
      turnId: 'turn:1',
      subject: 'post:first-post',
      route: '/canvas?focus=post%3Afirst-post',
      sourceMessageIds: ['message:1'],
      step: 2,
    });
    expectTypeOf(completion).toEqualTypeOf<NavigationCompletion>();
    expect(completion.source).toBe('agent-navigate');
  });

  it.each([
    [{ schemaVersion: 1, clientInstanceId: 'c', route: 'https://evil.example/canvas' }, 'route'],
    [{ schemaVersion: 1, clientInstanceId: 'c', route: '//evil.example/canvas' }, 'route'],
    [{ schemaVersion: 1, clientInstanceId: 'c', route: '/canvas#hidden' }, 'route'],
    [
      {
        schemaVersion: 1,
        clientInstanceId: 'c',
        route: '/canvas',
        subject: { selection: ['post:a', 'post:a'] },
      },
      'duplicate',
    ],
    [
      {
        schemaVersion: 1,
        clientInstanceId: 'c',
        route: '/canvas',
        principal: 'admin',
      },
      'principal',
    ],
    [
      {
        schemaVersion: 1,
        clientInstanceId: 'c',
        route: '/canvas',
        authorization: { actor: 'human' },
      },
      'authorization',
    ],
  ])('rejects unbounded or authority-bearing client input %#', (value, message) => {
    expect(() => parseClientViewReport(value)).toThrow(message);
  });

  it('rejects invalid completion sources and missing success provenance', () => {
    expect(() =>
      parseNavigationCompletion({
        schemaVersion: 1,
        navigationId: 'nav:1',
        source: 'client-view',
        sessionId: 'session:one',
        turnId: 'turn:1',
        subject: 'articles',
        route: '/canvas?focus=articles',
        sourceMessageIds: [],
      }),
    ).toThrow(/source/);

    expect(() =>
      parseNavigationCompletion({
        schemaVersion: 1,
        navigationId: 'nav:1',
        source: 'presentation-receipt',
        sessionId: 'session:one',
        turnId: 'turn:1',
        subject: 'articles',
        route: '/canvas?focus=articles',
        sourceMessageIds: ['message:1'],
      }),
    ).toThrow(/presentationRequestId/);
  });
});
