import { describe, expect, it, vi } from 'vitest';

import { createBoundedBearerFetch } from './authenticated-fetch';
import type { FetchLike } from '../types';

describe('createBoundedBearerFetch', () => {
  it('seals Authorization and transport to the exact HTTPS UI4A contract surface', async () => {
    const token = 'test-agent-token-must-not-leak';
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(Response.json({ ok: true }));
    const authenticatedFetch = createBoundedBearerFetch({
      origin: 'https://ui4a.mothership.internal',
      authorizationHeader: `Bearer ${token}`,
      allowedPaths: ['/.well-known/ui4a.json', '/api/entity', '/api/exec', '/api/exec-plan'],
      fetch: fetchImpl,
    });

    await authenticatedFetch('https://ui4a.mothership.internal/.well-known/ui4a.json', {
      headers: { authorization: 'Bearer caller-controlled' },
    });
    await authenticatedFetch('https://ui4a.mothership.internal/api/entity?rel=articles');
    await authenticatedFetch('https://ui4a.mothership.internal/api/exec', {
      method: 'POST',
      headers: {
        authorization: 'Bearer forged',
        'content-type': 'application/siren+json',
      },
      body: '{}',
      redirect: 'follow',
    });
    await authenticatedFetch('https://ui4a.mothership.internal/api/exec-plan', {
      method: 'POST',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`);
      expect(init?.redirect).toBe('error');
    }
    expect(new Headers(fetchImpl.mock.calls[2]?.[1]?.headers).get('content-type')).toBe(
      'application/siren+json',
    );

    for (const forbiddenUrl of [
      'http://ui4a.mothership.internal/api/entity',
      'https://other.mothership.internal/api/entity',
      'https://ui4a.mothership.internal/api/executor',
      'https://ui4a.mothership.internal/api/entity/child',
      'https://user:password@ui4a.mothership.internal/api/entity',
    ]) {
      const error = await authenticatedFetch(forbiddenUrl).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(token);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
