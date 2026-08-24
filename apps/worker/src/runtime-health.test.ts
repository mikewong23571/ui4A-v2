import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import {
  createWorkerHealthHandler,
  startWorkerHealthServer,
  workerLivePayload,
  workerReleaseMetadata,
} from './runtime-health';

function invokeHealthHandler(method: string, url: string) {
  const writeHead = vi.fn();
  const end = vi.fn();
  createWorkerHealthHandler({
    UI4A_VERSION: '0.1.0-experimental.1',
    UI4A_GIT_SHA: 'health-test-sha',
  })({ method, url } as IncomingMessage, { writeHead, end } as unknown as ServerResponse);
  return { writeHead, end };
}

describe('Worker production process metadata', () => {
  it('reports liveness without claiming dependency readiness', () => {
    const payload = workerLivePayload({ UI4A_VERSION: '0.1.0-experimental.1' });

    expect(payload).toMatchObject({
      status: 'live',
      release: { component: 'ui4a-worker', channel: 'experimental' },
    });
    expect(payload).not.toHaveProperty('ready');
  });

  it('reports image-provided provenance', () => {
    expect(
      workerReleaseMetadata({
        UI4A_VERSION: '0.1.0-experimental.1',
        UI4A_GIT_SHA: 'abc123',
        UI4A_BUILD_DATE: '2026-08-24T00:00:00Z',
      }),
    ).toMatchObject({
      version: '0.1.0-experimental.1',
      tag: 'v0.1.0-experimental.1',
      channel: 'experimental',
      support: { ga: false, productionReady: false, sla: false, lts: false },
      gitSha: 'abc123',
    });
  });

  it('uses unknown rather than invented development provenance', () => {
    expect(workerReleaseMetadata({})).toMatchObject({
      version: '0.1.0-experimental.1',
      gitSha: 'unknown',
      buildDate: 'unknown',
      support: { ga: false, productionReady: false, sla: false, lts: false },
    });
  });

  it('serves /live as process liveness and /version as release metadata', () => {
    const live = invokeHealthHandler('GET', '/live');
    const version = invokeHealthHandler('GET', '/version');

    expect(live.writeHead).toHaveBeenCalledWith(200, {
      'content-type': 'application/json; charset=utf-8',
    });
    expect(JSON.parse(String(live.end.mock.calls[0]?.[0]))).toMatchObject({
      status: 'live',
      release: { component: 'ui4a-worker', gitSha: 'health-test-sha' },
    });
    expect(JSON.parse(String(version.end.mock.calls[0]?.[0]))).toMatchObject({
      component: 'ui4a-worker',
      gitSha: 'health-test-sha',
    });
  });

  it.each([
    ['POST', '/live'],
    ['GET', '/ready'],
    ['GET', '/missing'],
  ])('returns 404 for %s %s', (method, url) => {
    const response = invokeHealthHandler(method, url);

    expect(response.writeHead).toHaveBeenCalledWith(404, {
      'content-type': 'application/json; charset=utf-8',
    });
    expect(response.end).toHaveBeenCalledWith('{"status":"not-found"}\n');
  });

  it.each(['0', '65536', '1.5', 'not-a-port'])(
    'rejects invalid health port %s before bind',
    async (port) => {
      await expect(startWorkerHealthServer({ UI4A_WORKER_HEALTH_PORT: port })).rejects.toThrow(
        /integer from 1 to 65535/,
      );
    },
  );
});
