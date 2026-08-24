import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { ProductionDeploymentSettings } from '@ui4a/shared';

import type {
  AgentCollectedResult,
  AgentExecuteActivityArgs,
  AgentExecutionCompleted,
  AgentExecutionResult,
  AgentFinalizeInput,
  AgentPreparedResult,
  AgentRunWorkflowArgs,
  AgentVerificationResult,
} from '../agents/host/contracts';

type RuntimeSpecialization = 'coding' | 'writing' | 'authoring';
type RuntimeBackend = 'kubernetes-job' | 'trusted-host';

interface CompiledGenericTransportRequest {
  schemaVersion: 1;
  compiledHash: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  outputSchema: unknown;
  sandboxMode: 'read-only' | 'workspace-write';
}

interface GenericTransportEnvelope {
  schemaVersion: 1;
  runId: string;
  specialization: RuntimeSpecialization;
  birth: AgentRunWorkflowArgs['birth'];
  request: CompiledGenericTransportRequest;
  execution: {
    profileId: string;
    backend: RuntimeBackend;
    runnerId?: string;
    image: string;
    workspace: { rootRef: string };
    resources: { cpu: string; memory: string; timeoutMs: number };
    networkPolicy: 'restricted';
    credentialRefs: string[];
  };
}

interface GenericTransportResult {
  schemaVersion: 1;
  runId: string;
  birth: AgentRunWorkflowArgs['birth'];
  nativeSessionId: string;
  result: unknown;
  events: unknown[];
}

interface ProductionTransportPort {
  kind: RuntimeBackend;
  execute(input: {
    envelope: GenericTransportEnvelope;
    signal: AbortSignal;
    reportProgress(cursor: string | null, event: unknown): void;
  }): Promise<GenericTransportResult>;
}

interface ProductionSpecializationPort {
  taskKind: string;
  prepare(context: AgentRunWorkflowArgs): Promise<AgentPreparedResult>;
  compile(input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
  }): Promise<CompiledGenericTransportRequest>;
  accept(input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
    result: GenericTransportResult;
  }): Promise<AgentExecutionResult>;
  collect(input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
    execution: AgentExecutionCompleted;
  }): Promise<AgentCollectedResult>;
  verify(input: {
    context: AgentRunWorkflowArgs;
    collected: AgentCollectedResult;
  }): Promise<AgentVerificationResult> | AgentVerificationResult;
  finalize(input: AgentFinalizeInput): Promise<void>;
}

interface ProductionAgentRunActivities {
  prepareAgentRun(context: AgentRunWorkflowArgs): Promise<AgentPreparedResult>;
  executeAgentRun(
    input: AgentExecuteActivityArgs,
    controls?: {
      signal: AbortSignal;
      reportProgress(cursor: string | null, event: unknown): void;
    },
  ): Promise<AgentExecutionResult>;
  collectAgentRun(input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
    execution: AgentExecutionCompleted;
  }): Promise<AgentCollectedResult>;
  verifyAgentRun(input: {
    context: AgentRunWorkflowArgs;
    collected: AgentCollectedResult;
  }): Promise<AgentVerificationResult>;
  finalizeAgentRun(input: AgentFinalizeInput): Promise<void>;
}

interface ProductionWiringModule {
  createProductionAgentRunActivities(input: {
    runtime: ProductionDeploymentSettings['runtime'];
    runnerArtifactImage: string;
    transports: Partial<Record<RuntimeBackend, ProductionTransportPort>>;
    specializations: Record<RuntimeSpecialization, ProductionSpecializationPort>;
  }): ProductionAgentRunActivities;
}

const repositoryRoot = resolve(import.meta.dirname, '../../../..');
const plannedModulePath = 'apps/worker/src/runtime-backends/production-wiring.ts';
const activitiesPath = 'apps/worker/src/activities.ts';
const runnerImage = `registry.internal/ui4a/agent-runner@sha256:${'a'.repeat(64)}`;
const hashes = {
  definition: `sha256:${'1'.repeat(64)}`,
  flattened: `sha256:${'2'.repeat(64)}`,
  prompt: `sha256:${'3'.repeat(64)}`,
  compiled: `sha256:${'4'.repeat(64)}`,
  task: `sha256:${'5'.repeat(64)}`,
  result: `sha256:${'6'.repeat(64)}`,
} as const;

async function plannedApi(): Promise<ProductionWiringModule> {
  const absolutePath = resolve(repositoryRoot, plannedModulePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`planned production Agent Runtime wiring is missing: ${plannedModulePath}`);
  }
  return import(pathToFileURL(absolutePath).href) as Promise<ProductionWiringModule>;
}

function runtimeSettings(): ProductionDeploymentSettings['runtime'] {
  return {
    defaultProfiles: {
      coding: 'coding-k8s',
      writing: 'writing-compose-host',
      authoring: 'authoring-k8s',
    },
    profiles: [
      {
        id: 'coding-k8s',
        specialization: 'coding',
        backend: 'kubernetes',
        image: runnerImage,
        workspaceRoot: '/workspaces/coding',
        timeoutSeconds: 900,
        resources: { cpu: '1', memory: '2Gi' },
        networkPolicy: 'restricted',
        credentialRefs: ['coding-provider-credential'],
      },
      {
        id: 'writing-compose-host',
        specialization: 'writing',
        backend: 'host',
        runnerId: 'compose-runner',
        runnerTokenRef: 'compose-runner-token',
        workspaceRoot: '/workspaces/writing',
        timeoutSeconds: 600,
        resources: { cpu: '1', memory: '1Gi' },
        networkPolicy: 'restricted',
        credentialRefs: ['writing-provider-credential'],
      },
      {
        id: 'authoring-k8s',
        specialization: 'authoring',
        backend: 'kubernetes',
        image: runnerImage,
        workspaceRoot: '/workspaces/authoring',
        timeoutSeconds: 300,
        resources: { cpu: '500m', memory: '512Mi' },
        networkPolicy: 'restricted',
        credentialRefs: ['authoring-provider-credential'],
      },
    ],
    repositories: [
      { ref: 'ui4a', root: '/srv/repos/ui4a', allowedPaths: ['apps', 'packages', 'docs'] },
    ],
  };
}

function context(): AgentRunWorkflowArgs {
  return {
    runId: 'agent-run:production-writing-42',
    principal: 'user:production-42',
    policyScope: 'editorial',
    source: {
      rel: 'writing-request:42',
      action: 'compose',
      eventId: 'event:writing-request:42',
    },
    birth: {
      schemaVersion: 1,
      kind: 'event-native',
      definition: {
        ref: 'editorial-writer',
        version: 1,
        sourceHash: hashes.definition,
        parentHashes: [],
        flattenedHash: hashes.flattened,
      },
      prompt: { templateHash: hashes.prompt, compiledHash: hashes.compiled },
      runtime: {
        profileName: 'writing-compose-host',
        profileVersion: '1',
        adapterVersion: 'document-agent-runtime@1',
      },
      taskContract: { ref: 'writing-task@1', hash: hashes.task },
      resultContract: { ref: 'writing-result@1', hash: hashes.result },
    },
    task: {
      schemaVersion: 1,
      contract: 'writing-task@1',
      taskId: 'writing-task:42',
      payload: {
        kind: 'writing-task',
        briefRef: 'artifact:brief-42',
      },
      context: [{ ref: 'artifact:source-42', hash: hashes.task }],
    },
    limits: { maxSuspensions: 2 },
  } as unknown as AgentRunWorkflowArgs;
}

function compiledRequest(): CompiledGenericTransportRequest {
  return {
    schemaVersion: 1,
    compiledHash: hashes.compiled,
    messages: [
      { role: 'system', content: 'Operate only within the sealed transport grants.' },
      { role: 'user', content: '{"briefRef":"artifact:brief-42"}' },
    ],
    outputSchema: {
      type: 'object',
      required: ['status', 'summary'],
      additionalProperties: false,
    },
    sandboxMode: 'workspace-write',
  };
}

function expectedTransportEnvelope(): GenericTransportEnvelope {
  return {
    schemaVersion: 1,
    runId: context().runId,
    specialization: 'writing',
    birth: context().birth,
    request: compiledRequest(),
    execution: {
      profileId: 'writing-compose-host',
      backend: 'trusted-host',
      runnerId: 'compose-runner',
      image: runnerImage,
      workspace: { rootRef: '/workspaces/writing' },
      resources: { cpu: '1', memory: '1Gi', timeoutMs: 600_000 },
      networkPolicy: 'restricted',
      credentialRefs: ['writing-provider-credential'],
    },
  };
}

function transportResult(): GenericTransportResult {
  return {
    schemaVersion: 1,
    runId: context().runId,
    birth: context().birth,
    nativeSessionId: 'codex-session:writing-42',
    result: { status: 'completed', summary: 'Bounded document produced.' },
    events: [{ kind: 'message-received', cursor: '1' }],
  };
}

function specializationFixture(order: string[]) {
  const prepared: AgentPreparedResult = {
    state: { kind: 'writing-agent-prepared', workspaceRef: 'workspace:writing-42' },
  };
  const completed: AgentExecutionCompleted = {
    status: 'completed',
    state: {
      kind: 'writing-agent-completed',
      nativeSessionId: 'codex-session:writing-42',
      claim: { status: 'completed', summary: 'Bounded document produced.' },
    },
    handle: { sessionRef: 'codex-session:writing-42', detail: {} },
  };
  const candidate = {
    schemaVersion: 1,
    contract: 'writing-result@1',
    resultId: 'writing-result:42',
    payload: { summary: 'Independently collected and verified.' },
    artifacts: [],
    evidence: [],
    proposedEffects: [],
  } as unknown as AgentCollectedResult['candidate'];

  return {
    port: {
      taskKind: 'writing-task',
      prepare: vi.fn(async () => {
        order.push('prepare');
        return prepared;
      }),
      compile: vi.fn(async () => {
        order.push('compile');
        return compiledRequest();
      }),
      accept: vi.fn(async ({ result }: { result: GenericTransportResult }) => {
        order.push('accept');
        expect(result).toEqual(transportResult());
        return completed;
      }),
      collect: vi.fn(async () => {
        order.push('collect');
        return { candidate };
      }),
      verify: vi.fn(async () => {
        order.push('verify');
        return { status: 'succeeded' as const, result: candidate };
      }),
      finalize: vi.fn(async () => {
        order.push('finalize');
      }),
    } satisfies ProductionSpecializationPort,
    prepared,
    completed,
    candidate,
  };
}

function unavailableSpecialization(): ProductionSpecializationPort {
  return {
    taskKind: 'unselected-task',
    prepare: vi.fn(async () => ({ state: null })),
    compile: vi.fn(async () => compiledRequest()),
    accept: vi.fn(async () => ({
      status: 'failed' as const,
      code: 'unexpected',
      reason: 'unexpected',
    })),
    collect: vi.fn(async () => {
      throw new Error('unexpected collect');
    }),
    verify: vi.fn(() => ({
      status: 'failed' as const,
      code: 'unexpected',
      reason: 'unexpected',
    })),
    finalize: vi.fn(async () => undefined),
  };
}

describe('T22 production Agent Runtime activity wiring', () => {
  it('is wired from the production activities module rather than remaining a test-only helper', () => {
    const source = readFileSync(resolve(repositoryRoot, activitiesPath), 'utf8');
    const wiringPath = resolve(repositoryRoot, plannedModulePath);
    const wiringSource = existsSync(wiringPath) ? readFileSync(wiringPath, 'utf8') : '';

    expect(source).toContain("from './runtime-backends/production-wiring'");
    expect(source).toMatch(/createProductionAgentRunActivities/);
    expect(`${source}\n${wiringSource}`).toMatch(/createHttpRunnerExecutionPort/);
    expect(source).toMatch(/createInClusterKubernetesRuntimeTransportFromEnvironment/);
    expect(source).toMatch(/'kubernetes-job': kubernetesTransport/);
    expect(source).toMatch(
      /export async function executeAgentRun[\s\S]{0,500}productionAgentRunActivities[\s\S]{0,200}executeAgentRun/,
    );
  });

  it('executes only compiled generic transport and returns to Worker collect, verify, and finalize', async () => {
    const { createProductionAgentRunActivities } = await plannedApi();
    const order: string[] = [];
    const writing = specializationFixture(order);
    const progress: Array<{ cursor: string | null; event: unknown }> = [];
    const hostTransport: ProductionTransportPort = {
      kind: 'trusted-host',
      execute: vi.fn(async ({ envelope, reportProgress }) => {
        order.push('transport');
        expect(envelope).toEqual(expectedTransportEnvelope());
        const serialized = JSON.stringify(envelope);
        expect(serialized).not.toContain('"payload":');
        expect(serialized).not.toMatch(/"provider"|"model"|"cwd"|"env"/);
        expect(serialized).not.toContain('compose-runner-token');
        reportProgress('1', { kind: 'message-received' });
        return transportResult();
      }),
    };
    const activities = createProductionAgentRunActivities({
      runtime: runtimeSettings(),
      runnerArtifactImage: runnerImage,
      transports: { 'trusted-host': hostTransport },
      specializations: {
        coding: unavailableSpecialization(),
        writing: writing.port,
        authoring: unavailableSpecialization(),
      },
    });
    const runContext = context();
    const prepared = await activities.prepareAgentRun(runContext);
    const execution = await activities.executeAgentRun(
      { context: runContext, prepared },
      {
        signal: new AbortController().signal,
        reportProgress: (cursor, event) => progress.push({ cursor, event }),
      },
    );
    expect(execution).toEqual(writing.completed);
    const collected = await activities.collectAgentRun({
      context: runContext,
      prepared,
      execution: execution as AgentExecutionCompleted,
    });
    const verified = await activities.verifyAgentRun({ context: runContext, collected });
    await activities.finalizeAgentRun({
      context: runContext,
      outcome: verified,
      idempotencyKey: `agent-run-finalize:${runContext.runId}`,
    });

    expect(order).toEqual([
      'prepare',
      'compile',
      'transport',
      'accept',
      'collect',
      'verify',
      'finalize',
    ]);
    expect(progress).toEqual([{ cursor: '1', event: { kind: 'message-received' } }]);
    expect(writing.port.compile).toHaveBeenCalledWith({ context: runContext, prepared });
    expect(writing.port.collect).toHaveBeenCalledOnce();
    expect(writing.port.verify).toHaveBeenCalledOnce();
    expect(writing.port.finalize).toHaveBeenCalledOnce();
  });

  it.each(['backend', 'provider', 'model', 'cwd', 'env'] as const)(
    'rejects request-selected %s before compilation or transport',
    async (field) => {
      const { createProductionAgentRunActivities } = await plannedApi();
      const writing = specializationFixture([]);
      const hostTransport: ProductionTransportPort = {
        kind: 'trusted-host',
        execute: vi.fn(async () => transportResult()),
      };
      const activities = createProductionAgentRunActivities({
        runtime: runtimeSettings(),
        runnerArtifactImage: runnerImage,
        transports: { 'trusted-host': hostTransport },
        specializations: {
          coding: unavailableSpecialization(),
          writing: writing.port,
          authoring: unavailableSpecialization(),
        },
      });
      const injected = context();
      Object.assign(injected.task.payload as Record<string, unknown>, { [field]: 'attacker' });

      await expect(
        activities.executeAgentRun({ context: injected, prepared: writing.prepared }),
      ).rejects.toThrow(`runtime_request_forbidden_field:${field}`);
      expect(writing.port.compile).not.toHaveBeenCalled();
      expect(hostTransport.execute).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the selected Host transport is unavailable and never falls back to K8s', async () => {
    const { createProductionAgentRunActivities } = await plannedApi();
    const writing = specializationFixture([]);
    const k8sTransport: ProductionTransportPort = {
      kind: 'kubernetes-job',
      execute: vi.fn(async () => transportResult()),
    };
    const activities = createProductionAgentRunActivities({
      runtime: runtimeSettings(),
      runnerArtifactImage: runnerImage,
      transports: { 'kubernetes-job': k8sTransport },
      specializations: {
        coding: unavailableSpecialization(),
        writing: writing.port,
        authoring: unavailableSpecialization(),
      },
    });

    await expect(
      activities.executeAgentRun({ context: context(), prepared: writing.prepared }),
    ).rejects.toThrow('runtime_backend_unavailable:trusted-host');
    expect(k8sTransport.execute).not.toHaveBeenCalled();
    expect(writing.port.accept).not.toHaveBeenCalled();
    expect(writing.port.collect).not.toHaveBeenCalled();
    expect(writing.port.verify).not.toHaveBeenCalled();
    expect(writing.port.finalize).not.toHaveBeenCalled();
  });

  it('rejects a transport result for another Run before specialization acceptance', async () => {
    const { createProductionAgentRunActivities } = await plannedApi();
    const writing = specializationFixture([]);
    const hostTransport: ProductionTransportPort = {
      kind: 'trusted-host',
      execute: vi.fn(async () => ({ ...transportResult(), runId: 'agent-run:foreign' })),
    };
    const activities = createProductionAgentRunActivities({
      runtime: runtimeSettings(),
      runnerArtifactImage: runnerImage,
      transports: { 'trusted-host': hostTransport },
      specializations: {
        coding: unavailableSpecialization(),
        writing: writing.port,
        authoring: unavailableSpecialization(),
      },
    });

    await expect(
      activities.executeAgentRun({ context: context(), prepared: writing.prepared }),
    ).rejects.toThrow('runtime_transport_result_scope_mismatch');
    expect(writing.port.accept).not.toHaveBeenCalled();
  });
});
