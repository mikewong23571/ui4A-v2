import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SirenEntity, UserSidecarAggregate } from '@ui4a/engine';

const mocks = vi.hoisted(() => ({
  getAuthorizedPresentationEntity: vi.fn(),
}));

vi.mock('./authorized-entity', () => ({
  getAuthorizedPresentationEntity: mocks.getAuthorizedPresentationEntity,
}));

import { authorizeStoredSidecar } from './sidecar-authorization';

function fixtureSidecar(policyScope: string, principal = 'human-alice'): UserSidecarAggregate {
  return {
    id: 'sidecar:unit',
    key: { principal, policyScope, subject: 'post:first-post', intent: 'read', deviceClass: 'any' },
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

describe('authorizeStoredSidecar granted-scope semantics', () => {
  beforeEach(() => {
    mocks.getAuthorizedPresentationEntity.mockReset();
  });

  it('returns false when the stored policy scope is not in the granted set', async () => {
    mocks.getAuthorizedPresentationEntity.mockResolvedValue(entityStub);
    const sidecar = fixtureSidecar('publishing');

    const authorized = await authorizeStoredSidecar(sidecar, {
      principal: 'human-alice',
      grantedPolicyScopes: ['default'],
    });

    expect(authorized).toBe(false);
    expect(mocks.getAuthorizedPresentationEntity).not.toHaveBeenCalled();
  });

  it('returns true when the stored scope is granted and every source reauthorizes in that scope', async () => {
    mocks.getAuthorizedPresentationEntity.mockResolvedValue(entityStub);
    const sidecar = fixtureSidecar('publishing');

    const authorized = await authorizeStoredSidecar(sidecar, {
      principal: 'human-alice',
      grantedPolicyScopes: ['default', 'publishing'],
    });

    expect(authorized).toBe(true);
    // 源码重授权按 stored key 的 scope 进行(不等于请求冻结 scope 时也能正确重审)。
    expect(mocks.getAuthorizedPresentationEntity).toHaveBeenCalledWith(
      'post:first-post',
      'human-alice',
      'publishing',
    );
  });

  it('returns false when the principal does not match, even if the scope is granted', async () => {
    mocks.getAuthorizedPresentationEntity.mockResolvedValue(entityStub);
    const sidecar = fixtureSidecar('publishing');

    const authorized = await authorizeStoredSidecar(sidecar, {
      principal: 'human-bob',
      grantedPolicyScopes: ['publishing'],
    });

    expect(authorized).toBe(false);
    expect(mocks.getAuthorizedPresentationEntity).not.toHaveBeenCalled();
  });

  it('returns false when a stored source fails reauthorization in the stored scope', async () => {
    mocks.getAuthorizedPresentationEntity.mockResolvedValue(undefined);
    const sidecar = fixtureSidecar('publishing');

    const authorized = await authorizeStoredSidecar(sidecar, {
      principal: 'human-alice',
      grantedPolicyScopes: ['publishing'],
    });

    expect(authorized).toBe(false);
    expect(mocks.getAuthorizedPresentationEntity).toHaveBeenCalledWith(
      'post:first-post',
      'human-alice',
      'publishing',
    );
  });
});
