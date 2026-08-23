import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { decideWorkspaceLease, validateAllowedPath, validateRepositoryRef } from './index';

describe('workspace policy', () => {
  it.each(['/tmp/repo', '~/repo', '$HOME/repo', 'repo:../secret', 'repo:a/../../b', 'C:\\repo'])(
    'rejects path-like repository ref %s',
    (repositoryRef) => {
      expect(validateRepositoryRef(repositoryRef)).not.toEqual([]);
    },
  );

  it('rejects every generated traversal or absolute allowed path', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 30 }), (suffix) => {
        expect(validateAllowedPath(`../${suffix}`)).not.toEqual([]);
        expect(validateAllowedPath(`/${suffix}`)).not.toEqual([]);
      }),
    );
  });

  it('allows parallel same-base leases but rejects identity/branch/workspace collisions', () => {
    const input = {
      runId: 'run-2',
      repositoryRef: 'repo:fixture',
      baseRevision: 'a'.repeat(40),
      allowedPaths: ['src'],
      workspaceId: 'workspace:2',
      leaseId: 'lease:2',
      branch: 'ui4a/run-2',
    };
    const existing = [
      {
        runId: 'run-1',
        repositoryRef: 'repo:fixture',
        baseRevision: 'a'.repeat(40),
        workspaceId: 'workspace:1',
        leaseId: 'lease:1',
        branch: 'ui4a/run-1',
        status: 'active' as const,
      },
    ];
    expect(
      decideWorkspaceLease({
        candidate: input,
        registeredRepositoryRefs: ['repo:fixture'],
        existingLeases: existing,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      decideWorkspaceLease({
        candidate: { ...input, workspaceId: 'workspace:1' },
        registeredRepositoryRefs: ['repo:fixture'],
        existingLeases: existing,
      }),
    ).toMatchObject({ allowed: false, code: 'lease-collision' });
  });
});
