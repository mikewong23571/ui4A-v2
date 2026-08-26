import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CHAT_VIEW_PROTOCOL_VERSION,
  parseClientViewReport,
  parseNavigationCompletion,
  type ClientViewReport,
  type NavigationCompletion,
} from '../index';

describe('T21 dual-focus shared contract', () => {
  it('round-trips a bounded client observation without granting authority', () => {
    const report = parseClientViewReport({
      schemaVersion: CHAT_VIEW_PROTOCOL_VERSION,
      presence: {
        clientInstanceId: 'client:one',
        site: 'workstation',
        scope: null,
        thread: null,
        focus: 'post:first-post',
        presentationRequestId: 'turn:1:presentation:1',
      },
    });

    expect(report).toEqual({
      schemaVersion: 2,
      presence: {
        clientInstanceId: 'client:one',
        site: 'workstation',
        scope: null,
        thread: null,
        focus: 'post:first-post',
        presentationRequestId: 'turn:1:presentation:1',
      },
    });
    expectTypeOf(report).toEqualTypeOf<ClientViewReport>();
  });

  it('keeps one client selection independent from server navigation provenance', () => {
    expect(
      parseClientViewReport({
        schemaVersion: 2,
        presence: {
          clientInstanceId: 'client:two',
          site: 'workstation',
          scope: null,
          thread: null,
          focus: { selection: ['post:a', 'post:b'] },
        },
      }),
    ).toMatchObject({
      presence: {
        clientInstanceId: 'client:two',
        focus: { selection: ['post:a', 'post:b'] },
      },
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
    [
      {
        schemaVersion: 2,
        presence: { clientInstanceId: 'c', site: '', scope: null, thread: null, focus: null },
      },
      'site',
    ],
    [
      {
        schemaVersion: 2,
        presence: {
          clientInstanceId: 'c',
          site: 'workstation',
          scope: null,
          thread: null,
          focus: null,
        },
        route: '/legacy',
      },
      'forbidden',
    ],
    [
      {
        schemaVersion: 2,
        presence: {
          clientInstanceId: 'c',
          site: 'workstation',
          scope: null,
          thread: null,
          focus: { selection: ['post:a', 'post:a'] },
        },
      },
      'duplicate',
    ],
    [
      {
        schemaVersion: 2,
        presence: {
          clientInstanceId: 'c',
          site: 'workstation',
          scope: null,
          thread: null,
          focus: null,
        },
        principal: 'admin',
      },
      'principal',
    ],
    [
      {
        schemaVersion: 2,
        presence: {
          clientInstanceId: 'c',
          site: 'workstation',
          scope: null,
          thread: null,
          focus: null,
        },
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
