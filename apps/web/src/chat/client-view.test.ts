import { describe, expect, it } from 'vitest';

import { clientViewReportForLocation } from './client-view';

describe('T21 client view capture', () => {
  it.each([
    ['/entity?rel=post%3Afirst-post', 'post:first-post'],
    ['/canvas?focus=post%3Afirst-post', 'post:first-post'],
    ['/canvas?sidecar=sidecar%3A1&focus=articles', 'articles'],
  ])('mechanically reads one subject from %s', (route, subject) => {
    expect(clientViewReportForLocation('client:a', route)).toEqual({
      schemaVersion: 1,
      clientInstanceId: 'client:a',
      route,
      subject,
    });
  });

  it('reads an explicit roots selection without inventing an intent', () => {
    expect(
      clientViewReportForLocation('client:a', '/canvas?roots=post%3Aa%2Cpost%3Ab'),
    ).toMatchObject({ subject: { selection: ['post:a', 'post:b'] } });
  });

  it.each(['/', '/canvas', '/canvas?concern=unknown'])(
    'keeps subject unknown when route %s does not prove one',
    (route) => {
      expect(clientViewReportForLocation('client:a', route)).toEqual({
        schemaVersion: 1,
        clientInstanceId: 'client:a',
        route,
      });
    },
  );

  it('associates a Presentation request only while the visible route matches its surface URL', () => {
    const receipt = {
      requestId: 'turn:1:presentation:1',
      surfaceUrl: '/canvas?sidecar=sidecar%3A1&focus=articles',
    };
    expect(clientViewReportForLocation('client:a', receipt.surfaceUrl, receipt)).toMatchObject({
      presentationRequestId: receipt.requestId,
    });
    expect(
      clientViewReportForLocation('client:a', '/canvas?focus=post%3Aa', receipt),
    ).not.toHaveProperty('presentationRequestId');
  });
});
