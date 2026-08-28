import { isAbsolute, join, resolve } from 'node:path';

import {
  canonicalJson,
  hashCanonicalAgentJson,
  type AgentRun,
  type AgentRunCommand,
  type AgentRunJson,
} from '@ui4a/engine';
import {
  assertAgentAuthoringBrief,
  assertAgentAuthoringResult,
  type AgentAuthoringBrief,
  type AgentAuthoringResult,
} from '@ui4a/shared';

import {
  appendAgentRunCommand,
  appendAgentRunRawEvent,
  getAgentRun,
  listAgentRunRawReceipts,
} from '@ui4a/db/agent-runs';
import type { AgentRunWorkflowArgs } from '../host/contracts';
import { inspectAuthoredAgentDefinition } from './validate';
import {
  asJson,
  record,
  type AgentAuthoringAdapterDeps,
  type AgentAuthoringProfile,
  type AuthoringCompletedState,
  type AuthoringPreparedState,
  type AuthoringProviderClaim,
  type AuthoringTaskPayload,
  type CompiledMessage,
} from './adapter-types';

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

export function parseTask(context: AgentRunWorkflowArgs): AuthoringTaskPayload {
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

export function profileFor(
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

export async function currentRun(
  db: AgentAuthoringAdapterDeps['db'],
  context: AgentRunWorkflowArgs,
): Promise<AgentRun> {
  const run = await getAgentRun(db, context.runId, context.principal, context.policyScope);
  if (run === undefined) throw new Error('Agent authoring Run is missing or unauthorized');
  return run;
}

export async function command(
  deps: AgentAuthoringAdapterDeps,
  context: AgentRunWorkflowArgs,
  build: (run: AgentRun) => AgentRunCommand,
): Promise<AgentRun> {
  return (await appendAgentRunCommand(deps.db, build(await currentRun(deps.db, context))))
    .aggregate;
}

export function safeRuntimeDirectory(root: string, runId: string): string {
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

export function parsePrepared(value: AgentRunJson): AuthoringPreparedState {
  if (
    !record(value) ||
    value.kind !== 'agent-definition-authoring-prepared' ||
    typeof value.workingDirectory !== 'string'
  ) {
    throw new Error('Agent authoring prepared state is invalid');
  }
  return value as unknown as AuthoringPreparedState;
}

export function parseCompleted(value: AgentRunJson): AuthoringCompletedState {
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

export async function rawStats(deps: AgentAuthoringAdapterDeps, runId: string) {
  const receipts = await listAgentRunRawReceipts(deps.db, runId);
  return {
    count: receipts.length,
    bytes: receipts.reduce((sum, receipt) => sum + Number(receipt.byteLength ?? 0), 0),
    maxOrdinal: receipts.reduce((max, receipt) => Math.max(max, Number(receipt.ordinal ?? 0)), 0),
  };
}

export async function appendRaw(
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
