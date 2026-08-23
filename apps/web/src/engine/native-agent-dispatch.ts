import { compileSpecializedPrompt, type CompiledSpecializedPrompt } from '@ui4a/agent';
import Ajv from 'ajv';
import {
  contentVersion,
  hashCanonicalAgentJson,
  resolveAgentRuntimeProfile,
  type AgentRun,
  type AgentRunBirthReferences,
  type AgentRunJson,
  type AgentTaskEnvelope,
} from '@ui4a/engine';
import type { CapabilityDefinition, CodingTask } from '@ui4a/shared';

import { getAgentDefinitionVersion } from '../db/agent-definitions';
import { appendAgentRunCommand, type ConnectableDb } from '../db/agent-runs';
import { dispatchAgentRun } from '../temporal/agent-run';
import { codingProfileAsAgentRuntime } from './agent-runtime-config';
import {
  codingExecutorProfileFromEnvironment,
  codingTaskFromCapabilityParams,
} from './capability-runs';

const MAX_SUSPENSIONS = 8;

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
  const codingProfile = codingExecutorProfileFromEnvironment(executor.profile);
  const runtimeProfile = codingProfileAsAgentRuntime(codingProfile);
  const requiredFeatures = [
    ...new Set([
      ...view.flattened.definition.runtimeRequirements.features,
      ...(executor.requiredFeatures ?? []),
    ]),
  ];
  const resolution = resolveAgentRuntimeProfile({
    requirement: {
      runtimeClass: view.flattened.definition.runtimeRequirements.class,
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

  const codingTask: CodingTask = codingTaskFromCapabilityParams(input.params, codingProfile);
  const promptInput = { kind: 'coding-task', codingTask };
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
    ...promptInput,
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
