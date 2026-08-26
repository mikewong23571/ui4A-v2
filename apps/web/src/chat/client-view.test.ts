import { describe, expect, it } from 'vitest';

import { clientViewReportForLocation } from './client-view';
import { presenceObservationForLocation } from '../presence/client';

describe('T21 client view capture', () => {
  it.each([
    ['/entity?rel=post%3Afirst-post', 'post:first-post'],
    ['/canvas?focus=post%3Afirst-post', 'post:first-post'],
    ['/canvas?sidecar=sidecar%3A1&focus=articles', 'articles'],
  ])('mechanically reads one presence focus from %s', (route, focus) => {
    expect(clientViewReportForLocation('client:a', route)).toMatchObject({
      schemaVersion: 2,
      presence: { clientInstanceId: 'client:a', site: 'workstation', focus },
    });
  });

  it('reads an explicit roots selection without inventing an intent', () => {
    expect(
      clientViewReportForLocation('client:a', '/canvas?roots=post%3Aa%2Cpost%3Ab'),
    ).toMatchObject({ presence: { focus: { selection: ['post:a', 'post:b'] } } });
  });

  it.each(['/', '/canvas', '/canvas?concern=unknown'])(
    'keeps subject unknown when route %s does not prove one',
    (route) => {
      expect(clientViewReportForLocation('client:a', route)).toEqual({
        schemaVersion: 2,
        presence: {
          clientInstanceId: 'client:a',
          site: 'workstation',
          scope: null,
          thread: null,
          focus: null,
        },
      });
    },
  );

  it('associates a Presentation request only while the visible route matches its surface URL', () => {
    const receipt = {
      requestId: 'turn:1:presentation:1',
      surfaceUrl: '/canvas?sidecar=sidecar%3A1&focus=articles',
    };
    expect(clientViewReportForLocation('client:a', receipt.surfaceUrl, receipt)).toMatchObject({
      presence: { presentationRequestId: receipt.requestId },
    });
    expect(
      clientViewReportForLocation('client:a', '/canvas?focus=post%3Aa', receipt),
    ).not.toHaveProperty('presence.presentationRequestId');
  });

  it('carries the same complete URL observation used by the shell and reporter', () => {
    const route =
      '/meta/entity?scope=governance&thread=release-1&rel=meta%2Fflow%3Aarticle-drafting';
    const observation = presenceObservationForLocation(route);

    expect(clientViewReportForLocation('client:a', route).presence).toMatchObject({
      clientInstanceId: 'client:a',
      ...observation,
    });
  });
});
