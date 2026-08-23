import { isAbsolute, join, resolve } from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';

import {
  canonicalJson,
  hashCanonicalAgentJson,
  type AgentResultEnvelope,
  type AgentRun,
  type AgentRunCommand,
  type AgentRunJson,
} from '@ui4a/engine';
import {
  assertAgentAuthoringBrief,
  assertAgentAuthoringResult,
  type AgentAuthoringBrief,
  type AgentAuthoringResult,
  type JsonObject,
} from '@ui4a/shared';

import {
  appendAgentRunCommand,
  appendAgentRunRawEvent,
  getAgentRun,
  listAgentRunRawReceipts,
  readAgentRunPayload,
  storeAgentRunPayload,
  type ConnectableDb,
} from '../../../../web/src/db/agent-runs';
import {
  CodexTransportCancelledError,
  executeCodexStructured,
  probeCodexTransport,
  type CodexStructuredDeps,
  type CodexTransportProgress,
} from '../host/codex-transport';
import type {
  AgentCollectedResult,
  AgentExecuteActivityArgs,
  AgentExecutionCompleted,
  AgentExecutionResult,
  AgentFinalizeInput,
  AgentPreparedResult,
  AgentRunWorkflowArgs,
  AgentRuntimeExecutionInput,
  AgentRuntimePort,
  AgentVerificationResult,
} from '../host/contracts';
import {
  executeAgentRuntimeStep,
  type AgentActivityControls,
  type AgentRuntimeStepPorts,
} from '../host/runtime';
import { inspectAuthoredAgentDefinition } from './validate';

export interface AgentAuthoringProfile {
  name: string;
  runtimeClass: 'agent-definition-authoring';
  providerId: string;
  transport: 'sdk';
  model: string;
  endpoint?: string;
  apiKeyEnv: string;
  timeoutSeconds: number;
  maxTurns: number;
  envAllowlist: string[];
  networkPolicy: 'none';
}

interface AuthoringProviderClaim {
  status: 'completed' | 'failed';
  summary: string;
  candidate: JsonObject;
  examples: AgentAuthoringResult['examples'];
  evalCorpus: AgentAuthoringResult['evalCorpus'];
  safety: AgentAuthoringResult['safety'];
}

type CompiledMessage = {
  blockId: string;
  role: 'system' | 'user' | 'assistant';
  purpose: string;
  content: string;
  sealed: boolean;
};

interface AuthoringTaskPayload {
  kind: 'agent-definition-authoring-task';
  authoringBrief: AgentAuthoringBrief;
  compiledPrompt: { compiledHash: string; messages: CompiledMessage[] };
}

interface AuthoringPreparedState {
  kind: 'agent-definition-authoring-prepared';
  workingDirectory: string;
}

interface AuthoringCompletedState {
  kind: 'agent-definition-authoring-completed';
  workingDirectory: string;
  nativeSessionId: string;
  result: AgentAuthoringResult;
}

export interface AgentAuthoringCallbackInput {
  baseUrl: string;
  token: string;
  runId: string;
  outcome: AgentFinalizeInput['outcome'];
}

export interface AgentAuthoringAdapterDeps {
  db: ConnectableDb;
  runtimeRoot: string;
  profiles: AgentAuthoringProfile[];
  execute?: typeof executeCodexStructured;
  probe?: () => Promise<{ available: boolean; reason?: string }>;
  callback?: (input: AgentAuthoringCallbackInput) => Promise<unknown>;
  callbackBaseUrl?: string;
  callbackToken?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asJson(value: unknown): AgentRunJson {
  return JSON.parse(JSON.stringify(value)) as AgentRunJson;
}

/** Parse exact deployment profiles; no implicit default or Provider fallback exists. */
export function parseAgentAuthoringProfiles(raw: string): AgentAuthoringProfile[] {
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) throw new Error('UI4A_AGENT_AUTHORING_PROFILES must be an array');
  return value.map((item, index) => {
    if (!record(item)) throw new Error(`Agent authoring profile ${index} is invalid`);
    const profile = item as unknown as AgentAuthoringProfile;
    if (
      typeof profile.name !== 'string' ||
      profile.runtimeClass !== 'agent-definition-authoring' ||
      profile.transport !== 'sdk' ||
      typeof profile.providerId !== 'string' ||
      typeof profile.model !== 'string' ||
      typeof profile.apiKeyEnv !== 'string' ||
      !Number.isSafeInteger(profile.timeoutSeconds) ||
      profile.timeoutSeconds <= 0 ||
      !Number.isSafeInteger(profile.maxTurns) ||
      profile.maxTurns <= 0 ||
      !Array.isArray(profile.envAllowlist) ||
      profile.envAllowlist.some((entry) => typeof entry !== 'string') ||
      profile.networkPolicy !== 'none'
    ) {
      throw new Error(`Agent authoring profile ${index} is invalid`);
    }
    return profile;
  });
}

function providerClaim(value: unknown): AuthoringProviderClaim {
  if (!record(value)) throw new Error('Agent authoring Provider result must be an object');
  const keys = ['status', 'summary', 'candidate', 'examples', 'evalCorpus', 'safety'];
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error('Agent authoring Provider result contains an unknown field');
  }
  if (
    (value.status !== 'completed' && value.status !== 'failed') ||
    typeof value.summary !== 'string' ||
    !record(value.candidate) ||
    !Array.isArray(value.examples) ||
    !Array.isArray(value.evalCorpus) ||
    !record(value.safety)
  ) {
    throw new Error('Agent authoring Provider result is invalid');
  }
  return value as unknown as AuthoringProviderClaim;
}

/** Add authoritative validation to one bounded structured Provider candidate. */
export function parseAuthoringProviderClaim(
  briefInput: AgentAuthoringBrief,
  claimInput: unknown,
  runId: string,
): AgentAuthoringResult {
  const brief = assertAgentAuthoringBrief(briefInput);
  const claim = providerClaim(claimInput);
  const inspection = inspectAuthoredAgentDefinition({
    brief,
    candidate: claim.candidate,
    evalCorpus: claim.evalCorpus,
  });
  return assertAgentAuthoringResult({
    schemaVersion: 1,
    resultId: `authoring-result:${runId}`,
    status: claim.status,
    summary: claim.summary,
    candidate: claim.candidate,
    examples: claim.examples,
    evalCorpus: claim.evalCorpus,
    safety: claim.safety,
    validation: {
      valid: inspection.valid,
      issues: inspection.issues,
      pendingEvalSuiteRefs: inspection.pendingEvalSuiteRefs,
      checks: inspection.checks,
    },
  });
}

export const AGENT_AUTHORING_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['completed', 'failed'] },
    summary: { type: 'string' },
    candidate: {
      type: 'object',
      properties: {
        schemaVersion: { type: 'integer', const: 1 },
        ref: { type: 'string' },
        name: { type: 'string' },
        version: { type: 'integer', minimum: 1 },
        intent: { type: 'string' },
        prompt: {
          type: 'object',
          properties: {
            schemaVersion: { type: 'integer', const: 1 },
            blocks: {
              type: 'array',
              items: {
                anyOf: [
                  {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                      purpose: {
                        type: 'string',
                        enum: [
                          'authority',
                          'instruction',
                          'task-data',
                          'context-data',
                          'policy-data',
                        ],
                      },
                      sealed: { type: 'boolean' },
                      literal: { type: 'string' },
                    },
                    required: ['id', 'role', 'purpose', 'sealed', 'literal'],
                    additionalProperties: false,
                  },
                  {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                      purpose: {
                        type: 'string',
                        enum: [
                          'authority',
                          'instruction',
                          'task-data',
                          'context-data',
                          'policy-data',
                        ],
                      },
                      sealed: { type: 'boolean' },
                      binding: {
                        type: 'object',
                        properties: {
                          source: { type: 'string', enum: ['task', 'context', 'policy'] },
                          pointer: { type: 'string' },
                          encoding: { type: 'string', const: 'json-delimited' },
                          required: { type: 'boolean' },
                        },
                        required: ['source', 'pointer', 'encoding', 'required'],
                        additionalProperties: false,
                      },
                    },
                    required: ['id', 'role', 'purpose', 'sealed', 'binding'],
                    additionalProperties: false,
                  },
                ],
              },
            },
          },
          required: ['schemaVersion', 'blocks'],
          additionalProperties: false,
        },
        contracts: {
          type: 'object',
          properties: {
            inputSchema: {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'object' },
                properties: {
                  type: 'object',
                  properties: {
                    objective: {
                      type: 'object',
                      properties: { type: { type: 'string', const: 'string' } },
                      required: ['type'],
                      additionalProperties: false,
                    },
                  },
                  required: ['objective'],
                  additionalProperties: false,
                },
                required: {
                  type: 'array',
                  items: { type: 'string', enum: ['objective'] },
                  minItems: 1,
                  maxItems: 1,
                },
                additionalProperties: { type: 'boolean', const: false },
              },
              required: ['type', 'properties', 'required', 'additionalProperties'],
              additionalProperties: false,
            },
            outputSchema: {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'object' },
                properties: {
                  type: 'object',
                  properties: {
                    response: {
                      type: 'object',
                      properties: { type: { type: 'string', const: 'string' } },
                      required: ['type'],
                      additionalProperties: false,
                    },
                    evidence: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', const: 'array' },
                        items: {
                          type: 'object',
                          properties: { type: { type: 'string', const: 'string' } },
                          required: ['type'],
                          additionalProperties: false,
                        },
                      },
                      required: ['type', 'items'],
                      additionalProperties: false,
                    },
                  },
                  required: ['response', 'evidence'],
                  additionalProperties: false,
                },
                required: {
                  type: 'array',
                  items: { type: 'string', enum: ['response', 'evidence'] },
                  minItems: 2,
                  maxItems: 2,
                },
                additionalProperties: { type: 'boolean', const: false },
              },
              required: ['type', 'properties', 'required', 'additionalProperties'],
              additionalProperties: false,
            },
          },
          required: ['inputSchema', 'outputSchema'],
          additionalProperties: false,
        },
        runtimeRequirements: {
          type: 'object',
          properties: {
            class: { type: 'string' },
            features: { type: 'array', items: { type: 'string' } },
          },
          required: ['class', 'features'],
          additionalProperties: false,
        },
        policies: {
          type: 'object',
          properties: {
            tools: {
              type: 'object',
              properties: { allowed: { type: 'array', items: { type: 'string' } } },
              required: ['allowed'],
              additionalProperties: false,
            },
            context: {
              type: 'object',
              properties: {
                allowedSources: { type: 'array', items: { type: 'string' } },
                maxItems: { type: 'integer', minimum: 0 },
              },
              required: ['allowedSources', 'maxItems'],
              additionalProperties: false,
            },
            resources: {
              type: 'object',
              properties: { allowed: { type: 'array', items: { type: 'string' } } },
              required: ['allowed'],
              additionalProperties: false,
            },
            artifacts: {
              type: 'object',
              properties: {
                allowedMediaTypes: { type: 'array', items: { type: 'string' } },
                maxCount: { type: 'integer', minimum: 0 },
                maxBytes: { type: 'integer', minimum: 0 },
              },
              required: ['allowedMediaTypes', 'maxCount', 'maxBytes'],
              additionalProperties: false,
            },
          },
          required: ['tools', 'context', 'resources', 'artifacts'],
          additionalProperties: false,
        },
        evaluationPolicy: {
          type: 'object',
          properties: {
            verifiers: { type: 'array', items: { type: 'string' } },
            evalSuiteRefs: { type: 'array', items: { type: 'string' } },
            minimumScore: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['verifiers', 'evalSuiteRefs', 'minimumScore'],
          additionalProperties: false,
        },
      },
      required: [
        'schemaVersion',
        'ref',
        'name',
        'version',
        'intent',
        'prompt',
        'contracts',
        'runtimeRequirements',
        'policies',
        'evaluationPolicy',
      ],
      additionalProperties: false,
    },
    examples: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          inputJson: { type: 'string' },
          expectedOutcome: { type: 'string' },
        },
        required: ['name', 'inputJson', 'expectedOutcome'],
        additionalProperties: false,
      },
    },
    evalCorpus: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          taskJson: { type: 'string' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'taskJson', 'acceptanceCriteria'],
        additionalProperties: false,
      },
    },
    safety: {
      type: 'object',
      properties: Object.fromEntries(
        ['draftOnly', 'noApprovalRequested', 'noActivationRequested', 'noRuntimeOverride'].map(
          (name) => [name, { type: 'boolean', const: true }],
        ),
      ),
      required: ['draftOnly', 'noApprovalRequested', 'noActivationRequested', 'noRuntimeOverride'],
      additionalProperties: false,
    },
  },
  required: ['status', 'summary', 'candidate', 'examples', 'evalCorpus', 'safety'],
  additionalProperties: false,
} as const;

function parseTask(context: AgentRunWorkflowArgs): AuthoringTaskPayload {
  const payload = context.task.payload;
  if (!record(payload) || payload.kind !== 'agent-definition-authoring-task') {
    throw new Error('Agent authoring adapter requires agent-definition-authoring-task');
  }
  const authoringBrief = assertAgentAuthoringBrief(payload.authoringBrief);
  if (
    !record(payload.compiledPrompt) ||
    typeof payload.compiledPrompt.compiledHash !== 'string' ||
    payload.compiledPrompt.compiledHash !== context.birth.prompt.compiledHash ||
    !Array.isArray(payload.compiledPrompt.messages) ||
    payload.compiledPrompt.messages.length === 0
  ) {
    throw new Error('Agent authoring compiled Prompt is invalid');
  }
  const messages = payload.compiledPrompt.messages as unknown as CompiledMessage[];
  if (
    messages.some(
      (message) =>
        !record(message) ||
        typeof message.blockId !== 'string' ||
        !['system', 'user', 'assistant'].includes(message.role) ||
        typeof message.purpose !== 'string' ||
        typeof message.content !== 'string' ||
        typeof message.sealed !== 'boolean',
    ) ||
    hashCanonicalAgentJson(messages as unknown as AgentRunJson) !==
      payload.compiledPrompt.compiledHash
  ) {
    throw new Error('Agent authoring compiled Prompt failed its birth-pinned hash');
  }
  return {
    kind: 'agent-definition-authoring-task',
    authoringBrief,
    compiledPrompt: { compiledHash: payload.compiledPrompt.compiledHash, messages },
  };
}

function profileFor(
  context: AgentRunWorkflowArgs,
  profiles: AgentAuthoringProfile[],
): AgentAuthoringProfile {
  const matches = profiles.filter((profile) => profile.name === context.birth.runtime.profileName);
  if (matches.length !== 1) {
    throw new Error(
      `Agent authoring profile ${context.birth.runtime.profileName} must resolve once`,
    );
  }
  const profile = matches[0]!;
  if (profile.providerId !== 'codex') {
    throw new Error(`Agent authoring Provider ${profile.providerId} is unavailable`);
  }
  return profile;
}

async function currentRun(db: ConnectableDb, context: AgentRunWorkflowArgs): Promise<AgentRun> {
  const run = await getAgentRun(db, context.runId, context.principal, context.policyScope);
  if (run === undefined) throw new Error('Agent authoring Run is missing or unauthorized');
  return run;
}

async function command(
  deps: AgentAuthoringAdapterDeps,
  context: AgentRunWorkflowArgs,
  build: (run: AgentRun) => AgentRunCommand,
): Promise<AgentRun> {
  return (await appendAgentRunCommand(deps.db, build(await currentRun(deps.db, context))))
    .aggregate;
}

function safeRuntimeDirectory(root: string, runId: string): string {
  if (
    !isAbsolute(root) ||
    resolve(root) === resolve('/') ||
    resolve(root) === resolve(process.env.HOME ?? '/')
  ) {
    throw new Error('Agent authoring runtime root is unsafe');
  }
  if (!/^[A-Za-z0-9:_-]{1,128}$/u.test(runId) || runId.includes('..')) {
    throw new Error('Agent authoring runId is unsafe');
  }
  return join(resolve(root), runId);
}

export async function prepareAgentAuthoringRunWithDeps(
  context: AgentRunWorkflowArgs,
  deps: AgentAuthoringAdapterDeps,
): Promise<AgentPreparedResult> {
  parseTask(context);
  profileFor(context, deps.profiles);
  const probe = await (deps.probe ?? probeCodexTransport)();
  if (!probe.available) throw new Error(probe.reason ?? 'Agent authoring Provider unavailable');
  let run = await currentRun(deps.db, context);
  if (run.status === 'queued') {
    run = await command(deps, context, (current) => ({
      kind: 'prepare',
      runId: context.runId,
      expectedRevision: current.revision,
      commandId: `prepare:${context.runId}`,
      eventId: `event:prepare:${context.runId}`,
    }));
  }
  if (run.status !== 'preparing' && run.status !== 'running') {
    throw new Error(`Agent authoring cannot prepare from ${run.status}`);
  }
  const workingDirectory = safeRuntimeDirectory(deps.runtimeRoot, context.runId);
  await mkdir(workingDirectory, { recursive: true, mode: 0o700 });
  if ((await readdir(workingDirectory)).length > 0) {
    throw new Error('Agent authoring structured-only runtime directory is not empty');
  }
  return { state: asJson({ kind: 'agent-definition-authoring-prepared', workingDirectory }) };
}

function parsePrepared(value: AgentRunJson): AuthoringPreparedState {
  if (
    !record(value) ||
    value.kind !== 'agent-definition-authoring-prepared' ||
    typeof value.workingDirectory !== 'string'
  ) {
    throw new Error('Agent authoring prepared state is invalid');
  }
  return value as unknown as AuthoringPreparedState;
}

function parseCompleted(value: AgentRunJson): AuthoringCompletedState {
  if (
    !record(value) ||
    value.kind !== 'agent-definition-authoring-completed' ||
    typeof value.workingDirectory !== 'string' ||
    typeof value.nativeSessionId !== 'string' ||
    !record(value.result)
  ) {
    throw new Error('Agent authoring completed state is invalid');
  }
  return { ...value, result: assertAgentAuthoringResult(value.result) } as AuthoringCompletedState;
}

async function rawStats(deps: AgentAuthoringAdapterDeps, runId: string) {
  const receipts = await listAgentRunRawReceipts(deps.db, runId);
  return {
    count: receipts.length,
    bytes: receipts.reduce((sum, receipt) => sum + Number(receipt.byteLength ?? 0), 0),
    maxOrdinal: receipts.reduce((max, receipt) => Math.max(max, Number(receipt.ordinal ?? 0)), 0),
  };
}

async function appendRaw(
  deps: AgentAuthoringAdapterDeps,
  context: AgentRunWorkflowArgs,
  brief: AgentAuthoringBrief,
  ordinal: number,
  cursor: string,
  value: unknown,
): Promise<void> {
  const payload = asJson(value);
  const byteLength = new TextEncoder().encode(canonicalJson(payload)).byteLength;
  const stats = await rawStats(deps, context.runId);
  if (
    ordinal !== stats.maxOrdinal + 1 ||
    stats.count >= brief.budget.maxRawEvents ||
    byteLength > brief.budget.maxRawChunkBytes ||
    stats.bytes + byteLength > brief.budget.maxRawBytes
  ) {
    throw new Error('Agent authoring raw trajectory budget exhausted');
  }
  await appendAgentRunRawEvent(deps.db, {
    runId: context.runId,
    principal: context.principal,
    policyScope: context.policyScope,
    ordinal,
    cursor,
    redactedPayload: payload,
  });
}

async function executeRuntime(
  input: AgentRuntimeExecutionInput,
  deps: AgentAuthoringAdapterDeps,
): Promise<AgentExecutionResult> {
  const payload = parseTask(input.context);
  const profile = profileFor(input.context, deps.profiles);
  const prepared = parsePrepared(input.prepared.state);
  let ordinal = (await rawStats(deps, input.context.runId)).maxOrdinal;
  let sessionRef = (await currentRun(deps.db, input.context)).handle?.sessionRef;
  try {
    const output = await (deps.execute ?? executeCodexStructured)(
      {
        runId: input.context.runId,
        compiledHash: payload.compiledPrompt.compiledHash,
        messages: payload.compiledPrompt.messages.map(({ role, content }) => ({ role, content })),
        outputSchema: AGENT_AUTHORING_OUTPUT_SCHEMA,
        workingDirectory: prepared.workingDirectory,
        sandboxMode: 'read-only',
        profile: {
          providerId: profile.providerId,
          envAllowlist: profile.envAllowlist,
          networkPolicy: profile.networkPolicy,
          maxTurns: profile.maxTurns,
          model: profile.model,
          ...(profile.endpoint === undefined ? {} : { endpoint: profile.endpoint }),
          apiKeyEnv: profile.apiKeyEnv,
        },
        ...(sessionRef === undefined ? {} : { nativeSessionId: sessionRef }),
        signal: input.signal,
      },
      {
        onPromptDispatched: async (receipt) => {
          ordinal += 1;
          await appendRaw(deps, input.context, payload.authoringBrief, ordinal, `${ordinal}`, {
            kind: 'prompt-dispatched',
            ...receipt,
          });
        },
        onRaw: async (event, cursor) => {
          ordinal += 1;
          await appendRaw(deps, input.context, payload.authoringBrief, ordinal, cursor, {
            kind: 'provider-raw',
            payload: event,
          });
        },
        onProgress: async (progress: CodexTransportProgress) => {
          if (progress.kind === 'run-started') {
            sessionRef = progress.nativeSessionId;
            if ((await currentRun(deps.db, input.context)).status === 'preparing') {
              await command(deps, input.context, (current) => ({
                kind: 'start',
                runId: input.context.runId,
                expectedRevision: current.revision,
                commandId: `start:${input.context.runId}`,
                eventId: `event:start:${input.context.runId}`,
                handle: { sessionRef },
              }));
            }
          }
          ordinal += 1;
          await appendRaw(deps, input.context, payload.authoringBrief, ordinal, `${ordinal}`, {
            kind: 'authoring-progress',
            event: progress,
          });
          const run = await currentRun(deps.db, input.context);
          if (run.status === 'running') {
            const observedSequence = run.observedSequence + 1;
            await command(deps, input.context, (current) => ({
              kind: 'advance-cursor',
              runId: input.context.runId,
              expectedRevision: current.revision,
              expectedCursor: current.cursor,
              cursor: `${ordinal}`,
              observedSequence,
              commandId: `cursor:${input.context.runId}:${observedSequence}`,
              eventId: `event:cursor:${input.context.runId}:${observedSequence}`,
            }));
          }
          input.reportProgress({
            cursor: `${ordinal}`,
            state: asJson({ kind: 'authoring-running', sessionRef: sessionRef ?? null }),
          });
        },
      } satisfies CodexStructuredDeps,
    );
    const result = parseAuthoringProviderClaim(
      payload.authoringBrief,
      output.result,
      input.context.runId,
    );
    if (result.status !== 'completed') throw new Error(`Authoring Agent failed: ${result.summary}`);
    return {
      status: 'completed',
      state: asJson({
        kind: 'agent-definition-authoring-completed',
        workingDirectory: prepared.workingDirectory,
        nativeSessionId: output.nativeSessionId,
        result,
      }),
      handle: { sessionRef: output.nativeSessionId },
    };
  } catch (error) {
    if (error instanceof CodexTransportCancelledError || input.signal.aborted) {
      return { status: 'cancelled', reason: 'Agent authoring cancelled' };
    }
    return {
      status: 'failed',
      code: 'agent-authoring-executor-failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function recordRestart(
  deps: AgentAuthoringAdapterDeps,
  args: Parameters<AgentRuntimeStepPorts['recordRestart']>[0],
): Promise<void> {
  const run = await currentRun(deps.db, args.context);
  await command(deps, args.context, (current) => ({
    kind: 'restart',
    runId: args.context.runId,
    expectedRevision: current.revision,
    expectedCursor: current.cursor,
    reason: `${args.reason}:attempt-${args.attempt}`,
    ...(run.handle === undefined ? {} : { handle: run.handle }),
    commandId: `restart:${args.context.runId}:${args.attempt}`,
    eventId: `event:restart:${args.context.runId}:${args.attempt}`,
  }));
}

export async function executeAgentAuthoringRunWithDeps(
  args: AgentExecuteActivityArgs,
  deps: AgentAuthoringAdapterDeps,
  controls?: AgentActivityControls,
): Promise<AgentExecutionResult> {
  const runtime: AgentRuntimePort = {
    execute: (input) => executeRuntime(input, deps),
    resume: (input) => executeRuntime(input, deps),
  };
  return executeAgentRuntimeStep(
    args,
    { runtime, recordRestart: (value) => recordRestart(deps, value) },
    controls,
  );
}

async function progressEvents(deps: AgentAuthoringAdapterDeps, runId: string) {
  const values: AgentRunJson[] = [];
  for (const receipt of await listAgentRunRawReceipts(deps.db, runId)) {
    const value = await readAgentRunPayload(deps.db, String(receipt.payloadRef));
    if (record(value) && value.kind === 'authoring-progress') values.push(asJson(value));
  }
  return values;
}

export async function collectAgentAuthoringRunWithDeps(
  input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
    execution: AgentExecutionCompleted;
  },
  deps: AgentAuthoringAdapterDeps,
): Promise<AgentCollectedResult> {
  const payload = parseTask(input.context);
  const completed = parseCompleted(input.execution.state);
  const inspection = inspectAuthoredAgentDefinition({
    brief: payload.authoringBrief,
    candidate: completed.result.candidate,
    evalCorpus: completed.result.evalCorpus,
  });
  if ((await readdir(completed.workingDirectory)).length > 0) {
    throw new Error('Agent authoring read-only runtime produced filesystem effects');
  }
  const definitionPayload = await storeAgentRunPayload(
    deps.db,
    completed.result.candidate,
    'application/vnd.ui4a.agent-definition+json',
  );
  const evalPayload = await storeAgentRunPayload(
    deps.db,
    completed.result.evalCorpus,
    'application/vnd.ui4a.agent-eval-corpus+json',
  );
  const trajectory = await storeAgentRunPayload(
    deps.db,
    await progressEvents(deps, input.context.runId),
    'application/x-ndjson',
  );
  const candidate: AgentResultEnvelope = {
    schemaVersion: 1,
    contract: input.context.birth.resultContract,
    resultId: completed.result.resultId,
    payload: asJson({ authoringResult: completed.result }),
    artifacts: [
      {
        ref: `agent-run-payload:${definitionPayload.hash}`,
        hash: inspection.artifact?.flattenedHash ?? definitionPayload.hash,
        mediaType: 'application/vnd.ui4a.agent-definition+json',
        sizeBytes: definitionPayload.bytes,
      },
      {
        ref: `agent-run-payload:${evalPayload.hash}`,
        hash: evalPayload.hash,
        mediaType: 'application/vnd.ui4a.agent-eval-corpus+json',
        sizeBytes: evalPayload.bytes,
      },
      {
        ref: `agent-run-payload:${trajectory.hash}`,
        hash: trajectory.hash,
        mediaType: 'application/x-ndjson',
        sizeBytes: trajectory.bytes,
      },
    ],
    evidence: [
      {
        ref: `authoring-parse:${input.context.runId}`,
        kind: 'agent-definition-source-parse',
        hash: inspection.artifact?.flattenedHash ?? definitionPayload.hash,
        detail: asJson({ passed: inspection.valid, issues: inspection.issues }),
      },
      {
        ref: `authoring-invariants:${input.context.runId}`,
        kind: 'agent-definition-non-eval-invariants',
        detail: asJson({ passed: inspection.valid, checks: inspection.checks }),
      },
      {
        ref: `authoring-eval-proposal:${input.context.runId}`,
        kind: 'agent-definition-eval-corpus-proposed',
        hash: evalPayload.hash,
        detail: { passed: true, executed: false },
      },
      {
        ref: `authoring-governance:${input.context.runId}`,
        kind: 'agent-definition-draft-only',
        detail: { passed: true, approval: false, activation: false },
      },
    ],
    proposedEffects: [],
  };
  return { candidate };
}

export function verifyAgentAuthoringRun(input: {
  context: AgentRunWorkflowArgs;
  collected: AgentCollectedResult;
}): AgentVerificationResult {
  const candidate = input.collected.candidate;
  const payload = candidate.payload;
  let result: AgentAuthoringResult;
  try {
    result = assertAgentAuthoringResult(record(payload) ? payload.authoringResult : undefined);
    const inspection = inspectAuthoredAgentDefinition({
      brief: parseTask(input.context).authoringBrief,
      candidate: result.candidate,
      evalCorpus: result.evalCorpus,
    });
    if (
      inspection.valid !== result.validation.valid ||
      JSON.stringify(inspection.issues) !== JSON.stringify(result.validation.issues)
    ) {
      throw new Error('Agent authoring validation projection drifted');
    }
  } catch (error) {
    return {
      status: 'failed',
      code: 'agent-authoring-result-invalid',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const kinds = new Set(candidate.evidence.map((evidence) => evidence.kind));
  if (
    candidate.contract.ref !== input.context.birth.resultContract.ref ||
    candidate.contract.hash !== input.context.birth.resultContract.hash ||
    candidate.resultId !== result.resultId ||
    candidate.proposedEffects.length > 0 ||
    !kinds.has('agent-definition-source-parse') ||
    !kinds.has('agent-definition-non-eval-invariants') ||
    !kinds.has('agent-definition-eval-corpus-proposed') ||
    !kinds.has('agent-definition-draft-only')
  ) {
    return {
      status: 'failed',
      code: 'agent-authoring-governance-invalid',
      reason: 'Agent-authored result lacks mechanical Draft-only evidence',
    };
  }
  return { status: 'succeeded', result: candidate };
}

async function defaultCallback(input: AgentAuthoringCallbackInput): Promise<void> {
  const response = await fetch(`${input.baseUrl}/api/internal/agent-run-callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ui4a-capability-token': input.token },
    body: JSON.stringify({ runId: input.runId, outcome: input.outcome }),
  });
  if (!response.ok) throw new Error(`Agent authoring callback failed: HTTP ${response.status}`);
}

export async function finalizeAgentAuthoringRunWithDeps(
  input: AgentFinalizeInput,
  deps: AgentAuthoringAdapterDeps,
): Promise<void> {
  let run = await currentRun(deps.db, input.context);
  if (!['succeeded', 'failed', 'cancelled', 'stale'].includes(run.status)) {
    run = await command(deps, input.context, (current) => {
      const base = {
        runId: input.context.runId,
        expectedRevision: current.revision,
        commandId: input.idempotencyKey,
        eventId: `event:${input.idempotencyKey}`,
      };
      if (input.outcome.status === 'succeeded') {
        return { ...base, kind: 'succeed', result: input.outcome.result };
      }
      if (input.outcome.status === 'cancelled') {
        return { ...base, kind: 'cancel', reason: input.outcome.reason };
      }
      return { ...base, kind: 'fail', code: input.outcome.code, reason: input.outcome.reason };
    });
  }
  const callback = deps.callback ?? defaultCallback;
  const baseUrl = deps.callbackBaseUrl ?? process.env.UI4A_PUBLIC_BASE_URL;
  const token = deps.callbackToken ?? process.env.UI4A_CAPABILITY_CALLBACK_TOKEN;
  if (
    deps.callback === undefined &&
    (baseUrl === undefined || token === undefined || token === '')
  ) {
    throw new Error('Agent authoring callback configuration is missing');
  }
  await callback({
    baseUrl: baseUrl ?? '',
    token: token ?? '',
    runId: run.runId,
    outcome: input.outcome,
  });
}
