import { Buffer } from 'node:buffer';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  startResponsesLoopbackAdapter,
  type ResponsesLoopbackAdapter,
} from './responses-loopback-adapter.js';

const upstreamBaseUrl = 'https://llm.mothership.internal/v1';
const authorization = 'Bearer __adapter_test_credential__';
const openAdapters: ResponsesLoopbackAdapter[] = [];

afterEach(async () => {
  await Promise.all(openAdapters.splice(0).map((adapter) => adapter.close()));
});

async function start(
  fetchImplementation: typeof fetch,
  requestTimeoutMs = 1_000,
): Promise<ResponsesLoopbackAdapter> {
  const adapter = await startResponsesLoopbackAdapter({
    upstreamBaseUrl,
    requestTimeoutMs,
    fetch: fetchImplementation,
  });
  openAdapters.push(adapter);
  return adapter;
}

function streamedResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    {
      status,
      headers: {
        'content-type': 'text/event-stream',
        connection: 'close',
        'x-ui4a-safe': 'present',
      },
    },
  );
}

describe('Runner bounded Responses loopback adapter', () => {
  it('binds an ephemeral loopback endpoint and transparently streams one canonical request', async () => {
    const upstreamChunks = ['event: response.created\n', 'data: {"type":"done"}\n\n'];
    const captured: Array<{ url: string; init: RequestInit }> = [];
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(input), init: init ?? {} });
      return streamedResponse(upstreamChunks);
    }) as typeof fetch;
    const adapter = await start(upstream);

    expect(adapter.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*\/v1$/);
    const body = Buffer.from('{"model":"server-owned","stream":true}', 'utf8');
    const response = await fetch(`${adapter.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
        'user-agent': 'codex_sdk_ts/0.149.0 (codex_exec; 0.149.0)',
        originator: 'codex_sdk_ts',
        'x-codex-beta-features': 'one,two',
      },
      body,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-ui4a-safe')).toBe('present');
    expect(await response.text()).toBe(upstreamChunks.join(''));
    expect(upstream).toHaveBeenCalledOnce();
    expect(captured[0]?.url).toBe('https://llm.mothership.internal/v1/responses');
    expect(captured[0]?.init.redirect).toBe('error');
    const headers = new Headers(captured[0]?.init.headers);
    expect(headers.get('authorization')).toBe(authorization);
    expect(headers.get('originator')).toBe('codex_sdk_ts');
    expect(headers.get('x-codex-beta-features')).toBe('one,two');
    expect(headers.get('user-agent')).toBe('ui4a-runner/0.1.0-experimental.1');
    for (const stripped of [
      'connection',
      'content-length',
      'host',
      'keep-alive',
      'proxy-authorization',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
    ]) {
      expect(headers.has(stripped), stripped).toBe(false);
    }
    expect(Buffer.from(await new Response(captured[0]?.init.body).arrayBuffer()).equals(body)).toBe(
      true,
    );
  });

  it('accepts only the exact canonical POST route with zero upstream fallback', async () => {
    const upstream = vi.fn(async () => streamedResponse([])) as typeof fetch;
    const adapter = await start(upstream);

    const responses = await Promise.all([
      fetch(`${adapter.baseUrl}/responses`),
      fetch(`${adapter.baseUrl}/other`, { method: 'POST', body: '{}' }),
      fetch(`${adapter.baseUrl}/responses?target=https://other.invalid`, {
        method: 'POST',
        body: '{}',
      }),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([405, 404, 404]);
    expect(upstream).not.toHaveBeenCalled();
    for (const response of responses) {
      await expect(response.json()).resolves.toEqual({
        error: { code: 'runner_responses_adapter_route_rejected', type: 'adapter_error' },
      });
    }
  });

  it.each([
    'http://llm.mothership.internal/v1',
    'https://user:password@llm.mothership.internal/v1',
    'https://llm.mothership.internal/v1?target=other',
    'https://llm.mothership.internal/v1/responses',
  ])('rejects non-canonical upstream %s before listening', async (invalidUrl) => {
    await expect(
      startResponsesLoopbackAdapter({
        upstreamBaseUrl: invalidUrl,
        requestTimeoutMs: 1_000,
        fetch: vi.fn() as typeof fetch,
      }),
    ).rejects.toThrow('runner_responses_adapter_config_invalid');
  });

  it('aborts a timed-out upstream and returns only a stable redacted error', async () => {
    let upstreamSignal: AbortSignal | undefined;
    const upstream = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        upstreamSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          upstreamSignal?.addEventListener('abort', () => reject(new Error('__upstream_secret__')));
        });
      },
    ) as typeof fetch;
    const adapter = await start(upstream, 10);

    const response = await fetch(`${adapter.baseUrl}/responses`, {
      method: 'POST',
      headers: { authorization },
      body: '{}',
    });

    expect(response.status).toBe(502);
    expect(upstreamSignal?.aborted).toBe(true);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: 'runner_responses_adapter_upstream_failed', type: 'adapter_error' },
    });
    expect(text).not.toContain('__upstream_secret__');
    expect(text).not.toContain(authorization);
  });

  it('close is idempotent and aborts active work without leaving a fallback listener', async () => {
    let upstreamSignal: AbortSignal | undefined;
    let started!: () => void;
    const upstreamStarted = new Promise<void>((resolve) => (started = resolve));
    const upstream = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        upstreamSignal = init?.signal ?? undefined;
        started();
        return new Promise<Response>((_resolve, reject) => {
          upstreamSignal?.addEventListener('abort', () => reject(new Error('closed')));
        });
      },
    ) as typeof fetch;
    const adapter = await start(upstream, 60_000);
    const pending = fetch(`${adapter.baseUrl}/responses`, { method: 'POST', body: '{}' }).catch(
      () => undefined,
    );
    await upstreamStarted;

    await expect(adapter.close()).resolves.toBeUndefined();
    await expect(adapter.close()).resolves.toBeUndefined();
    await pending;
    expect(upstreamSignal?.aborted).toBe(true);
    await expect(fetch(`${adapter.baseUrl}/responses`)).rejects.toBeDefined();
  });
});
