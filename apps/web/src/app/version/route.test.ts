import { afterEach, describe, expect, it } from 'vitest';

import { GET } from './route';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('GET /version', () => {
  it('reports the canonical experimental release and injected image provenance', async () => {
    process.env.UI4A_VERSION = '0.1.0-experimental.1';
    process.env.UI4A_GIT_SHA = 'abc123';
    process.env.UI4A_BUILD_DATE = '2026-08-24T00:00:00Z';

    await expect(GET().json()).resolves.toEqual({
      component: 'ui4a-web',
      version: '0.1.0-experimental.1',
      tag: 'v0.1.0-experimental.1',
      channel: 'experimental',
      support: { ga: false, productionReady: false, sla: false, lts: false },
      gitSha: 'abc123',
      buildDate: '2026-08-24T00:00:00Z',
    });
  });
});
