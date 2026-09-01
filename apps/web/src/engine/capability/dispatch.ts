import type {
  CapabilityDefinition,
  FieldValue,
  NativeFunctionInvocationV1,
  NativeFunctionProfileV1,
} from '@ui4a/shared';
import {
  bindCapabilityInput,
  contentVersion,
  hashCanonicalAgentJson,
  type EngineEvent,
} from '@ui4a/engine';

interface CapabilityDispatchInput {
  event: EngineEvent;
  capability: CapabilityDefinition;
  principal: string;
  policyScope: string;
  actionParams: Record<string, unknown>;
  source: { rel: string; fields: Record<string, FieldValue> };
  artifacts: Record<string, { rel: string; value: unknown }>;
}

interface CapabilityArtifactLike {
  rel: string;
  source: { rel: string };
  content: unknown;
}

/** Resolve only action-referenced artifacts already owned by the source entity. */
export function selectAuthorizedCapabilityArtifacts(
  actionParams: Record<string, unknown>,
  artifacts: Readonly<Record<string, CapabilityArtifactLike>>,
  sourceRel: string,
): Record<string, { rel: string; value: unknown }> {
  return Object.fromEntries(
    Object.entries(actionParams).flatMap(([param, value]) => {
      if (typeof value !== 'string') return [];
      const artifact = artifacts[value];
      return artifact?.source.rel === sourceRel
        ? [[param, { rel: artifact.rel, value: artifact.content }] as const]
        : [];
    }),
  );
}

export interface PreparedNativeFunctionDispatch {
  event: EngineEvent;
  source: { rel: string; action: string; principal: string; policyScope: string };
  profile: NativeFunctionProfileV1;
  birth: NativeFunctionInvocationV1['birth'];
  callback: NativeFunctionInvocationV1['callback'];
  input: NativeFunctionInvocationV1['input'];
}

export type PreparedCapabilityDispatch<TAgent = unknown> =
  | { kind: 'agent'; prepared: TAgent }
  | { kind: 'native-function'; prepared: PreparedNativeFunctionDispatch };

interface CapabilityDispatchDeps<TAgent> {
  prepareAgent(input: CapabilityDispatchInput): Promise<TAgent>;
  nativeFunctionProfiles: ReadonlyMap<string, NativeFunctionProfileV1>;
}

function jsonContract(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} is required`);
  }
  return value as Record<string, unknown>;
}

function callbackAction(value: unknown, where: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${where} is required`);
  return value;
}

/** Select one server-owned executor class and finish every fail-before-append preflight. */
export async function prepareCapabilityDispatch<TAgent>(
  input: CapabilityDispatchInput,
  deps: CapabilityDispatchDeps<TAgent>,
): Promise<PreparedCapabilityDispatch<TAgent>> {
  const executor = input.capability.executor;
  if (executor === undefined)
    throw new Error(`capability ${input.capability.name} is not executable`);
  if (executor.class !== 'native-function') {
    if (executor.agentDefinition === undefined) {
      throw new Error(`executor class ${executor.class} is unsupported`);
    }
    return { kind: 'agent', prepared: await deps.prepareAgent(input) };
  }
  if (executor.agentDefinition !== undefined) {
    throw new Error('Native Function executor must not declare an Agent Definition');
  }
  const profile = deps.nativeFunctionProfiles.get(executor.profile);
  if (
    profile === undefined ||
    profile.executorClass !== executor.class ||
    profile.availability.status !== 'available'
  ) {
    throw new Error(`native function profile ${executor.profile} is unavailable`);
  }
  const inputSchema = jsonContract(input.capability.inputSchema, 'capability input schema');
  const outputSchema = jsonContract(input.capability.outputSchema, 'capability output schema');
  const bound = bindCapabilityInput({
    binding: input.event.bind,
    actionParams: input.actionParams,
    source: input.source,
    artifacts: input.artifacts,
    inputSchema,
    limits: {
      maxFields: 64,
      maxDepth: 16,
      maxNodes: 1024,
      maxBytes: profile.limits.inputBytes,
    },
  });
  const capabilityJson = JSON.parse(JSON.stringify(input.capability)) as Record<string, never>;
  return {
    kind: 'native-function',
    prepared: {
      event: input.event,
      source: {
        rel: input.event.rel,
        action: input.event.action,
        principal: input.principal,
        policyScope: input.policyScope,
      },
      profile,
      birth: {
        capability: {
          name: input.capability.name,
          hash: hashCanonicalAgentJson(capabilityJson),
        },
        profile: {
          ref: profile.ref,
          version: profile.version,
          handlerRef: profile.handlerRef,
          adapterVersion: profile.adapterVersion,
          limitsHash: hashCanonicalAgentJson({
            limits: profile.limits,
            network: profile.network,
          }),
        },
        inputContract: { hash: hashCanonicalAgentJson(inputSchema as never), schema: inputSchema },
        outputContract: {
          hash: hashCanonicalAgentJson(outputSchema as never),
          schema: outputSchema,
        },
      },
      callback: {
        onDoneAction: callbackAction(input.event['on-done'], 'on-done callback'),
        onErrorAction: callbackAction(input.event['on-error'], 'on-error callback'),
      },
      input: bound,
    },
  };
}

export function nativeFunctionExecutionIdentity(
  sourceSeq: number,
  prepared: PreparedNativeFunctionDispatch,
): { executionId: string; workflowId: string } {
  if (!Number.isSafeInteger(sourceSeq) || sourceSeq <= 0) throw new Error('source seq is invalid');
  const suffix = contentVersion({
    sourceSeq,
    capability: prepared.birth.capability,
    profile: prepared.birth.profile,
    inputHash: prepared.input.hash,
  });
  const executionId = `nf-${sourceSeq.toString(36)}-${suffix}`;
  return { executionId, workflowId: `function-${executionId}` };
}

export function preparedNativeFunctionDetail(prepared: PreparedNativeFunctionDispatch) {
  return {
    profile: prepared.profile,
    birth: prepared.birth,
    callback: prepared.callback,
    input: prepared.input,
    profileLimits: prepared.profile.limits,
    source: prepared.source,
  };
}

export function nativeFunctionInvocation(
  sourceSeq: number,
  prepared: PreparedNativeFunctionDispatch,
): NativeFunctionInvocationV1 {
  return {
    schemaVersion: 1,
    source: {
      eventId: `core:${sourceSeq}`,
      ...prepared.source,
    },
    birth: prepared.birth,
    callback: prepared.callback,
    input: prepared.input,
  };
}

export interface NativeFunctionStartInput {
  executionId: string;
  workflowId: string;
  invocation: NativeFunctionInvocationV1;
  profile: NativeFunctionProfileV1;
}

interface NativeFunctionStartDeps {
  start(input: NativeFunctionStartInput): Promise<void>;
}

export async function startNativeFunctionDispatch(
  prepared: PreparedNativeFunctionDispatch,
  sourceSeq: number,
  deps: NativeFunctionStartDeps,
) {
  const identity = nativeFunctionExecutionIdentity(sourceSeq, prepared);
  await deps.start({
    ...identity,
    invocation: nativeFunctionInvocation(sourceSeq, prepared),
    profile: prepared.profile,
  });
  return identity;
}

export async function reconcileNativeFunctionSpawns(input: {
  spawns: Array<{ seq: number; prepared: PreparedNativeFunctionDispatch }>;
  finalizedExecutionIds: ReadonlySet<string>;
  start: NativeFunctionStartDeps['start'];
}): Promise<{ started: string[] }> {
  const started: string[] = [];
  const seen = new Set<string>();
  for (const spawn of input.spawns) {
    const identity = nativeFunctionExecutionIdentity(spawn.seq, spawn.prepared);
    if (input.finalizedExecutionIds.has(identity.executionId) || seen.has(identity.executionId)) {
      continue;
    }
    await startNativeFunctionDispatch(spawn.prepared, spawn.seq, { start: input.start });
    seen.add(identity.executionId);
    started.push(identity.executionId);
  }
  return { started };
}
