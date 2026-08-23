/** Server-owned write-ingress policy. Requests may describe intent but never select this mode. */
export type SubmissionMode = 'draft' | 'direct' | 'none';

export interface SubmissionPolicy {
  mode: SubmissionMode;
  actors?: ('human' | 'agent' | 'system')[];
  scopes?: string[];
  reason?: string;
}

export interface SubmissionPolicyLayer {
  source: 'resource' | 'entity' | 'action' | 'derived-default' | 'writable-default';
  policy: SubmissionPolicy;
}

export interface SubmissionPolicyDecision {
  policy: SubmissionPolicy;
  evidence: SubmissionPolicyLayer[];
  allowed: boolean;
  reason: string;
}

export type DraftKind =
  'entity-create' | 'entity-patch' | 'application-bundle' | 'flow-definition' | 'agent-definition';

export type DraftStatus =
  | 'editing'
  | 'invalid'
  | 'ready'
  | 'pending-approval'
  | 'accepted'
  | 'rejected'
  | 'stale'
  | 'abandoned'
  | 'expired';

export interface DraftValidationIssue {
  code: string;
  path: string;
  message: string;
  evidence?: unknown;
}

export interface DraftValidation {
  valid: boolean;
  issues: DraftValidationIssue[];
  validatedAgainst?: string;
}

export interface DraftProvenance {
  actor: 'agent' | 'human';
  principal: string;
  agent?: string;
  model?: string;
  commandId: string;
  sources: string[];
}

export interface DraftVersion {
  version: number;
  basedOnVersion: number | null;
  payloadHash: string;
  schemaRef: string;
  provenance: DraftProvenance;
  validation: DraftValidation;
  createdAt?: string;
}

export interface DraftAggregate {
  id: string;
  owner: string;
  policyScope: string;
  kind: DraftKind;
  target?: string;
  baseVersion?: string;
  status: DraftStatus;
  versions: Record<number, DraftVersion>;
  activeVersion: number;
  maxVersion: number;
  activation?: string;
  terminalReason?: string;
  expiresAt?: string;
}

export const DRAFT_LIMITS = {
  maxPayloadBytes: 256 * 1024,
  maxDepth: 32,
  maxNodes: 20_000,
  maxVersions: 32,
  maxActivePerScope: 20,
  maxScopeBytes: 16 * 1024 * 1024,
  retentionDays: 30,
} as const;
