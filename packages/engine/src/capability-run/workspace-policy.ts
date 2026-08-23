export interface WorkspaceLeaseCandidate {
  runId: string;
  repositoryRef: string;
  baseRevision: string;
  allowedPaths: string[];
  workspaceId: string;
  leaseId: string;
  branch: string;
}

export interface WorkspaceLeaseRecord {
  runId: string;
  repositoryRef: string;
  baseRevision: string;
  workspaceId: string;
  leaseId: string;
  branch: string;
  status: 'active' | 'retained' | 'released';
}

export interface WorkspaceLeaseDecisionInput {
  candidate: WorkspaceLeaseCandidate;
  registeredRepositoryRefs: readonly string[];
  existingLeases: readonly WorkspaceLeaseRecord[];
}

export type WorkspaceLeaseDecision =
  | { allowed: true; candidate: WorkspaceLeaseCandidate }
  | {
      allowed: false;
      code:
        | 'repository-ref-invalid'
        | 'repository-not-registered'
        | 'base-revision-invalid'
        | 'allowed-path-invalid'
        | 'lease-collision';
      reason: string;
    };

const STABLE_REF = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._/-]*$/;
const REVISION = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Return policy violations for a stable repository identifier, never a host path. */
export function validateRepositoryRef(repositoryRef: string): string[] {
  const issues: string[] = [];
  if (!STABLE_REF.test(repositoryRef))
    issues.push('repositoryRef must be a stable namespaced identifier');
  if (
    repositoryRef.startsWith('/') ||
    repositoryRef.startsWith('~') ||
    repositoryRef.includes('\\') ||
    repositoryRef.includes('$') ||
    repositoryRef.includes('%') ||
    repositoryRef.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    issues.push('repositoryRef must not contain a host path or expansion');
  }
  return issues;
}

/** Return policy violations for a repository-relative POSIX path. */
export function validateAllowedPath(path: string): string[] {
  const issues: string[] = [];
  if (path === '' || path === '.') issues.push('allowed path must identify a repository child');
  if (path.startsWith('/') || path.startsWith('~') || /^[A-Za-z]:/.test(path)) {
    issues.push('allowed path must be relative');
  }
  if (
    path.includes('\\') ||
    path.includes('\0') ||
    path.includes('$') ||
    path.includes('%') ||
    path.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    issues.push('allowed path contains traversal or expansion syntax');
  }
  return issues;
}

/** Validate one server-created lease candidate while allowing parallel leases on the same base. */
export function decideWorkspaceLease(input: WorkspaceLeaseDecisionInput): WorkspaceLeaseDecision {
  const refIssues = validateRepositoryRef(input.candidate.repositoryRef);
  if (refIssues.length > 0) {
    return { allowed: false, code: 'repository-ref-invalid', reason: refIssues.join('; ') };
  }
  if (!input.registeredRepositoryRefs.includes(input.candidate.repositoryRef)) {
    return {
      allowed: false,
      code: 'repository-not-registered',
      reason: `repository ${input.candidate.repositoryRef} is not registered`,
    };
  }
  if (!REVISION.test(input.candidate.baseRevision)) {
    return {
      allowed: false,
      code: 'base-revision-invalid',
      reason: 'base revision must be a full lowercase Git object id',
    };
  }
  const invalidPath = input.candidate.allowedPaths.find(
    (path) => validateAllowedPath(path).length > 0,
  );
  if (input.candidate.allowedPaths.length === 0 || invalidPath !== undefined) {
    return {
      allowed: false,
      code: 'allowed-path-invalid',
      reason:
        invalidPath === undefined
          ? 'at least one allowed path is required'
          : `invalid allowed path ${invalidPath}`,
    };
  }
  const collision = input.existingLeases.find(
    (lease) =>
      lease.status !== 'released' &&
      (lease.runId === input.candidate.runId ||
        lease.workspaceId === input.candidate.workspaceId ||
        lease.leaseId === input.candidate.leaseId ||
        lease.branch === input.candidate.branch),
  );
  if (collision !== undefined) {
    return {
      allowed: false,
      code: 'lease-collision',
      reason: `workspace lease collides with run ${collision.runId}`,
    };
  }
  return {
    allowed: true,
    candidate: { ...input.candidate, allowedPaths: [...input.candidate.allowedPaths] },
  };
}
