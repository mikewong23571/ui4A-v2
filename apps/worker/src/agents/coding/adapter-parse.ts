import { join } from 'node:path';

import {
  hashCanonicalAgentJson,
  type AgentRun,
  type AgentRunCommand,
  type AgentRunJson,
} from '@ui4a/engine';
import type { CodingTask, WorkspaceHandle } from '@ui4a/shared';

import { appendAgentRunCommand, getAgentRun } from '@ui4a/db/agent-runs';
import type { GitWorkspaceHandle, RepositoryRegistry } from '../../capabilities/coding/workspace';
import type { AgentRunWorkflowArgs } from '../host/contracts';
import {
  record,
  strings,
  type CodingAgentAdapterDeps,
  type CodingAgentTaskPayload,
  type CodingCompletedState,
  type CodingPreparedState,
  type CodingPromptMessage,
} from './adapter-types';

function codingTask(value: unknown): CodingTask {
  if (!record(value)) throw new Error('coding-agent task is missing codingTask');
  if (
    value.schemaVersion !== 1 ||
    typeof value.repositoryRef !== 'string' ||
    typeof value.baseRevision !== 'string' ||
    typeof value.goal !== 'string' ||
    !strings(value.constraints) ||
    !strings(value.acceptanceCriteria) ||
    !strings(value.allowedPaths) ||
    !record(value.budget) ||
    !record(value.redaction)
  ) {
    throw new Error('coding-agent codingTask does not match CodingTask@1');
  }
  return value as unknown as CodingTask;
}

export function parseTask(context: AgentRunWorkflowArgs): CodingAgentTaskPayload {
  const payload = context.task.payload;
  if (!record(payload) || payload.kind !== 'coding-task') {
    throw new Error('coding-agent adapter requires task.payload.kind=coding-task');
  }
  if (!record(payload.compiledPrompt)) throw new Error('coding-agent compiled Prompt is missing');
  if (
    typeof payload.compiledPrompt.compiledHash !== 'string' ||
    payload.compiledPrompt.compiledHash !== context.birth.prompt.compiledHash
  ) {
    throw new Error('coding-agent compiled Prompt hash does not match Run birth provenance');
  }
  if (
    !Array.isArray(payload.compiledPrompt.messages) ||
    payload.compiledPrompt.messages.length === 0 ||
    payload.compiledPrompt.messages.some(
      (message) =>
        !record(message) ||
        !['system', 'user', 'assistant'].includes(String(message.role)) ||
        typeof message.content !== 'string' ||
        typeof message.blockId !== 'string' ||
        typeof message.purpose !== 'string' ||
        typeof message.sealed !== 'boolean',
    )
  ) {
    throw new Error('coding-agent compiled Prompt messages are invalid');
  }
  const messages = payload.compiledPrompt.messages as unknown as CodingPromptMessage[];
  if (
    hashCanonicalAgentJson(messages as unknown as AgentRunJson) !==
    context.birth.prompt.compiledHash
  ) {
    throw new Error('coding-agent compiled Prompt messages failed their birth-pinned hash');
  }
  return {
    kind: 'coding-task',
    codingTask: codingTask(payload.codingTask),
    compiledPrompt: {
      compiledHash: payload.compiledPrompt.compiledHash,
      messages,
    },
  };
}

export function profileFor(
  context: AgentRunWorkflowArgs,
  profiles: CodingAgentAdapterDeps['profiles'],
) {
  const profileName = context.birth.runtime.profileName;
  const matches = profiles.filter((candidate) => candidate.name === profileName);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `coding executor profile ${profileName} is missing`
        : `coding executor profile ${profileName} is ambiguous`,
    );
  }
  const profile = matches[0]!;
  if (profile.executorClass !== 'coding-agent') {
    throw new Error(`runtime profile ${profileName} is not a coding-agent profile`);
  }
  if (profile.providerId !== 'codex') {
    throw new Error(`coding executor provider ${profile.providerId} is unavailable`);
  }
  if (profile.sandbox !== 'workspace-write') {
    throw new Error('coding-agent requires the server-owned workspace-write sandbox');
  }
  return profile;
}

export async function currentRun(
  db: CodingAgentAdapterDeps['db'],
  context: AgentRunWorkflowArgs,
): Promise<AgentRun> {
  const run = await getAgentRun(db, context.runId, context.principal, context.policyScope);
  if (run === undefined) throw new Error('native agent run does not exist or is not authorized');
  return run;
}

export async function command(
  deps: CodingAgentAdapterDeps,
  context: AgentRunWorkflowArgs,
  build: (run: AgentRun) => AgentRunCommand,
): Promise<AgentRun> {
  const run = await currentRun(deps.db, context);
  return (await appendAgentRunCommand(deps.db, build(run))).aggregate;
}

export function sharedWorkspace(
  handle: GitWorkspaceHandle,
  allowedPaths: string[],
): WorkspaceHandle {
  return {
    schemaVersion: 1,
    workspaceId: handle.id,
    repositoryRef: handle.repositoryRef,
    baseRevision: handle.baseRevision,
    branch: handle.branch,
    leaseId: `lease:${handle.id}`,
    allowedPaths,
    mainCheckoutFingerprint: handle.mainCheckoutFingerprint,
  };
}

export function parsePrepared(value: AgentRunJson): CodingPreparedState {
  if (!record(value) || value.kind !== 'coding-agent-prepared' || !record(value.workspace)) {
    throw new Error('coding-agent prepared state is invalid');
  }
  return value as unknown as CodingPreparedState;
}

export function parseCompleted(value: AgentRunJson): CodingCompletedState {
  if (
    !record(value) ||
    value.kind !== 'coding-agent-completed' ||
    !record(value.workspace) ||
    typeof value.nativeSessionId !== 'string' ||
    !record(value.claim)
  ) {
    throw new Error('coding-agent completed state is invalid');
  }
  return value as unknown as CodingCompletedState;
}

export function internalWorkspace(
  context: AgentRunWorkflowArgs,
  workspace: WorkspaceHandle,
  registry: RepositoryRegistry,
  workspaceRoot: string,
): GitWorkspaceHandle {
  const task = parseTask(context).codingTask;
  const entry = registry[task.repositoryRef];
  if (entry === undefined) throw new Error('repository disappeared from the server registry');
  return {
    id: workspace.workspaceId,
    repositoryRef: workspace.repositoryRef,
    repositoryPath: entry.path,
    path: join(workspaceRoot, context.runId),
    branch: workspace.branch,
    baseRevision: workspace.baseRevision,
    mainCheckoutFingerprint: workspace.mainCheckoutFingerprint,
  };
}

export function assertTaskWithinRegistry(task: CodingTask, registry: RepositoryRegistry): void {
  const entry = registry[task.repositoryRef];
  if (entry === undefined) throw new Error('repositoryRef is not registered');
  for (const path of task.allowedPaths) {
    const allowed = entry.allowedPaths.some(
      (ceiling) => path === ceiling || path.startsWith(`${ceiling}/`),
    );
    if (!allowed) throw new Error(`task allowed path ${path} exceeds repository policy`);
  }
}
