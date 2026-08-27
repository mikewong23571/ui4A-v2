import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SirenEntity, UserSidecarAggregate } from '@ui4a/engine';

const mocks = vi.hoisted(() => ({
  getAuthorizedPresentationResult: vi.fn(),
}));

vi.mock('./authorized-entity', () => ({
  getAuthorizedPresentationResult: mocks.getAuthorizedPresentationResult,
}));

import { authorizeStoredSidecar } from './sidecar-authorization';

function fixtureSidecar(principal = 'human-alice'): UserSidecarAggregate {
  return {
    id: 'sidecar:unit',
    key: { principal, subject: 'post:first-post', intent: 'read', deviceClass: 'any' },
    versions: {
      1: {
        version: 1,
        basedOnVersion: null,
        retention: 'cache',
        surface: {
          schemaVersion: 1,
          root: {
            kind: 'layout',
            id: 'root',
            role: 'primary-content',
            layout: 'stack',
            dependencies: [],
            provenance: [{ kind: 'generic-fallback', ref: 'fixture' }],
            children: [],
          },
        },
        dependencies: [
          {
            id: 'entity:post:first-post',
            subtreeId: 'root',
            kind: 'entity-contract',
            ref: 'post:first-post',
            pointers: ['$contract'],
            mode: 'invalidate',
            fingerprint: 'fixture',
            optional: false,
          },
        ],
        provenance: { kind: 'generic-fallback', ref: 'fixture' },
        changedPaths: [],
      },
    },
    activeVersion: 1,
    maxVersion: 1,
  };
}

const entityStub = {} as SirenEntity;

describe('authorizeStoredSidecar granted-set semantics (D51/B3)', () => {
  beforeEach(() => {
    mocks.getAuthorizedPresentationResult.mockReset();
  });

  it('authorizes when the principal matches and every source reauthorizes under the current grants', async () => {
    mocks.getAuthorizedPresentationResult.mockResolvedValue({
      kind: 'authorized',
      entity: entityStub,
    });
    const sidecar = fixtureSidecar();

    const decision = await authorizeStoredSidecar(sidecar, {
      principal: 'human-alice',
      grantedApplications: ['publishing'],
    });

    expect(decision).toEqual({ ok: true });
    // 命中重审按当前授予集合逐源进行;stored key 已无 scope 维度。
    expect(mocks.getAuthorizedPresentationResult).toHaveBeenCalledWith(
      'post:first-post',
      'human-alice',
      ['publishing'],
    );
  });

  it('denies when the principal does not match, before any source read', async () => {
    mocks.getAuthorizedPresentationResult.mockResolvedValue({
      kind: 'authorized',
      entity: entityStub,
    });
    const sidecar = fixtureSidecar();

    const decision = await authorizeStoredSidecar(sidecar, {
      principal: 'human-bob',
      grantedApplications: ['publishing'],
    });

    expect(decision).toEqual({ ok: false, reason: 'sources-unreachable' });
    expect(mocks.getAuthorizedPresentationResult).not.toHaveBeenCalled();
  });

  it('attributes a grant-envelope shrink to grants-shrunk', async () => {
    // 安全边界:source 实体归属的应用不再授予(受众谓词失败)→ grants-shrunk。
    mocks.getAuthorizedPresentationResult.mockResolvedValue({ kind: 'audience-unreachable' });
    const sidecar = fixtureSidecar();

    await expect(
      authorizeStoredSidecar(sidecar, {
        principal: 'human-alice',
        grantedApplications: ['community'],
      }),
    ).resolves.toEqual({ ok: false, reason: 'grants-shrunk' });
  });

  it('attributes an unavailable source to sources-unreachable', async () => {
    mocks.getAuthorizedPresentationResult.mockResolvedValue({ kind: 'subject-unavailable' });
    const sidecar = fixtureSidecar();

    await expect(
      authorizeStoredSidecar(sidecar, {
        principal: 'human-alice',
        grantedApplications: ['publishing'],
      }),
    ).resolves.toEqual({ ok: false, reason: 'sources-unreachable' });
    expect(mocks.getAuthorizedPresentationResult).toHaveBeenCalledWith(
      'post:first-post',
      'human-alice',
      ['publishing'],
    );
  });
});
