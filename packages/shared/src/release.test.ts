import { describe, expect, it } from 'vitest';

import {
  RELEASE_CHANNEL,
  RELEASE_SUPPORT,
  RELEASE_TAG,
  RELEASE_VERSION,
  releaseMetadata,
} from './release';

describe('canonical experimental release identity', () => {
  it('separates semver, display tag, and channel', () => {
    expect(RELEASE_VERSION).toBe('0.1.0-experimental.1');
    expect(RELEASE_TAG).toBe('v0.1.0-experimental.1');
    expect(RELEASE_CHANNEL).toBe('experimental');
  });

  it('explicitly makes no GA, production-readiness, SLA, or LTS assurance', () => {
    expect(RELEASE_SUPPORT).toEqual({
      ga: false,
      productionReady: false,
      sla: false,
      lts: false,
    });
  });

  it('accepts image provenance and uses honest unknown development fallbacks', () => {
    expect(releaseMetadata('ui4a-web')).toEqual({
      component: 'ui4a-web',
      version: RELEASE_VERSION,
      tag: RELEASE_TAG,
      channel: RELEASE_CHANNEL,
      support: RELEASE_SUPPORT,
      gitSha: 'unknown',
      buildDate: 'unknown',
    });
    expect(
      releaseMetadata('ui4a-web', {
        UI4A_VERSION: RELEASE_VERSION,
        UI4A_GIT_SHA: 'abc123',
        UI4A_BUILD_DATE: '2026-08-24T00:00:00Z',
      }),
    ).toMatchObject({ gitSha: 'abc123', buildDate: '2026-08-24T00:00:00Z' });
  });

  it('fails closed when injected image version drifts from the application contract', () => {
    expect(() => releaseMetadata('ui4a-web', { UI4A_VERSION: '0.1.0' })).toThrow(
      'must match canonical release',
    );
  });
});
