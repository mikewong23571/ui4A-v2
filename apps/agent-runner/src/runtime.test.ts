import { describe, expect, it } from 'vitest';

import { releaseMetadata, runnerLivePayload, unavailableOneshotMessage } from './runtime.js';

describe('Agent Runner production process skeleton', () => {
  it('reports immutable image provenance and experimental channel', () => {
    expect(
      releaseMetadata({
        UI4A_VERSION: 'v0.1.0-experimental.1',
        UI4A_GIT_SHA: '0123456789abcdef',
        UI4A_BUILD_DATE: '2026-08-24T00:00:00Z',
      }),
    ).toEqual({
      component: 'ui4a-agent-runner',
      version: 'v0.1.0-experimental.1',
      gitSha: '0123456789abcdef',
      buildDate: '2026-08-24T00:00:00Z',
      channel: 'experimental',
    });
  });

  it('reports process liveness without claiming Runtime Backend readiness', () => {
    expect(runnerLivePayload()).toMatchObject({ status: 'live', mode: 'daemon' });
    expect(runnerLivePayload()).not.toHaveProperty('ready');
  });

  it('fails honestly until Phase F defines oneshot task delivery', () => {
    expect(unavailableOneshotMessage()).toContain('unavailable');
    expect(unavailableOneshotMessage()).toContain('Phase F');
  });
});
