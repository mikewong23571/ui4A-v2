import { parseAgentDefinitionSource, resolveAgentDefinition } from '@ui4a/engine';
import type {
  AgentDefinitionRef,
  AgentDefinitionSource,
  FlattenedAgentDefinitionArtifact,
  JsonValue,
} from '@ui4a/shared';

import artifact from './agent-definitions.bundle.json';

interface InstalledAgentDefinition {
  source: AgentDefinitionSource;
  artifact: FlattenedAgentDefinitionArtifact;
  evaluation: JsonValue;
  policyScopes: readonly string[];
}

const definitions = new Map<
  AgentDefinitionRef,
  { status: 'active'; source: AgentDefinitionSource }
>();

/** Built-in definitions are ordered parent-first and resolved into immutable flattened artifacts. */
export const installedAgentDefinitions: readonly InstalledAgentDefinition[] =
  artifact.definitions.map((unknownSource) => {
    const source = parseAgentDefinitionSource(unknownSource);
    const resolved = resolveAgentDefinition(source, definitions);
    definitions.set(source.ref, { status: 'active', source });
    const evaluation = artifact.evaluation[source.ref as keyof typeof artifact.evaluation];
    if (evaluation === undefined) {
      throw new Error(`built-in Agent Definition ${source.ref} has no evaluation evidence`);
    }
    const policyScopes = artifact.policyScopes[source.ref as keyof typeof artifact.policyScopes];
    if (policyScopes === undefined || policyScopes.length === 0) {
      throw new Error(`built-in Agent Definition ${source.ref} has no policy scope`);
    }
    return {
      source,
      artifact: resolved,
      evaluation: JSON.parse(JSON.stringify(evaluation)) as JsonValue,
      policyScopes,
    };
  });
