import { metaActivationRel, metaFlowRel } from '@ui4a/shared';
import type {
  ActivationCheck,
  ActivationSnapshot,
  DefinitionDiff,
  EngineSnapshot,
  FlowDefinition,
} from '@ui4a/shared';

import { contentVersion } from '../sitemap';

export interface DefinitionCandidateAppliedDetail {
  schemaVersion: 1;
  commandId: string;
  name: string;
  baseVersion: number;
  version: number;
  activationId: string;
  draftId: string;
  draftVersion: number;
  payloadHash: string;
  policyScope: string;
  artifact: string;
  definition: FlowDefinition;
  checks: ActivationCheck[];
  diff?: DefinitionDiff;
  requestedBy: { actor: 'human' | 'agent'; principal?: string };
  decidedBy: { actor: 'human' | 'agent'; principal?: string };
}

/** Fold one already-authorized and fully validated candidate change set into Active definition truth. */
export function applyDefinitionCandidate(
  snapshot: EngineSnapshot,
  detail: DefinitionCandidateAppliedDetail,
): EngineSnapshot {
  if (detail.decidedBy.actor !== 'human') throw new Error('candidate approval must be human');
  const entry = snapshot.definitions?.[detail.name];
  if (entry === undefined) throw new Error(`candidate target ${detail.name} does not exist`);
  if (entry.version !== detail.baseVersion) {
    throw new Error(`candidate stale: base ${detail.baseVersion}, current ${entry.version}`);
  }
  if (detail.version !== detail.baseVersion + 1) throw new Error('candidate version is not next');
  if (detail.definition.name !== detail.name) throw new Error('candidate target/name mismatch');
  if (detail.checks.some((check) => !check.pass)) throw new Error('candidate checks did not pass');
  const lifecycle = snapshot.instances[metaFlowRel(detail.name)];
  if (lifecycle === undefined || lifecycle.node !== 'active') {
    throw new Error('candidate target lifecycle is not active');
  }
  const activation: ActivationSnapshot = {
    id: detail.activationId,
    flow: detail.name,
    status: 'approved',
    version: detail.version,
    artifact: contentVersion(detail.definition),
    checks: detail.checks,
    definition: detail.definition,
    ...(detail.diff === undefined ? {} : { diff: detail.diff }),
    requestedBy: detail.requestedBy,
    approvedBy: detail.decidedBy,
  };
  return {
    ...snapshot,
    definitions: {
      ...snapshot.definitions,
      [detail.name]: {
        ...entry,
        status: 'active',
        version: detail.version,
        definition: detail.definition,
      },
    },
    definitionVersions: {
      ...(snapshot.definitionVersions ?? {}),
      [detail.name]: {
        ...(snapshot.definitionVersions?.[detail.name] ?? {}),
        [detail.version]: detail.definition,
      },
    },
    activations: {
      ...(snapshot.activations ?? {}),
      [metaActivationRel(detail.activationId)]: activation,
    },
  };
}
