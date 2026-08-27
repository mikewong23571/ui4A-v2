import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SirenEntity, UserSidecarAggregate } from '@ui4a/engine';

const mocks = vi.hoisted(() => ({
  getAuthorizedPresentationEntity: vi.fn(),
}));

vi.mock('./authorized-entity', () => ({
  getAuthorizedPresentationEntity: mocks.getAuthorizedPresentationEntity,
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

describe('authorizeStoredSidecar granted-set semantics (D51)', () => {
  beforeEach(() => {
    mocks.getAuthorizedPresentationEntity.mockReset();
  });

  it('returns true when the principal matches and every source reauthorizes under the current grants', async () => {
    mocks.getAuthorizedPresentationEntity.mockResolvedValue(entityStub);
    const sidecar = fixtureSidecar();

    const authorized = await authorizeStoredSidecar(sidecar, {
      principal: 'human-alice',
      grantedApplications: ['publishing'],
    });

    expect(authorized).toBe(true);
    // 命中重审按当前授予集合逐源进行;stored key 已无 scope 维度。
    expect(mocks.getAuthorizedPresentationEntity).toHaveBeenCalledWith(
      'post:first-post',
      'human-alice',
      ['publishing'],
    );
  });

  it('returns false when the principal does not match, before any source read', async () => {
    mocks.getAuthorizedPresentationEntity.mockResolvedValue(entityStub);
    const sidecar = fixtureSidecar();

    const authorized = await authorizeStoredSidecar(sidecar, {
      principal: 'human-bob',
      grantedApplications: ['publishing'],
    });

    expect(authorized).toBe(false);
    expect(mocks.getAuthorizedPresentationEntity).not.toHaveBeenCalled();
  });

  it('returns false when a stored source fails reauthorization under the current grants', async () => {
    mocks.getAuthorizedPresentationEntity.mockResolvedValue(undefined);
    const sidecar = fixtureSidecar();

    const authorized = await authorizeStoredSidecar(sidecar, {
      principal: 'human-alice',
      grantedApplications: ['publishing'],
    });

    expect(authorized).toBe(false);
    expect(mocks.getAuthorizedPresentationEntity).toHaveBeenCalledWith(
      'post:first-post',
      'human-alice',
      ['publishing'],
    );
  });
});
