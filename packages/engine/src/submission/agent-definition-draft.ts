import { detailedDiff } from 'deep-object-diff';

import type {
  AgentDefinition,
  AgentDefinitionSource,
  DraftValidation,
  FlattenedAgentDefinitionArtifact,
} from '@ui4a/shared';

import type {
  AgentDefinitionActivationCheck,
  AgentDefinitionActivationRegistries,
} from '../agent-definition/invariants';
import type { AgentDefinitionSourceRegistry } from '../agent-definition/derive';
import { validateAgentDefinitionActivation } from '../agent-definition/invariants';
import { parseAgentDefinitionSource } from '../agent-definition/parse';
import { payloadFingerprint } from './draft';

export interface AgentDefinitionDraftContext {
  definitions: AgentDefinitionSourceRegistry;
  activationRegistries: AgentDefinitionActivationRegistries;
}

export interface AgentDefinitionDraftValidation extends DraftValidation {
  value?: AgentDefinitionSource;
  artifact?: FlattenedAgentDefinitionArtifact;
  checks?: AgentDefinitionActivationCheck[];
}

export interface MechanicalJsonDiff<T> {
  algorithm: 'deep-object-diff';
  before: T | null;
  after: T;
  changed: {
    added: Record<string, unknown>;
    deleted: Record<string, unknown>;
    updated: Record<string, unknown>;
  };
}

export interface MechanicalAgentDefinitionDiff {
  authored: MechanicalJsonDiff<AgentDefinitionSource>;
  effective: MechanicalJsonDiff<AgentDefinition>;
  hash: string;
}

function mechanicalJsonDiff<T>(before: T | undefined, after: T): MechanicalJsonDiff<T> {
  const normalizedBefore = before ?? null;
  const { added, deleted, updated } = detailedDiff((before ?? {}) as object, after as object);
  return {
    algorithm: 'deep-object-diff',
    before: normalizedBefore,
    after,
    changed: {
      added: added as Record<string, unknown>,
      deleted: deleted as Record<string, unknown>,
      updated: updated as Record<string, unknown>,
    },
  };
}

/** Parse and validate an Agent Definition candidate without mutating the active registry. */
export function validateAgentDefinitionDraft(
  payload: unknown,
  context: AgentDefinitionDraftContext,
): AgentDefinitionDraftValidation {
  let value: AgentDefinitionSource;
  try {
    value = parseAgentDefinitionSource(payload);
  } catch (error) {
    return {
      valid: false,
      issues: [
        {
          code: 'parse-error',
          path: '/',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  const definitions = new Map(context.definitions);
  // The candidate is active only in this disposable validation view. This lets self-cycles be
  // diagnosed as cycles while the durable active pointer remains untouched.
  definitions.set(value.ref, { status: 'active', source: value });
  const report = validateAgentDefinitionActivation(
    value.ref,
    definitions,
    context.activationRegistries,
  );
  const issues = report.checks.flatMap((check) =>
    check.pass
      ? []
      : (check.detail ?? [check.name]).map((message) => ({
          code: check.name,
          path: '/',
          message,
          evidence: check,
        })),
  );
  return {
    valid: report.pass,
    issues,
    value,
    ...(report.artifact === undefined ? {} : { artifact: report.artifact }),
    checks: report.checks,
    ...(report.artifact === undefined ? {} : { validatedAgainst: report.artifact.flattenedHash }),
  };
}

/** Mechanical authored-source and flattened-effective diff; no model participates. */
export function mechanicalAgentDefinitionDiff(input: {
  beforeSource?: AgentDefinitionSource;
  afterSource: AgentDefinitionSource;
  beforeEffective?: AgentDefinition;
  afterEffective: AgentDefinition;
}): MechanicalAgentDefinitionDiff {
  const authored = mechanicalJsonDiff(input.beforeSource, input.afterSource);
  const effective = mechanicalJsonDiff(input.beforeEffective, input.afterEffective);
  return { authored, effective, hash: payloadFingerprint({ authored, effective }) };
}
