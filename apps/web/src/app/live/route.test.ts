import { afterEach, describe, expect, it } from 'vitest';

import { GET } from './route';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('GET /live', () => {
  it('reports only process liveness and image provenance', async () => {
    process.env.UI4A_VERSION = '0.1.0-experimental.1';
    process.env.UI4A_GIT_SHA = 'abc123';
    process.env.UI4A_BUILD_DATE = '2026-08-24T00:00:00Z';

    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'live',
      release: {
        component: 'ui4a-web',
        version: '0.1.0-experimental.1',
        tag: 'v0.1.0-experimental.1',
        gitSha: 'abc123',
        buildDate: '2026-08-24T00:00:00Z',
        channel: 'experimental',
        support: { ga: false, productionReady: false, sla: false, lts: false },
      },
    });
  });

  it('uses honest unknown provenance without changing release identity in development', async () => {
    delete process.env.UI4A_VERSION;
    delete process.env.UI4A_GIT_SHA;
    delete process.env.UI4A_BUILD_DATE;

    await expect(GET().json()).resolves.toMatchObject({
      release: {
        version: '0.1.0-experimental.1',
        tag: 'v0.1.0-experimental.1',
        gitSha: 'unknown',
        buildDate: 'unknown',
        support: { ga: false, productionReady: false, sla: false, lts: false },
      },
    });
  });
});
