import { beforeEach, describe, expect, it, vi } from 'vitest';

const finalizeNativeFunctionSource = vi.fn();
vi.mock('../../../../../engine/capability/finalize', () => ({ finalizeNativeFunctionSource }));
vi.mock('../../../../../engine/service', () => ({ getDb: () => ({ marker: 'db' }) }));

import { POST } from './route';

function request(body: unknown, token = 'function-test-token') {
  return new Request('http://localhost:3100/api/internal/function-callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ui4a-capability-token': token },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('UI4A_CAPABILITY_CALLBACK_TOKEN', 'function-test-token');
});

describe('Native Function protected callback route', () => {
  it('rejects missing credentials and malformed bodies before finalization', async () => {
    expect((await POST(request({}, 'wrong'))).status).toBe(401);
    expect((await POST(request({ executionId: 'x' }))).status).toBe(400);
    expect(finalizeNativeFunctionSource).not.toHaveBeenCalled();
  });

  it('passes one bounded terminal claim to governed finalization', async () => {
    finalizeNativeFunctionSource.mockResolvedValue({ ok: true, deduplicated: false });
    const body = {
      schemaVersion: 1,
      executionId: 'nf-16-aaaaaaaaaaaa',
      sourceEventId: 'core:42',
      invocationHash: `sha256:${'a'.repeat(64)}`,
      outcome: {
        schemaVersion: 1,
        status: 'failed',
        failure: { code: 'catalog-offline', reason: 'offline', retryable: false },
        attempt: 3,
      },
    };
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(finalizeNativeFunctionSource).toHaveBeenCalledWith({ marker: 'db' }, body);
  });

  it('preserves structured stale/schema/idempotency failures', async () => {
    finalizeNativeFunctionSource.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'callback-stale',
      reason: 'source state changed',
    });
    const response = await POST(
      request({
        schemaVersion: 1,
        executionId: 'nf-16-aaaaaaaaaaaa',
        sourceEventId: 'core:42',
        invocationHash: `sha256:${'a'.repeat(64)}`,
        outcome: {
          schemaVersion: 1,
          status: 'cancelled',
          reason: 'requested',
          attempt: 1,
        },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'source state changed',
      code: 'callback-stale',
    });
  });
});
