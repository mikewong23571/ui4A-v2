import { afterEach, describe, expect, it } from 'vitest';

import { GET } from './route';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('GET /live', () => {
  it('reports only process liveness and image provenance', async () => {
    process.env.UI4A_VERSION = 'v0.1.0-experimental.1';
    process.env.UI4A_GIT_SHA = 'abc123';
    process.env.UI4A_BUILD_DATE = '2026-08-24T00:00:00Z';

    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'live',
      component: 'ui4a-web',
      release: {
        version: 'v0.1.0-experimental.1',
        gitSha: 'abc123',
        buildDate: '2026-08-24T00:00:00Z',
        channel: 'experimental',
      },
    });
  });
});
