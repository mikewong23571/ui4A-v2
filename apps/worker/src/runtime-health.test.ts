import { describe, expect, it } from 'vitest';

import { workerLivePayload, workerReleaseMetadata } from './runtime-health';

describe('Worker production process metadata', () => {
  it('reports liveness without claiming dependency readiness', () => {
    const payload = workerLivePayload({ UI4A_VERSION: 'v0.1.0-experimental.1' });

    expect(payload).toMatchObject({
      status: 'live',
      release: { component: 'ui4a-worker', channel: 'experimental' },
    });
    expect(payload).not.toHaveProperty('ready');
  });

  it('reports image-provided provenance', () => {
    expect(
      workerReleaseMetadata({
        UI4A_VERSION: 'v0.1.0-experimental.1',
        UI4A_GIT_SHA: 'abc123',
        UI4A_BUILD_DATE: '2026-08-24T00:00:00Z',
      }),
    ).toMatchObject({ version: 'v0.1.0-experimental.1', gitSha: 'abc123' });
  });
});
