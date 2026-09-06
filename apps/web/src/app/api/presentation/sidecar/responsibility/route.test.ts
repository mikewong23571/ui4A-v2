import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  authorize: vi.fn(),
  coverage: vi.fn(),
  append: vi.fn(),
}));
vi.mock('@ui4a/db/presentation', () => ({
  getSidecarById: mocks.read,
  appendSidecarCommand: mocks.append,
}));
vi.mock('../../../../../engine/service', () => ({ getDb: () => ({}) }));
vi.mock('../../../../../auth/request-identity', () => ({ requestIdentityProfile: () => 'local' }));
vi.mock('../../../../../engine/presentation/sidecar-authorization', () => ({
  authorizeStoredSidecar: mocks.authorize,
}));
vi.mock('../../../../../engine/presentation/responsibility/coverage', () => ({
  storedResponsibilityCoverage: mocks.coverage,
}));

import { GET } from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({
    id: 'sidecar:a',
    activeVersion: 1,
    versions: { 1: { surface: {} } },
  });
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.coverage.mockResolvedValue(false);
});

describe('direct stored Surface responsibility boundary', () => {
  it('returns a replan conflict without disclosing an incomplete Surface or mutating events', async () => {
    const response = await GET(
      new Request('http://localhost/api/presentation/sidecar?sidecarId=sidecar:a'),
    );
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: {
        code: 'presentation-responsibility-stale',
        detail: 'Replan from the current authorized contract',
      },
    });
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it('preserves grant denials before responsibility reads', async () => {
    mocks.authorize.mockResolvedValue({ ok: false, reason: 'grants-shrunk' });
    const response = await GET(
      new Request('http://localhost/api/presentation/sidecar?sidecarId=sidecar:a'),
    );
    expect(response.status).toBe(403);
    expect(mocks.coverage).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      error: { code: 'sidecar-denied', detail: 'grants-shrunk' },
    });
  });
});
