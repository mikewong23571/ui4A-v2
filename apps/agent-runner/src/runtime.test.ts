import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import {
  releaseMetadata,
  runDaemon,
  runnerLivePayload,
  runnerPort,
  runnerReadyPayload,
  unavailableOneshotMessage,
} from './runtime.js';

async function allocatePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('test server did not bind a TCP port');
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

describe('Agent Runner production process skeleton', () => {
  it('reports immutable image provenance and experimental channel', () => {
    expect(
      releaseMetadata({
        UI4A_VERSION: '0.1.0-experimental.1',
        UI4A_GIT_SHA: '0123456789abcdef',
        UI4A_BUILD_DATE: '2026-08-24T00:00:00Z',
      }),
    ).toEqual({
      component: 'ui4a-agent-runner',
      version: '0.1.0-experimental.1',
      tag: 'v0.1.0-experimental.1',
      gitSha: '0123456789abcdef',
      buildDate: '2026-08-24T00:00:00Z',
      channel: 'experimental',
      support: { ga: false, productionReady: false, sla: false, lts: false },
    });
  });

  it('uses honest unknown development provenance without changing release identity', () => {
    expect(releaseMetadata({})).toMatchObject({
      version: '0.1.0-experimental.1',
      tag: 'v0.1.0-experimental.1',
      gitSha: 'unknown',
      buildDate: 'unknown',
      support: { ga: false, productionReady: false, sla: false, lts: false },
    });
  });

  it('reports process liveness without claiming Runtime Backend readiness', () => {
    expect(runnerLivePayload()).toMatchObject({ status: 'live', mode: 'daemon' });
    expect(runnerLivePayload()).not.toHaveProperty('ready');
  });

  it('fails readiness honestly while the Phase F backend and delivery are unavailable', () => {
    expect(
      runnerReadyPayload({
        lifecycle: 'serving',
        registered: false,
        deliveryAvailable: false,
      }),
    ).toMatchObject({
      schemaVersion: 1,
      component: 'ui4a-agent-runner',
      lifecycle: 'serving',
      status: 'not-ready',
      health: 'degraded',
      error: { code: 'runtime_backend_unavailable' },
      dependencies: {
        registration: {
          required: true,
          status: 'error',
          reasonCode: 'runtime_backend_unavailable',
        },
        delivery: {
          required: true,
          status: 'error',
          reasonCode: 'runtime_delivery_unavailable',
        },
      },
    });
  });

  it.each([
    ['starting', 'process_starting'],
    ['draining', 'process_draining'],
  ] as const)('keeps %s lifecycle not ready', (lifecycle, reasonCode) => {
    expect(
      runnerReadyPayload({ lifecycle, registered: true, deliveryAvailable: true }),
    ).toMatchObject({
      lifecycle,
      status: 'not-ready',
      error: { code: reasonCode },
    });
  });

  it('allows a future backend seam to report ready only when registered and deliverable', () => {
    expect(
      runnerReadyPayload({
        lifecycle: 'serving',
        registered: true,
        deliveryAvailable: true,
      }),
    ).toMatchObject({
      lifecycle: 'serving',
      status: 'ready',
      health: 'ok',
      dependencies: {
        registration: { required: true, status: 'ok' },
        delivery: { required: true, status: 'ok' },
      },
    });
  });

  it('fails honestly until Phase F defines oneshot task delivery', () => {
    expect(unavailableOneshotMessage()).toContain('unavailable');
    expect(unavailableOneshotMessage()).toContain('Phase F');
  });

  it.each(['0', '65536', '3.14', 'invalid'])('rejects invalid daemon port %s', (port) => {
    expect(() => runnerPort({ UI4A_RUNNER_PORT: port })).toThrow(
      'UI4A_RUNNER_PORT must be an integer from 1 to 65535',
    );
  });

  it('serves live/version/default-not-ready/404 over HTTP and closes on abort', async () => {
    const port = await allocatePort();
    const controller = new AbortController();
    let started: (() => void) | undefined;
    const listening = new Promise<void>((resolve) => {
      started = resolve;
    });
    const daemon = runDaemon(
      {
        UI4A_RUNNER_PORT: String(port),
        UI4A_GIT_SHA: 'runner-test-sha',
        UI4A_BUILD_DATE: '2026-08-24T00:00:00Z',
      },
      {
        host: '127.0.0.1',
        signal: controller.signal,
        write: (line) => {
          expect(JSON.parse(line)).toMatchObject({
            event: 'runner-started',
            port,
            release: { channel: 'experimental', support: { ga: false } },
          });
          started?.();
        },
      },
    );

    await listening;
    const live = await fetch(`http://127.0.0.1:${port}/live`);
    expect(live.status).toBe(200);
    expect(live.headers.get('content-type')).toBe('application/json; charset=utf-8');
    await expect(live.json()).resolves.toMatchObject({
      status: 'live',
      mode: 'daemon',
      release: {
        version: '0.1.0-experimental.1',
        channel: 'experimental',
        gitSha: 'runner-test-sha',
        support: { ga: false, productionReady: false, sla: false, lts: false },
      },
    });

    const version = await fetch(`http://127.0.0.1:${port}/version`);
    expect(version.status).toBe(200);
    await expect(version.json()).resolves.toMatchObject({
      component: 'ui4a-agent-runner',
      version: '0.1.0-experimental.1',
      support: { ga: false, productionReady: false, sla: false, lts: false },
    });

    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(ready.status).toBe(503);
    await expect(ready.json()).resolves.toMatchObject({
      status: 'not-ready',
      error: { code: 'runtime_backend_unavailable' },
    });

    const notFound = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toEqual({ status: 'not-found' });

    controller.abort();
    await expect(daemon).resolves.toBeUndefined();
  });

  it('serves 200 readiness through an injected registered delivery backend', async () => {
    const port = await allocatePort();
    const controller = new AbortController();
    let started: (() => void) | undefined;
    const listening = new Promise<void>((resolve) => {
      started = resolve;
    });
    const daemon = runDaemon(
      { UI4A_RUNNER_PORT: String(port) },
      {
        host: '127.0.0.1',
        signal: controller.signal,
        backendReadiness: () => ({ registered: true, deliveryAvailable: true }),
        write: () => started?.(),
      },
    );

    await listening;
    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toMatchObject({
      status: 'ready',
      health: 'ok',
    });

    controller.abort();
    await expect(daemon).resolves.toBeUndefined();
  });
});
