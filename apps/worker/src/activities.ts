/**
 * notify activity(T3 Phase C):第一个 capability 的落地。
 *
 * 效果动词"触达"(arch-brief §3):向人类送达确认门通知。T3 的物理信道是
 * 事件日志 + 收件箱投影(Web Push/SMTP 后续切片叠加);因此 activity 的全部
 * 职责 = 向**同一 PG 事件日志**追加 `notification-delivered` 事件
 * (spec 架构决定 4 双写者方案:worker 直接 appendEvent,web 读路径按 seq
 * 增量 fold 看见)。
 *
 * 幂等方案(activity 层检查,报告口径):
 * - Temporal workflowId(`notify-<id>`)防并发重复派发;
 * - activity 内先查同 rel 的 notification-delivered 是否已存在,存在即跳过
 *   (重试/重跑不双写);fold 对重复送达事件同样幂等(engine fold 分支)。
 *
 * 存储层复用 web 的 append-only event adapter；schema 由显式 migration command 安装，
 * 跨 app 相对引用——事件日志是共享底座,不属于任何平面,arch-brief §1)。
 */
import { createHash } from 'node:crypto';

import type { DbExecutor } from '../../web/src/db/events';
import { appendEvent } from '../../web/src/db/events';
import { appendAgentRunCommand, getAgentRun } from '../../web/src/db/agent-runs';

import {
  createBoundedBearerFetch,
  createProductionAgentTokenProvider,
  resolveLlmConfig,
  type AgentDriver,
  type FetchLike,
  type ProductionAgentTokenProvider,
  type SitemapSummary,
} from '@ui4a/agent';
import { canonicalJson } from '@ui4a/engine';
import type { CodingNormalizedEvent, ProductionDeploymentConfig } from '@ui4a/shared';

import {
  fetchSitemap,
  recordDelegationFinish,
  recordDelegationStart,
  runAgentStep,
} from './delegation';
import type {
  AgentStepArgs,
  AgentStepResult,
  DelegationFinishArgs,
  DelegationStartArgs,
} from './workflows';
import type { NotifyConfirmation } from './workflows';
import type {
  CodexExecutionDeps,
  CodexExecutionInput,
  CodexExecutionOutput,
  CodexTaskClaim,
} from './capabilities/coding/codex';
import {
  collectAgentAuthoringRunWithDeps,
  executeAgentAuthoringRunWithDeps,
  finalizeAgentAuthoringRunWithDeps,
  parseAgentAuthoringProfiles,
  prepareAgentAuthoringRunWithDeps,
  verifyAgentAuthoringRun,
  type AgentAuthoringAdapterDeps,
} from './agents/authoring';
import {
  collectCodingAgentRunWithDeps,
  executeCodingAgentRunWithDeps,
  finalizeCodingAgentRunWithDeps,
  prepareCodingAgentRunWithDeps,
  verifyCodingAgentRun,
  type CodingAgentAdapterDeps,
} from './agents/coding';
import {
  collectWritingAgentRunWithDeps,
  executeWritingAgentRunWithDeps,
  finalizeWritingAgentRunWithDeps,
  parseDocumentAgentProfiles,
  prepareWritingAgentRunWithDeps,
  verifyWritingAgentRun,
  writingPreparedWorkspaceRoot,
  type WritingAgentAdapterDeps,
} from './agents/writing';
import { composeProductionWritingAgent } from './agents/writing/production';
import type {
  AgentCollectedResult,
  AgentExecuteActivityArgs,
  AgentExecutionResult,
  AgentFinalizeInput,
  AgentPreparedResult,
  AgentResolutionRecord,
  AgentRunWorkflowArgs,
  AgentSuspensionRecord,
  AgentVerificationResult,
} from './agents/host/contracts';
import {
  serializeCodexMessages,
  type CodexStructuredDeps,
  type CodexStructuredInput,
  type CodexStructuredOutput,
  type CodexTransportProgress,
} from './agents/host/codex-transport';
import {
  createHttpRunnerExecutionPortForCompiledTransport,
  createProductionAgentRunActivities,
  executeCompiledRuntimeTransport,
  type CompiledRuntimeTransportRequest,
  type CompiledRuntimeTransportResult,
  type ProductionRuntimeSpecializationPort,
} from './runtime-backends/production-wiring';
import { createInClusterKubernetesRuntimeTransportFromEnvironment } from './runtime-backends/kubernetes-runtime-transport';
import { runWorkerProductionDeploymentPreflight } from './production-deployment-preflight';
import { workerDb } from './worker-db';

export { workerDb } from './worker-db';

/** activity 注册表(workflow 经 proxyActivities 按名调用)。 */
export interface NotifyActivities {
  notify(confirmation: NotifyConfirmation): Promise<{ seq: number; deduplicated: boolean }>;
}

/** notification-delivered 事件的 detail 载荷:inbox 条目数据(Phase D 收件箱渲染输入)。 */
export interface NotificationDeliveredDetail {
  /** 通知去重键(spec:notificationId = `notif:<confirmation.id>`)。 */
  notificationId: string;
  /** 确认摘要(提议者/目标/策略原因——人类在推送上做决定所需的全部信息)。 */
  confirmation: NotifyConfirmation;
}

/** 幂等键:事件表无业务唯一约束,按 (kind, rel) 精确匹配已送达通知。 */
function findEvent(db: DbExecutor, kind: string, rel: string): Promise<number | null> {
  return db
    .query<{ seq: string | number }>(
      'SELECT seq FROM events WHERE kind = $1 AND rel = $2 LIMIT 1',
      [kind, rel],
    )
    .then((result) => ((result.rowCount ?? 0) > 0 ? Number(result.rows[0]!.seq) : null));
}

function findDelivered(db: DbExecutor, rel: string): Promise<number | null> {
  return findEvent(db, 'notification-delivered', rel);
}

/**
 * 送达核心(db 注入,单测用假 DbExecutor):
 * 写 notification-delivered(rel=confirmation:<id>,detail 含 inbox 条目数据);
 * 已送达则跳过(deduplicated=true)。Worker 启动前必须已完成显式 migration。
 */
export async function deliverNotification(
  db: DbExecutor,
  confirmation: NotifyConfirmation,
): Promise<{ seq: number; deduplicated: boolean }> {
  const rel = `confirmation:${confirmation.id}`;
  const existing = await findDelivered(db, rel);
  if (existing !== null) {
    return { seq: existing, deduplicated: true };
  }
  const detail: NotificationDeliveredDetail = {
    notificationId: `notif:${confirmation.id}`,
    confirmation,
  };
  const appended = await appendEvent(db, {
    kind: 'notification-delivered',
    rel,
    actor: confirmation.proposedBy.actor,
    principal: confirmation.proposedBy.principal,
    channel: 'notify',
    detail,
  });
  return { seq: appended.seq, deduplicated: false };
}

/** Temporal activity 入口(注册名 notify);委托 deliverNotification。 */
export async function notify(
  confirmation: NotifyConfirmation,
): Promise<{ seq: number; deduplicated: boolean }> {
  return deliverNotification(workerDb(), confirmation);
}

// ---------------------------------------------------------------------------
// Generic Agent Host activities (T19)
// ---------------------------------------------------------------------------

function codingAgentAdapterDeps(): CodingAgentAdapterDeps {
  const repositoryRegistry = process.env.UI4A_CODING_REPOSITORIES;
  const workspaceRoot = process.env.UI4A_CODING_WORKSPACE_ROOT;
  const profiles = process.env.UI4A_CODING_EXECUTOR_PROFILES;
  if (repositoryRegistry === undefined || workspaceRoot === undefined || profiles === undefined) {
    throw new Error(
      'coding agent requires UI4A_CODING_REPOSITORIES, UI4A_CODING_WORKSPACE_ROOT and UI4A_CODING_EXECUTOR_PROFILES',
    );
  }
  const parsed = JSON.parse(profiles) as unknown;
  if (!Array.isArray(parsed)) throw new Error('coding executor profiles must be an array');
  return {
    db: workerDb(),
    repositoryRegistry,
    workspaceRoot,
    profiles: parsed as CodingAgentAdapterDeps['profiles'],
    callbackBaseUrl: process.env.UI4A_PUBLIC_BASE_URL,
    callbackToken: process.env.UI4A_CAPABILITY_CALLBACK_TOKEN,
  };
}

function writingAgentAdapterDeps(): WritingAgentAdapterDeps {
  const workspaceRoot = process.env.UI4A_DOCUMENT_WORKSPACE_ROOT;
  const profiles = process.env.UI4A_DOCUMENT_AGENT_PROFILES;
  if (workspaceRoot === undefined || profiles === undefined) {
    throw new Error(
      'writing-agent requires UI4A_DOCUMENT_WORKSPACE_ROOT and UI4A_DOCUMENT_AGENT_PROFILES',
    );
  }
  return {
    db: workerDb(),
    workspaceRoot,
    profiles: parseDocumentAgentProfiles(profiles),
    callbackBaseUrl: process.env.UI4A_PUBLIC_BASE_URL,
    callbackToken: process.env.UI4A_CAPABILITY_CALLBACK_TOKEN,
  };
}

function agentAuthoringAdapterDeps(): AgentAuthoringAdapterDeps {
  const runtimeRoot = process.env.UI4A_AGENT_AUTHORING_RUNTIME_ROOT;
  const profiles = process.env.UI4A_AGENT_AUTHORING_PROFILES;
  if (runtimeRoot === undefined || profiles === undefined) {
    throw new Error(
      'Agent authoring requires UI4A_AGENT_AUTHORING_RUNTIME_ROOT and UI4A_AGENT_AUTHORING_PROFILES',
    );
  }
  return {
    db: workerDb(),
    runtimeRoot,
    profiles: parseAgentAuthoringProfiles(profiles),
    callbackBaseUrl: process.env.UI4A_PUBLIC_BASE_URL,
    callbackToken: process.env.UI4A_CAPABILITY_CALLBACK_TOKEN,
  };
}

function agentTaskKind(context: AgentRunWorkflowArgs): string | undefined {
  const payload = context.task.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  return typeof payload.kind === 'string' ? payload.kind : undefined;
}

export type AgentSpecializationAdapter = 'coding' | 'writing' | 'authoring';

type AgentCollectActivityArgs = Parameters<typeof collectCodingAgentRunWithDeps>[0];
type AgentVerifyActivityArgs = Parameters<typeof verifyCodingAgentRun>[0];

interface AgentSpecializationBinding {
  name: AgentSpecializationAdapter;
  taskKind: string;
  prepare(args: AgentRunWorkflowArgs): Promise<AgentPreparedResult>;
  execute(args: AgentExecuteActivityArgs): Promise<AgentExecutionResult>;
  collect(args: AgentCollectActivityArgs): Promise<AgentCollectedResult>;
  verify(args: AgentVerifyActivityArgs): AgentVerificationResult;
  finalize(input: AgentFinalizeInput): Promise<void>;
}

/** Composition registry: adding a specialization contributes one adapter object, not Host branches. */
const agentSpecializationBindings: readonly AgentSpecializationBinding[] = [
  {
    name: 'coding',
    taskKind: 'coding-task',
    prepare: (args) => prepareCodingAgentRunWithDeps(args, codingAgentAdapterDeps()),
    execute: (args) => executeCodingAgentRunWithDeps(args, codingAgentAdapterDeps()),
    collect: (args) => collectCodingAgentRunWithDeps(args, codingAgentAdapterDeps()),
    verify: verifyCodingAgentRun,
    finalize: (input) => finalizeCodingAgentRunWithDeps(input, codingAgentAdapterDeps()),
  },
  {
    name: 'writing',
    taskKind: 'writing-task',
    prepare: (args) => prepareWritingAgentRunWithDeps(args, writingAgentAdapterDeps()),
    execute: (args) => executeWritingAgentRunWithDeps(args, writingAgentAdapterDeps()),
    collect: (args) => collectWritingAgentRunWithDeps(args, writingAgentAdapterDeps()),
    verify: verifyWritingAgentRun,
    finalize: (input) => finalizeWritingAgentRunWithDeps(input, writingAgentAdapterDeps()),
  },
  {
    name: 'authoring',
    taskKind: 'agent-definition-authoring-task',
    prepare: (args) => prepareAgentAuthoringRunWithDeps(args, agentAuthoringAdapterDeps()),
    execute: (args) => executeAgentAuthoringRunWithDeps(args, agentAuthoringAdapterDeps()),
    collect: (args) => collectAgentAuthoringRunWithDeps(args, agentAuthoringAdapterDeps()),
    verify: verifyAgentAuthoringRun,
    finalize: (input) => finalizeAgentAuthoringRunWithDeps(input, agentAuthoringAdapterDeps()),
  },
];

const CODING_REMOTE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['completed', 'failed'] },
    summary: { type: 'string' },
    tests: { type: 'array', items: { type: 'string' } },
    changedFiles: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'summary', 'tests', 'changedFiles'],
  additionalProperties: false,
} as const;

function promptReceipt(input: {
  compiledHash: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}) {
  return {
    compiledHash: input.compiledHash,
    sentPromptHash: `sha256:${createHash('sha256')
      .update(serializeCodexMessages(input.messages))
      .digest('hex')}`,
    messageCount: input.messages.length,
  };
}

function transportProgress(value: unknown): CodexTransportProgress | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const kind = (value as { kind?: unknown }).kind;
  return [
    'run-started',
    'command-started',
    'command-completed',
    'files-changed',
    'message-received',
    'run-failed',
    'provider-event',
  ].includes(String(kind))
    ? (value as CodexTransportProgress)
    : undefined;
}

function normalizedCodingEvent(
  context: AgentRunWorkflowArgs,
  progress: CodexTransportProgress,
  sequence: number,
): CodingNormalizedEvent {
  const common = {
    schemaVersion: 1 as const,
    eventId: `remote:${context.runId}:${sequence}`,
    runId: context.runId,
    sequence,
  };
  switch (progress.kind) {
    case 'run-started':
      return { ...common, kind: 'run-started', nativeSessionId: progress.nativeSessionId };
    case 'command-started':
      return {
        ...common,
        kind: 'command-started',
        commandId: progress.commandId,
        summary: progress.summary,
      };
    case 'command-completed':
      return {
        ...common,
        kind: 'command-completed',
        commandId: progress.commandId,
        exitCode: progress.exitCode,
      };
    case 'files-changed':
      return { ...common, kind: 'files-changed', files: progress.files };
    case 'message-received':
      return { ...common, kind: 'progress-reported', message: progress.summary };
    case 'run-failed':
      return { ...common, kind: 'run-failed', code: progress.code, reason: progress.reason };
    case 'provider-event':
      return { ...common, kind: 'provider-event', providerDetail: progress.providerDetail };
  }
}

async function replayStructuredTransportEvents(
  input: CodexStructuredInput,
  deps: CodexStructuredDeps,
  result: CompiledRuntimeTransportResult,
): Promise<void> {
  await deps.onPromptDispatched?.(promptReceipt(input));
  for (const [index, event] of result.events.entries()) {
    const cursor = String(index + 1);
    await deps.onRaw(event, cursor);
    const progress = transportProgress(event);
    if (progress !== undefined) await deps.onProgress(progress);
  }
}

function compiledTransportControls(signal: AbortSignal) {
  return { signal, reportProgress: () => undefined };
}

function remoteStructuredExecutor(input: {
  context: AgentRunWorkflowArgs;
  profile: Parameters<
    NonNullable<ProductionRuntimeSpecializationPort['executeProduction']>
  >[0]['profile'];
  transport: Parameters<
    NonNullable<ProductionRuntimeSpecializationPort['executeProduction']>
  >[0]['transport'];
  runnerArtifactImage: string;
}): (value: CodexStructuredInput, deps: CodexStructuredDeps) => Promise<CodexStructuredOutput> {
  return async (value, deps) => {
    const request: CompiledRuntimeTransportRequest = {
      schemaVersion: 1,
      compiledHash: value.compiledHash,
      messages: value.messages,
      outputSchema: value.outputSchema,
      sandboxMode: value.sandboxMode ?? 'workspace-write',
    };
    const result = await executeCompiledRuntimeTransport({
      context: input.context,
      request,
      profile: input.profile,
      transport: input.transport,
      runnerArtifactImage: input.runnerArtifactImage,
      controls: compiledTransportControls(value.signal ?? new AbortController().signal),
    });
    await replayStructuredTransportEvents(value, deps, result);
    return { nativeSessionId: result.nativeSessionId, result: result.result };
  };
}

function remoteCodingExecutor(input: {
  context: AgentRunWorkflowArgs;
  profile: Parameters<
    NonNullable<ProductionRuntimeSpecializationPort['executeProduction']>
  >[0]['profile'];
  transport: Parameters<
    NonNullable<ProductionRuntimeSpecializationPort['executeProduction']>
  >[0]['transport'];
  runnerArtifactImage: string;
}): (value: CodexExecutionInput, deps: CodexExecutionDeps) => Promise<CodexExecutionOutput> {
  return async (value, deps) => {
    if (value.compiledPrompt === undefined) throw new Error('runtime_compiled_transport_invalid');
    const result = await executeCompiledRuntimeTransport({
      context: input.context,
      request: {
        schemaVersion: 1,
        compiledHash: value.compiledPrompt.compiledHash,
        messages: value.compiledPrompt.messages,
        outputSchema: CODING_REMOTE_RESULT_SCHEMA,
        sandboxMode: 'workspace-write',
      },
      profile: input.profile,
      transport: input.transport,
      runnerArtifactImage: input.runnerArtifactImage,
      controls: compiledTransportControls(value.signal ?? new AbortController().signal),
    });
    await deps.onPromptDispatched?.(promptReceipt(value.compiledPrompt));
    for (const [index, event] of result.events.entries()) {
      const cursor = String(index + 1);
      await deps.onRaw(event, cursor);
      const progress = transportProgress(event);
      if (progress !== undefined) {
        await deps.onNormalized(normalizedCodingEvent(input.context, progress, index + 1));
      }
    }
    return { nativeSessionId: result.nativeSessionId, claim: result.result as CodexTaskClaim };
  };
}

function runtimeSpecializationPorts(
  config: ProductionDeploymentConfig,
): Record<AgentSpecializationAdapter, ProductionRuntimeSpecializationPort> {
  const productionWriting = composeProductionWritingAgent(config);
  const writingDeps: WritingAgentAdapterDeps = {
    db: workerDb(process.env, config),
    workspaceRoot: productionWriting.workspaceRoot,
    profiles: productionWriting.profiles,
    probe: productionWriting.probe,
    callbackBaseUrl: process.env.UI4A_PUBLIC_BASE_URL,
    callbackToken: process.env.UI4A_CAPABILITY_CALLBACK_TOKEN,
  };
  return {
    coding: {
      taskKind: 'coding-task',
      prepare: (context) => prepareCodingAgentRunWithDeps(context, codingAgentAdapterDeps()),
      executeProduction: async (input) =>
        executeCodingAgentRunWithDeps(
          { context: input.context, prepared: input.prepared },
          {
            ...codingAgentAdapterDeps(),
            probe: async () => ({ available: true }),
            execute: remoteCodingExecutor(input),
          },
        ),
      collect: (input) => collectCodingAgentRunWithDeps(input, codingAgentAdapterDeps()),
      verify: verifyCodingAgentRun,
      finalize: (input) => finalizeCodingAgentRunWithDeps(input, codingAgentAdapterDeps()),
    },
    writing: {
      taskKind: 'writing-task',
      prepare: (context) => prepareWritingAgentRunWithDeps(context, writingDeps),
      executeProduction: async (input) => {
        const workspaceRoot = writingPreparedWorkspaceRoot(input.prepared);
        if (workspaceRoot !== productionWriting.workspaceRootForRun(input.context.runId)) {
          throw new Error('production_writing_workspace_mismatch');
        }
        return executeWritingAgentRunWithDeps(
          { context: input.context, prepared: input.prepared },
          {
            ...writingDeps,
            execute: remoteStructuredExecutor({
              ...input,
              profile: { ...input.profile, workspaceRoot },
            }),
          },
        );
      },
      collect: (input) => collectWritingAgentRunWithDeps(input, writingDeps),
      verify: verifyWritingAgentRun,
      finalize: (input) => finalizeWritingAgentRunWithDeps(input, writingDeps),
    },
    authoring: {
      taskKind: 'agent-definition-authoring-task',
      prepare: (context) => prepareAgentAuthoringRunWithDeps(context, agentAuthoringAdapterDeps()),
      executeProduction: async (input) =>
        executeAgentAuthoringRunWithDeps(
          { context: input.context, prepared: input.prepared },
          {
            ...agentAuthoringAdapterDeps(),
            probe: async () => ({ available: true }),
            execute: remoteStructuredExecutor(input),
          },
        ),
      collect: (input) => collectAgentAuthoringRunWithDeps(input, agentAuthoringAdapterDeps()),
      verify: verifyAgentAuthoringRun,
      finalize: (input) => finalizeAgentAuthoringRunWithDeps(input, agentAuthoringAdapterDeps()),
    },
  };
}

function hostRunnerOrigins(environment: NodeJS.ProcessEnv): Record<string, string> {
  const source = environment.UI4A_HOST_RUNNER_ORIGINS;
  if (source === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('production_host_runner_origins_invalid');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('production_host_runner_origins_invalid');
  }
  const origins = value as Record<string, unknown>;
  if (
    Object.keys(origins).length === 0 ||
    Object.values(origins).some((origin) => typeof origin !== 'string' || origin === '')
  ) {
    throw new Error('production_host_runner_origins_invalid');
  }
  return origins as Record<string, string>;
}

function productionAgentRunActivities(config: ProductionDeploymentConfig) {
  const runnerArtifactImage = process.env.UI4A_RUNNER_IMAGE;
  if (runnerArtifactImage === undefined || runnerArtifactImage === '') {
    throw new Error('production_runner_image_missing');
  }
  const origins = hostRunnerOrigins(process.env);
  const transport = createHttpRunnerExecutionPortForCompiledTransport({
    fetchImpl: fetch,
    timeoutMs: 30_000,
    endpoint(envelope) {
      const profile = config.settings.runtime.profiles.find(
        (candidate) => candidate.id === envelope.execution.profileId,
      );
      if (
        profile === undefined ||
        profile.backend !== 'host' ||
        profile.runnerId !== envelope.execution.runnerId
      ) {
        throw new Error('runtime_profile_selection_invalid');
      }
      const origin = origins[profile.runnerId];
      if (origin === undefined) throw new Error('runtime_backend_unavailable:trusted-host');
      const token = config.secrets[profile.runnerTokenRef];
      if (token === undefined || token === '') {
        throw new Error('runtime_backend_unavailable:trusted-host');
      }
      return { origin, authorizationHeader: `Bearer ${token}` };
    },
  });
  const kubernetesTransport =
    config.settings.deploymentMode === 'kubernetes'
      ? createInClusterKubernetesRuntimeTransportFromEnvironment(
          process.env,
          Object.values(config.secrets),
        )
      : undefined;
  return createProductionAgentRunActivities({
    runtime: config.settings.runtime,
    runnerArtifactImage,
    transports: {
      'trusted-host': transport,
      ...(kubernetesTransport === undefined ? {} : { 'kubernetes-job': kubernetesTransport }),
    },
    specializations: runtimeSpecializationPorts(config),
  });
}

function specializationBindingForTask(context: AgentRunWorkflowArgs): AgentSpecializationBinding {
  const kind = agentTaskKind(context);
  const matches = agentSpecializationBindings.filter((binding) => binding.taskKind === kind);
  if (matches.length !== 1) {
    throw new Error(`no Agent specialization adapter is registered for ${kind ?? 'unknown task'}`);
  }
  return matches[0]!;
}

/** Select only the birth-compiled task kind; Provider/profile fields are never task-controlled. */
export function specializationAdapterForTask(
  context: AgentRunWorkflowArgs,
): AgentSpecializationAdapter {
  return specializationBindingForTask(context).name;
}

/** Select the birth-pinned specialization; task parameters cannot choose a Provider adapter. */
export async function prepareAgentRun(args: AgentRunWorkflowArgs) {
  const config = productionAgentActivityConfig();
  if (config !== undefined) return productionAgentRunActivities(config).prepareAgentRun(args);
  return specializationBindingForTask(args).prepare(args);
}

export async function executeAgentRun(args: AgentExecuteActivityArgs) {
  const config = productionAgentActivityConfig();
  if (config !== undefined) return productionAgentRunActivities(config).executeAgentRun(args);
  return specializationBindingForTask(args.context).execute(args);
}

export async function collectAgentRun(args: AgentCollectActivityArgs) {
  const config = productionAgentActivityConfig();
  if (config !== undefined) return productionAgentRunActivities(config).collectAgentRun(args);
  return specializationBindingForTask(args.context).collect(args);
}

export async function verifyAgentRun(args: AgentVerifyActivityArgs) {
  const config = productionAgentActivityConfig();
  if (config !== undefined) return productionAgentRunActivities(config).verifyAgentRun(args);
  return specializationBindingForTask(args.context).verify(args);
}

async function currentNativeRun(context: AgentRunWorkflowArgs) {
  const run = await getAgentRun(workerDb(), context.runId, context.principal, context.policyScope);
  if (run === undefined) throw new Error('native agent run does not exist or is not authorized');
  return run;
}

export async function recordAgentRunSuspension(
  input: AgentSuspensionRecord,
): Promise<{ deduplicated: boolean }> {
  specializationAdapterForTask(input.context);
  const run = await currentNativeRun(input.context);
  const applied = await appendAgentRunCommand(
    workerDb(),
    input.suspension.status === 'needs-input'
      ? {
          kind: 'ask-question',
          runId: input.context.runId,
          expectedRevision: run.revision,
          commandId: input.idempotencyKey,
          eventId: `event:${input.idempotencyKey}`,
          question: input.suspension.question,
        }
      : {
          kind: 'request-resource-grant',
          runId: input.context.runId,
          expectedRevision: run.revision,
          commandId: input.idempotencyKey,
          eventId: `event:${input.idempotencyKey}`,
          request: input.suspension.request,
        },
  );
  return { deduplicated: applied.event === undefined };
}

export async function recordAgentRunResolution(
  input: AgentResolutionRecord,
): Promise<{ deduplicated: boolean }> {
  specializationAdapterForTask(input.context);
  const run = await currentNativeRun(input.context);
  const applied = await appendAgentRunCommand(
    workerDb(),
    input.resolution.kind === 'question-answer'
      ? {
          kind: 'answer-question',
          runId: input.context.runId,
          expectedRevision: run.revision,
          commandId: input.idempotencyKey,
          eventId: `event:${input.idempotencyKey}`,
          questionId: input.resolution.questionId,
          answeredBy: input.resolution.answeredBy,
          answer: input.resolution.answer,
        }
      : {
          kind: 'decide-resource-grant',
          runId: input.context.runId,
          expectedRevision: run.revision,
          commandId: input.idempotencyKey,
          eventId: `event:${input.idempotencyKey}`,
          requestId: input.resolution.requestId,
          decision: input.resolution.decision,
        },
    'human',
  );
  return { deduplicated: applied.event === undefined };
}

export async function finalizeAgentRun(input: AgentFinalizeInput): Promise<void> {
  const config = productionAgentActivityConfig();
  if (config !== undefined) return productionAgentRunActivities(config).finalizeAgentRun(input);
  return specializationBindingForTask(input.context).finalize(input);
}

export interface CapabilityArtifactInput {
  id: string;
  capability: string;
  source: { rel: string; field: string };
  model: string;
  outputSchema: Record<string, unknown>;
  content: unknown;
  createdBy: { actor: 'human' | 'agent'; principal?: string };
}

/**
 * capability runner 的持久化边界。模型调用发生在 activity adapter 外层；
 * 本函数把已验证输出物化为 append-only artifact，重试按 artifact rel 幂等。
 */
export async function materializeCapabilityArtifact(
  db: DbExecutor,
  input: CapabilityArtifactInput,
): Promise<{ seq: number; deduplicated: boolean; contentHash: string }> {
  const rel = `artifact:${input.id}`;
  const canonicalContent = canonicalJson(input.content);
  const contentHash = `sha256:${createHash('sha256').update(canonicalContent).digest('hex')}`;
  const existing = await findEvent(db, 'capability-artifact-created', rel);
  if (existing !== null) return { seq: existing, deduplicated: true, contentHash };
  const detail = { ...input, contentHash };
  const appended = await appendEvent(db, {
    kind: 'capability-artifact-created',
    rel,
    actor: input.createdBy.actor,
    principal: input.createdBy.principal,
    channel: 'capability',
    detail,
  });
  return { seq: appended.seq, deduplicated: false, contentHash };
}

// ---------------------------------------------------------------------------
// delegation activities(T5 Phase A / spec 架构决定 1)
// ---------------------------------------------------------------------------

/**
 * delegation activity 注册表(workflow 经 proxyActivities 按名调用):
 * - startDelegation / finishDelegation:委托首尾事件落 PG(幂等);
 * - loadSitemap:agent 静态上下文,循环外取一次;
 * - agentStep:决策+执行合一的单步核心(见 delegation.ts;llm 决策的网络
 *   调用因此天然在 activity 内,workflow 重放确定性)。
 */
export interface DelegationActivities {
  startDelegation(args: DelegationStartArgs): Promise<{ seq: number; deduplicated: boolean }>;
  loadSitemap(args: { baseUrl: string }): Promise<SitemapSummary | undefined>;
  agentStep(args: AgentStepArgs): Promise<AgentStepResult>;
  finishDelegation(args: DelegationFinishArgs): Promise<{ seq: number; deduplicated: boolean }>;
}

const PRODUCTION_AGENT_CONTRACT_PATHS = [
  '/.well-known/ui4a.json',
  '/api/entity',
  '/api/exec',
  '/api/exec-plan',
] as const;

export interface ProductionAgentActivityDeps {
  config: ProductionDeploymentConfig;
  credentialProvider: Pick<ProductionAgentTokenProvider, 'getClientCredential'>;
  fetchImpl: FetchLike;
  db: DbExecutor;
  driver?: AgentDriver;
}

export class ProductionAgentActivityAuthenticationError extends Error {
  readonly code = 'agent_activity_credential_unavailable';

  constructor() {
    super('agent_activity_credential_unavailable');
    this.name = 'ProductionAgentActivityAuthenticationError';
  }
}

function requireCanonicalAgentActivityOrigin(
  config: ProductionDeploymentConfig,
  suppliedBaseUrl: string,
): string {
  const canonicalOrigin = config.settings.service.publicOrigin;
  if (suppliedBaseUrl !== canonicalOrigin) {
    throw new Error('agent_activity_base_url_must_equal_canonical_origin');
  }
  return canonicalOrigin;
}

async function productionAgentFetch(
  deps: ProductionAgentActivityDeps,
  suppliedBaseUrl: string,
): Promise<FetchLike> {
  const origin = requireCanonicalAgentActivityOrigin(deps.config, suppliedBaseUrl);
  let authorizationHeader: string;
  try {
    ({ authorizationHeader } = await deps.credentialProvider.getClientCredential());
  } catch {
    throw new ProductionAgentActivityAuthenticationError();
  }
  return createBoundedBearerFetch({
    origin,
    authorizationHeader,
    allowedPaths: PRODUCTION_AGENT_CONTRACT_PATHS,
    fetch: deps.fetchImpl,
  });
}

/** Production Activity core: the credential exists only in the bounded Fetch closure. */
export async function loadSitemapWithProductionAuth(
  deps: ProductionAgentActivityDeps,
  args: { baseUrl: string },
): Promise<SitemapSummary | undefined> {
  const authenticatedFetch = await productionAgentFetch(deps, args.baseUrl);
  return fetchSitemap(args.baseUrl, authenticatedFetch);
}

/** Production Activity core: verified Bearer identity replaces all self-reported identity fields. */
export async function agentStepWithProductionAuth(
  deps: ProductionAgentActivityDeps,
  args: AgentStepArgs,
): Promise<AgentStepResult> {
  const authenticatedFetch = await productionAgentFetch(deps, args.baseUrl);
  return runAgentStep(
    {
      db: deps.db,
      fetchImpl: authenticatedFetch,
      ...(deps.driver === undefined ? {} : { driver: deps.driver }),
      selfReportedIdentity: false,
    },
    args,
  );
}

function productionAgentActivityDeps(
  config: ProductionDeploymentConfig,
): ProductionAgentActivityDeps {
  const oidc = config.settings.auth.oidc;
  return {
    config,
    credentialProvider: createProductionAgentTokenProvider({
      tokenEndpoint: `${oidc.issuer}/protocol/openid-connect/token`,
      audience: oidc.audience,
      clientId: oidc.agentClientId,
      clientSecret: config.secrets[oidc.agentClientSecretRef]!,
      registeredClientIds: [oidc.agentClientId],
      allowedScopes: oidc.agentScopes,
      clock: Date.now,
      fetcher: fetch,
    }),
    fetchImpl: fetch,
    db: workerDb(process.env, config),
  };
}

function productionAgentActivityConfig(): ProductionDeploymentConfig | undefined {
  if (process.env.UI4A_DEPLOYMENT_PROFILE !== 'production') return undefined;
  const config = runWorkerProductionDeploymentPreflight(process.env);
  if (config === undefined) throw new Error('production_agent_activity_config_missing');
  return config;
}

export async function startDelegation(
  args: DelegationStartArgs,
): Promise<{ seq: number; deduplicated: boolean }> {
  return recordDelegationStart(workerDb(), { ...args, model: resolveLlmConfig().model });
}

export async function loadSitemap(args: { baseUrl: string }): Promise<SitemapSummary | undefined> {
  const config = productionAgentActivityConfig();
  if (config !== undefined) {
    return loadSitemapWithProductionAuth(productionAgentActivityDeps(config), args);
  }
  return fetchSitemap(args.baseUrl, fetch);
}

export async function agentStep(args: AgentStepArgs): Promise<AgentStepResult> {
  const config = productionAgentActivityConfig();
  if (config !== undefined) {
    return agentStepWithProductionAuth(productionAgentActivityDeps(config), args);
  }
  return runAgentStep({ db: workerDb(), fetchImpl: fetch }, args);
}

export async function finishDelegation(
  args: DelegationFinishArgs,
): Promise<{ seq: number; deduplicated: boolean }> {
  return recordDelegationFinish(workerDb(), args);
}
