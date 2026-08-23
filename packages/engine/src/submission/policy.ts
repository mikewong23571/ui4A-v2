import type {
  SubmissionPolicy,
  SubmissionPolicyDecision,
  SubmissionPolicyLayer,
  SubmissionMode,
} from '@ui4a/shared';

export interface SubmissionPolicyContext {
  actor: 'human' | 'agent' | 'system';
  scope?: string;
  writable: boolean;
  resource?: SubmissionPolicy;
  entity?: SubmissionPolicy;
  action?: SubmissionPolicy;
  /** Untrusted request data; retained only so tests can prove it has no authority. */
  requestMode?: SubmissionMode;
}

export interface DirectPolicyEvidence {
  declaredAction?: boolean;
  hasSchema?: boolean;
  hasAuthorization?: boolean;
  risk?: 'low' | 'medium' | 'high';
}

/** Validate invariants that make an explicit direct policy governable. */
export function validateSubmissionPolicy(
  policy: SubmissionPolicy,
  evidence: DirectPolicyEvidence,
): string[] {
  if (policy.mode !== 'direct') return [];
  const issues: string[] = [];
  if (evidence.declaredAction !== true) issues.push('direct requires a declared action');
  if (evidence.hasSchema !== true) issues.push('direct requires an input schema');
  if (evidence.hasAuthorization !== true) issues.push('direct requires authorization evidence');
  if (evidence.risk !== 'low') issues.push('direct is restricted to low-risk actions');
  return issues;
}

/**
 * Resolve activated policy layers. `none` is absorbing; otherwise the most specific declared layer
 * wins. The request-side mode is deliberately ignored.
 */
export function resolveSubmissionPolicy(
  context: SubmissionPolicyContext,
): SubmissionPolicyDecision {
  const evidence: SubmissionPolicyLayer[] = [];
  for (const [source, policy] of [
    ['resource', context.resource],
    ['entity', context.entity],
    ['action', context.action],
  ] as const) {
    if (policy !== undefined) evidence.push({ source, policy: { ...policy } });
  }
  if (evidence.length === 0) {
    evidence.push({
      source: context.writable ? 'writable-default' : 'derived-default',
      policy: { mode: context.writable ? 'draft' : 'none' },
    });
  }
  const none = evidence.find((layer) => layer.policy.mode === 'none');
  const policy = none?.policy ?? evidence[evidence.length - 1]!.policy;
  const actorAllowed = policy.actors === undefined || policy.actors.includes(context.actor);
  const scopeAllowed =
    policy.scopes === undefined ||
    (context.scope !== undefined && policy.scopes.includes(context.scope));
  const allowed = policy.mode !== 'none' && actorAllowed && scopeAllowed;
  const reason =
    policy.mode === 'none'
      ? (policy.reason ?? 'submission is disabled for this derived or read-only resource')
      : !actorAllowed
        ? `actor ${context.actor} is outside the submission policy`
        : !scopeAllowed
          ? `scope ${context.scope ?? '<missing>'} is outside the submission policy`
          : `submission mode ${policy.mode}`;
  return { policy: { ...policy }, evidence, allowed, reason };
}

