import {
  AGENT_DEFINITION_SCHEMA_VERSION,
  type AgentDefinition,
  type AgentDefinitionRef,
  type AgentDefinitionSource,
  type FlattenedAgentDefinitionArtifact,
  type JsonValue,
} from '@ui4a/shared';

import { hashCanonicalAgentJson, parseAgentDefinitionSource } from './parse';

export interface AgentDefinitionRegistryEntry {
  status: 'draft' | 'active' | 'deprecated';
  source: AgentDefinitionSource;
}

export type AgentDefinitionSourceRegistry = ReadonlyMap<
  AgentDefinitionRef,
  AgentDefinitionRegistryEntry
>;

export class AgentDefinitionDerivationError extends Error {
  constructor(
    readonly code:
      | 'missing-parent'
      | 'parent-not-active'
      | 'parent-ref-mismatch'
      | 'cycle'
      | 'duplicate-prompt-block',
    message: string,
    readonly path: AgentDefinitionRef[],
  ) {
    super(message);
    this.name = 'AgentDefinitionDerivationError';
  }
}

function artifactHash(
  definition: AgentDefinition,
  derivedFrom?: FlattenedAgentDefinitionArtifact['derivedFrom'],
) {
  return hashCanonicalAgentJson({
    schemaVersion: AGENT_DEFINITION_SCHEMA_VERSION,
    ref: definition.ref,
    ...(derivedFrom === undefined ? {} : { derivedFrom }),
    definition,
  } as unknown as JsonValue);
}

/**
 * Resolve one exact-version source against active exact parents and flatten it once.
 * The returned artifact has no mutable parent lookup requirement at execution time.
 */
export function resolveAgentDefinition(
  candidate: AgentDefinitionSource,
  registry: AgentDefinitionSourceRegistry,
): FlattenedAgentDefinitionArtifact {
  const parsedCandidate = parseAgentDefinitionSource(candidate);
  const memo = new Map<AgentDefinitionRef, FlattenedAgentDefinitionArtifact>();
  const visit = (
    source: AgentDefinitionSource,
    stack: AgentDefinitionRef[],
  ): FlattenedAgentDefinitionArtifact => {
    const parsed = parseAgentDefinitionSource(source);
    const cached = memo.get(parsed.ref);
    if (cached !== undefined) return cached;
    const cycleAt = stack.indexOf(parsed.ref);
    if (cycleAt >= 0) {
      const cycle = [...stack.slice(cycleAt), parsed.ref];
      throw new AgentDefinitionDerivationError(
        'cycle',
        `agent definition derivation cycle: ${cycle.join(' -> ')}`,
        cycle,
      );
    }
    if (!('extends' in parsed)) {
      const artifact: FlattenedAgentDefinitionArtifact = {
        schemaVersion: AGENT_DEFINITION_SCHEMA_VERSION,
        ref: parsed.ref,
        source: parsed,
        definition: parsed,
        flattenedHash: artifactHash(parsed),
      };
      memo.set(parsed.ref, artifact);
      return artifact;
    }
    const parentEntry = registry.get(parsed.extends);
    if (parentEntry === undefined) {
      throw new AgentDefinitionDerivationError(
        'missing-parent',
        `agent definition parent ${parsed.extends} is missing`,
        [...stack, parsed.ref, parsed.extends],
      );
    }
    if (parentEntry.status !== 'active') {
      throw new AgentDefinitionDerivationError(
        'parent-not-active',
        `agent definition parent ${parsed.extends} is not active`,
        [...stack, parsed.ref, parsed.extends],
      );
    }
    const parsedParent = parseAgentDefinitionSource(parentEntry.source);
    if (parsedParent.ref !== parsed.extends) {
      throw new AgentDefinitionDerivationError(
        'parent-ref-mismatch',
        `agent definition registry key ${parsed.extends} contains ${parsedParent.ref}`,
        [...stack, parsed.ref, parsed.extends],
      );
    }
    const parent = visit(parsedParent, [...stack, parsed.ref]);
    const inheritedIds = new Set(parent.definition.prompt.blocks.map((block) => block.id));
    const duplicate = parsed.specialize.appendPromptBlocks.find((block) =>
      inheritedIds.has(block.id),
    );
    if (duplicate !== undefined) {
      throw new AgentDefinitionDerivationError(
        'duplicate-prompt-block',
        `prompt block "${duplicate.id}" already exists in ${parent.ref}`,
        [...stack, parsed.ref, parent.ref],
      );
    }
    const definition = parseAgentDefinitionSource({
      ...parent.definition,
      ...parsed.specialize.replace,
      ref: parsed.ref,
      name: parsed.name,
      version: parsed.version,
      prompt: {
        ...parent.definition.prompt,
        blocks: [...parent.definition.prompt.blocks, ...parsed.specialize.appendPromptBlocks],
      },
    });
    if ('extends' in definition)
      throw new Error('internal error: flattened definition remained derived');
    const derivedFrom = { ref: parent.ref, flattenedHash: parent.flattenedHash };
    const artifact: FlattenedAgentDefinitionArtifact = {
      schemaVersion: AGENT_DEFINITION_SCHEMA_VERSION,
      ref: definition.ref,
      source: parsed,
      derivedFrom,
      definition,
      flattenedHash: artifactHash(definition, derivedFrom),
    };
    memo.set(parsed.ref, artifact);
    return artifact;
  };
  return visit(parsedCandidate, []);
}

/** Resolve a candidate from its exact registry ref; floating active pointers are never accepted. */
export function resolveRegisteredAgentDefinition(
  ref: AgentDefinitionRef,
  registry: AgentDefinitionSourceRegistry,
): FlattenedAgentDefinitionArtifact {
  const entry = registry.get(ref);
  if (entry === undefined) {
    throw new AgentDefinitionDerivationError(
      'missing-parent',
      `agent definition ${ref} is missing`,
      [ref],
    );
  }
  const source = parseAgentDefinitionSource(entry.source);
  if (source.ref !== ref) {
    throw new AgentDefinitionDerivationError(
      'parent-ref-mismatch',
      `agent definition registry key ${ref} contains ${source.ref}`,
      [ref],
    );
  }
  return resolveAgentDefinition(source, registry);
}
