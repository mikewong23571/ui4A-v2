import {
  hashCanonicalAgentJson,
  type AgentRun,
  type AgentRunCommand,
  type AgentRunJson,
} from '@ui4a/engine';
import { assertWritingBrief, assertWritingResult } from '@ui4a/shared';

import { appendAgentRunCommand, getAgentRun } from '@ui4a/db/agent-runs';
import type { AgentPreparedResult, AgentRunWorkflowArgs } from '../host/contracts';
import {
  record,
  type CompiledMessage,
  type DocumentAgentProfile,
  type WritingAgentAdapterDeps,
  type WritingCompletedState,
  type WritingPreparedState,
  type WritingTaskPayload,
} from './adapter-types';

export function parseTask(context: AgentRunWorkflowArgs): WritingTaskPayload {
  const payload = context.task.payload;
  if (!record(payload) || payload.kind !== 'writing-task') {
    throw new Error('writing-agent adapter requires task.payload.kind=writing-task');
  }
  const writingBrief = assertWritingBrief(payload.writingBrief);
  if (!record(payload.compiledPrompt) || typeof payload.compiledPrompt.compiledHash !== 'string') {
    throw new Error('writing-agent compiled Prompt is missing');
  }
  if (payload.compiledPrompt.compiledHash !== context.birth.prompt.compiledHash) {
    throw new Error('writing-agent compiled Prompt hash does not match Run birth provenance');
  }
  if (
    !Array.isArray(payload.compiledPrompt.messages) ||
    payload.compiledPrompt.messages.length === 0 ||
    payload.compiledPrompt.messages.some(
      (message) =>
        !record(message) ||
        typeof message.blockId !== 'string' ||
        !['system', 'user', 'assistant'].includes(String(message.role)) ||
        typeof message.content !== 'string' ||
        typeof message.sealed !== 'boolean',
    )
  ) {
    throw new Error('writing-agent compiled Prompt messages are invalid');
  }
  const messages = payload.compiledPrompt.messages as unknown as CompiledMessage[];
  if (
    hashCanonicalAgentJson(messages as unknown as AgentRunJson) !==
    payload.compiledPrompt.compiledHash
  ) {
    throw new Error('writing-agent compiled Prompt messages failed their birth-pinned hash');
  }
  return {
    kind: 'writing-task',
    writingBrief,
    compiledPrompt: { compiledHash: payload.compiledPrompt.compiledHash, messages },
  };
}

export function profileFor(
  context: AgentRunWorkflowArgs,
  profiles: DocumentAgentProfile[],
): DocumentAgentProfile {
  const matches = profiles.filter((profile) => profile.name === context.birth.runtime.profileName);
  if (matches.length !== 1)
    throw new Error(
      `document-agent profile ${context.birth.runtime.profileName} must resolve exactly once`,
    );
  const profile = matches[0]!;
  if (profile.runtimeClass !== 'document-agent')
    throw new Error('document-agent runtime class mismatch');
  if (profile.providerId !== 'codex')
    throw new Error(`document-agent Provider ${profile.providerId} is unavailable`);
  if (profile.artifactBackend !== 'isolated-document-workspace')
    throw new Error('document-agent requires isolated-document-workspace');
  if (profile.networkPolicy !== 'none')
    throw new Error('writing-agent@1 requires networkPolicy=none');
  return profile;
}

/** Parse deployment configuration without a default/fallback profile. */
export function parseDocumentAgentProfiles(raw: string): DocumentAgentProfile[] {
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) throw new Error('UI4A_DOCUMENT_AGENT_PROFILES must be an array');
  return value.map((profile, index) => {
    if (!record(profile)) throw new Error(`document-agent profile ${index} must be an object`);
    const candidate = profile as unknown as DocumentAgentProfile;
    if (
      typeof candidate.name !== 'string' ||
      candidate.runtimeClass !== 'document-agent' ||
      candidate.transport !== 'sdk' ||
      typeof candidate.providerId !== 'string' ||
      typeof candidate.model !== 'string' ||
      typeof candidate.apiKeyEnv !== 'string' ||
      candidate.artifactBackend !== 'isolated-document-workspace' ||
      !Number.isSafeInteger(candidate.timeoutSeconds) ||
      candidate.timeoutSeconds <= 0 ||
      !Number.isSafeInteger(candidate.maxTurns) ||
      candidate.maxTurns <= 0 ||
      !Array.isArray(candidate.envAllowlist) ||
      candidate.envAllowlist.some((entry) => typeof entry !== 'string') ||
      (candidate.networkPolicy !== 'none' && candidate.networkPolicy !== 'source-only')
    ) {
      throw new Error(`document-agent profile ${index} is invalid`);
    }
    return candidate;
  });
}

export async function currentRun(
  db: WritingAgentAdapterDeps['db'],
  context: AgentRunWorkflowArgs,
): Promise<AgentRun> {
  const run = await getAgentRun(db, context.runId, context.principal, context.policyScope);
  if (run === undefined)
    throw new Error('native writing Agent Run does not exist or is not authorized');
  return run;
}

export async function command(
  deps: WritingAgentAdapterDeps,
  context: AgentRunWorkflowArgs,
  build: (run: AgentRun) => AgentRunCommand,
): Promise<AgentRun> {
  const run = await currentRun(deps.db, context);
  return (await appendAgentRunCommand(deps.db, build(run))).aggregate;
}

export function parsePrepared(value: AgentRunJson): WritingPreparedState {
  if (!record(value) || value.kind !== 'writing-agent-prepared' || !record(value.workspace)) {
    throw new Error('writing-agent prepared state is invalid');
  }
  return value as unknown as WritingPreparedState;
}

/** Read the mechanically prepared per-Run workspace for sealed remote Runtime delivery. */
export function writingPreparedWorkspaceRoot(prepared: AgentPreparedResult): string {
  return parsePrepared(prepared.state).workspace.workingDirectory;
}

export function parseCompleted(value: AgentRunJson): WritingCompletedState {
  if (
    !record(value) ||
    value.kind !== 'writing-agent-completed' ||
    !record(value.workspace) ||
    typeof value.nativeSessionId !== 'string' ||
    !record(value.claim)
  ) {
    throw new Error('writing-agent completed state is invalid');
  }
  return { ...value, claim: assertWritingResult(value.claim) } as unknown as WritingCompletedState;
}
