import { compileSpecializedPrompt, type CompiledSpecializedPrompt } from '@ui4a/agent';
import Ajv from 'ajv';
import {
  contentVersion,
  hashCanonicalAgentJson,
  resolveAgentRuntimeProfile,
  type AgentRun,
  type AgentRunBirthReferences,
  type AgentRunJson,
  type AgentRuntimeProfile,
  type AgentTaskEnvelope,
} from '@ui4a/engine';
import {
  AGENT_AUTHORING_LIMITS,
  AGENT_AUTHORING_SCHEMA_VERSION,
  assertAgentAuthoringBrief,
  assertWritingBrief,
  WRITING_AGENT_LIMITS,
  WRITING_AGENT_SCHEMA_VERSION,
  type CapabilityDefinition,
  type CodingTask,
} from '@ui4a/shared';

import { getAgentDefinitionVersion, readAgentDefinitionRegistry } from '../db/agent-definitions';
import { appendAgentRunCommand, type ConnectableDb } from '../db/agent-runs';
import { dispatchAgentRun } from '../temporal/agent-run';
import {
  agentAuthoringProfileFromEnvironment,
  authoringProfileAsAgentRuntime,
  codingProfileAsAgentRuntime,
  documentAgentProfileFromEnvironment,
  documentProfileAsAgentRuntime,
} from './agent-runtime-config';
import { agentRegistryConfigurationFromEnvironment } from './agent-definitions';
import {
  codingExecutorProfileFromEnvironment,
  codingTaskFromCapabilityParams,
} from './capability-runs';

const MAX_SUSPENSIONS = 8;

interface NativeSpecializationTaskMapping {
  runtimeProfile: AgentRuntimeProfile;
  promptInput: AgentRunJson;
}

interface NativeSpecializationTaskMapper {
  definitionRef: string;
  runtimeClass: string;
  map(
    profileName: string,
    params: Record<string, unknown>,
    context: { db: ConnectableDb; principal: string; policyScope: string },
  ): NativeSpecializationTaskMapping | Promise<NativeSpecializationTaskMapping>;
}

function stringParam(params: Record<string, unknown>, name: string): string {
  const value = params[name];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value;
}

function stringListParam(params: Record<string, unknown>, name: string): string[] {
  const value = params[name];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${name} must be a string array`);
  }
  return [...value];
}

const nativeSpecializationTaskMappers: readonly NativeSpecializationTaskMapper[] = [
  {
    definitionRef: 'coding-agent@1',
    runtimeClass: 'coding-agent',
    map: (profileName, params) => {
      const deployed = codingExecutorProfileFromEnvironment(profileName);
      const codingTask: CodingTask = codingTaskFromCapabilityParams(params, deployed);
      return {
        runtimeProfile: codingProfileAsAgentRuntime(deployed),
        promptInput: asRunJson({ kind: 'coding-task', codingTask }),
      };
    },
  },
  {
    definitionRef: 'writing-agent@1',
    runtimeClass: 'document-agent',
    map: (profileName, params) => {
      const deployed = documentAgentProfileFromEnvironment(profileName);
      const writingBrief = assertWritingBrief({
        schemaVersion: WRITING_AGENT_SCHEMA_VERSION,
        objective: stringParam(params, 'objective'),
        audience: stringParam(params, 'audience'),
        format: 'markdown',
        requiredSections: stringListParam(params, 'requiredSections'),
        constraints: stringListParam(params, 'constraints'),
        allowedOutputPaths: ['out/document.md'],
        sources: params.sources,
        citationPolicy: {
          style: 'paragraph-markers',
          requireEveryFactualParagraph: true,
        },
        budget: {
          timeoutSeconds: deployed.timeoutSeconds,
          maxTurns: deployed.maxTurns,
          maxRawEvents: WRITING_AGENT_LIMITS.maxRawEvents,
          maxRawBytes: WRITING_AGENT_LIMITS.maxRawBytes,
          maxRawChunkBytes: WRITING_AGENT_LIMITS.maxRawChunkBytes,
        },
      });
      return {
        runtimeProfile: documentProfileAsAgentRuntime(deployed),
        promptInput: asRunJson({ kind: 'writing-task', writingBrief }),
      };
    },
  },
  {
    definitionRef: 'agent-definition-author@1',
    runtimeClass: 'agent-definition-authoring',
    map: async (profileName, params, context) => {
      const deployed = agentAuthoringProfileFromEnvironment(profileName);
      const [registry, configuration] = await Promise.all([
        readAgentDefinitionRegistry(context.db, context.principal, context.policyScope),
        Promise.resolve(agentRegistryConfigurationFromEnvironment()),
      ]);
      const baseDefinitions = [...registry.activeByName.values()]
        .map((ref) => registry.definitions.get(ref)?.source)
        .filter((source): source is NonNullable<typeof source> => source !== undefined);
      const authoringBrief = assertAgentAuthoringBrief({
        schemaVersion: AGENT_AUTHORING_SCHEMA_VERSION,
        description: stringParam(params, 'description'),
        constraints: [
          'Return a Draft proposal only.',
          'Do not request approval, activation, Provider overrides, or undeclared resources.',
        ],
        registry: {
          runtimeClasses: [...configuration.activationRegistries.runtimeClasses].map(
            ([name, features]) => ({ name, features: [...features] }),
          ),
          tools: [...configuration.activationRegistries.tools],
          resources: [...configuration.activationRegistries.resources],
          contextSources: [...configuration.activationRegistries.contextSources],
          verifiers: [...configuration.activationRegistries.verifiers],
          baseDefinitions,
        },
        budget: {
          timeoutSeconds: deployed.timeoutSeconds,
          maxTurns: deployed.maxTurns,
          maxRawEvents: AGENT_AUTHORING_LIMITS.maxRawEvents,
          maxRawBytes: AGENT_AUTHORING_LIMITS.maxRawBytes,
          maxRawChunkBytes: AGENT_AUTHORING_LIMITS.maxRawChunkBytes,
        },
      });
      return {
        runtimeProfile: authoringProfileAsAgentRuntime(deployed),
        promptInput: asRunJson({
          kind: 'agent-definition-authoring-task',
          authoringBrief,
        }),
      };
    },
  },
] as const;

function specializationTaskMapper(definitionRef: string, runtimeClass: string) {
  const matches = nativeSpecializationTaskMappers.filter(
    (mapper) => mapper.definitionRef === definitionRef && mapper.runtimeClass === runtimeClass,
  );
  if (matches.length !== 1) {
    throw new Error(
      `no exact task mapper for Agent Definition ${definitionRef} and runtime class ${runtimeClass}`,
    );
  }
  return matches[0]!;
}

export interface PreparedNativeAgentDispatch {
  capabilityName: string;
  definitionRef: string;
  profileName: string;
  birth: AgentRunBirthReferences;
  task: AgentTaskEnvelope;
  compiledPrompt: CompiledSpecializedPrompt;
}

function asRunJson(value: unknown): AgentRunJson {
  return JSON.parse(JSON.stringify(value)) as AgentRunJson;
}

function contractRef(definitionRef: string, kind: 'input' | 'output', schema: unknown) {
  return {
    ref: `${definitionRef}:${kind}`,
    hash: hashCanonicalAgentJson(schema as AgentRunJson),
  };
}

/**
 * Resolve every server-owned birth input before the source business event is appended.
 *
 * This compatibility bridge deliberately recognizes no capability name. The activated exact
 * Agent Definition supplies specialization semantics while the existing T18 capability parameters
 * are converted into the first native task contract.
 */
export async function prepareNativeAgentDispatch(
  db: ConnectableDb,
  input: {
    principal: string;
    policyScope: string;
    params: Record<string, unknown>;
    capability: CapabilityDefinition;
  },
): Promise<PreparedNativeAgentDispatch> {
  const executor = input.capability.executor;
  if (executor?.agentDefinition === undefined) {
    throw new Error(`capability ${input.capability.name} has no Agent Definition`);
  }
  const view = await getAgentDefinitionVersion(
    db,
    executor.agentDefinition,
    input.principal,
    input.policyScope,
  );
  if (view === undefined || view.version.status !== 'active') {
    throw new Error(`Agent Definition ${executor.agentDefinition} is not active in this scope`);
  }
  const runtimeClass = view.flattened.definition.runtimeRequirements.class;
  const mapping = await specializationTaskMapper(view.version.ref, runtimeClass).map(
    executor.profile,
    input.params,
    { db, principal: input.principal, policyScope: input.policyScope },
  );
  const runtimeProfile = mapping.runtimeProfile;
  const requiredFeatures = [
    ...new Set([
      ...view.flattened.definition.runtimeRequirements.features,
      ...(executor.requiredFeatures ?? []),
    ]),
  ];
  const resolution = resolveAgentRuntimeProfile({
    requirement: {
      runtimeClass,
      requiredFeatures,
      requiredTools: view.flattened.definition.policies.tools.allowed,
      requiredResourceBackends: view.flattened.definition.policies.resources.allowed,
    },
    policyProfile: { ref: executor.profile, version: 1 },
    profiles: [runtimeProfile],
  });
  if (!resolution.ok) throw new Error(resolution.reason);
  if (executor.class !== resolution.profile.runtimeClass) {
    throw new Error(
      `capability executor class ${executor.class} does not match Agent Definition runtime class ${resolution.profile.runtimeClass}`,
    );
  }

  const promptInput = mapping.promptInput;
  const compiledPrompt = compileSpecializedPrompt({
    definition: view.flattened.definition,
    task: promptInput,
    context: {},
    policy: {},
  });
  const taskContract = contractRef(
    view.version.ref,
    'input',
    view.flattened.definition.contracts.inputSchema,
  );
  const resultContract = contractRef(
    view.version.ref,
    'output',
    view.flattened.definition.contracts.outputSchema,
  );
  const taskPayload = asRunJson({
    ...(promptInput as Record<string, AgentRunJson>),
    compiledPrompt: {
      messages: compiledPrompt.messages,
      compiledHash: compiledPrompt.compiledHash,
    },
  });
  const validateTask = new Ajv({ allErrors: true, strict: false }).compile(
    view.flattened.definition.contracts.inputSchema,
  );
  if (!validateTask(taskPayload)) {
    const detail = (validateTask.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
      .join('; ');
    throw new Error(`Agent task contract rejected compiled payload: ${detail}`);
  }
  const task: AgentTaskEnvelope = {
    schemaVersion: 1,
    contract: taskContract,
    payload: taskPayload,
  };
  return {
    capabilityName: input.capability.name,
    definitionRef: view.version.ref,
    profileName: resolution.profile.ref,
    compiledPrompt,
    birth: {
      schemaVersion: 1,
      kind: 'event-native',
      definition: {
        ref: view.version.name,
        version: view.version.version,
        sourceHash: view.version.content.source,
        parentHashes:
          view.flattened.derivedFrom === undefined
            ? []
            : [view.flattened.derivedFrom.flattenedHash],
        flattenedHash: view.version.flattenedHash,
      },
      prompt: {
        templateHash: view.version.content.template,
        compiledHash: compiledPrompt.compiledHash,
      },
      runtime: {
        profileName: resolution.provenance.profileRef,
        profileVersion: String(resolution.provenance.profileVersion),
        adapterVersion: resolution.provenance.providerAdapterRef,
      },
      taskContract,
      resultContract,
    },
    task,
  };
}

/** Persist one native Run and dispatch the generic Temporal Host under a stable source identity. */
export async function createAndDispatchAgentRun(
  db: ConnectableDb,
  input: {
    prepared: PreparedNativeAgentDispatch;
    sourceSeq: number;
    sourceRel: string;
    sourceAction: string;
    principal: string;
    policyScope: string;
    onDoneAction?: string;
    onErrorAction?: string;
  },
): Promise<AgentRun> {
  const runId = `a${input.sourceSeq.toString(36)}-${contentVersion({
    source: input.sourceRel,
    definition: input.prepared.definitionRef,
  })}`;
  const source = {
    rel: input.sourceRel,
    action: input.sourceAction,
    eventId: `core:${input.sourceSeq}`,
    ...(input.onDoneAction === undefined ? {} : { onDoneAction: input.onDoneAction }),
    ...(input.onErrorAction === undefined ? {} : { onErrorAction: input.onErrorAction }),
  };
  const created = await appendAgentRunCommand(db, {
    kind: 'create',
    runId,
    commandId: `create:${runId}`,
    eventId: `event:create:${runId}`,
    principal: input.principal,
    policyScope: input.policyScope,
    source,
    birth: input.prepared.birth,
    task: input.prepared.task,
  });
  try {
    await dispatchAgentRun({
      runId,
      principal: input.principal,
      policyScope: input.policyScope,
      source,
      birth: input.prepared.birth,
      task: input.prepared.task,
      limits: { maxSuspensions: MAX_SUSPENSIONS },
    });
    return created.aggregate;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return (
      await appendAgentRunCommand(db, {
        kind: 'fail',
        runId,
        expectedRevision: created.aggregate.revision,
        commandId: `dispatch-failed:${runId}`,
        eventId: `event:dispatch-failed:${runId}`,
        code: 'dispatch-failed',
        reason,
      })
    ).aggregate;
  }
}
