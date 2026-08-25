import type { CodingExecutorProfile, CodingTask, WorkspaceHandle } from '@ui4a/shared';

import type { ConnectableDb } from '../../../../web/src/db/agent-runs';
import type {
  CodexCompiledPrompt,
  CodexExecutionOutput,
  executeCodexTask,
} from '../../capabilities/coding/codex';
import type { AgentFinalizeInput } from '../host/contracts';

export type CodingPromptMessage = CodexCompiledPrompt['messages'][number] & {
  blockId?: string;
  purpose?: string;
  sealed?: boolean;
};

export interface CodingAgentTaskPayload {
  kind: 'coding-task';
  codingTask: CodingTask;
  compiledPrompt: {
    compiledHash: string;
    messages: CodingPromptMessage[];
  };
}

export interface CodingPreparedState {
  kind: 'coding-agent-prepared';
  workspace: WorkspaceHandle;
}

export interface CodingCompletedState {
  kind: 'coding-agent-completed';
  workspace: WorkspaceHandle;
  nativeSessionId: string;
  claim: CodexExecutionOutput['claim'];
}

export interface CodingAgentCallbackInput {
  baseUrl: string;
  token: string;
  runId: string;
  outcome: AgentFinalizeInput['outcome'];
}

export interface CodingAgentAdapterDeps {
  db: ConnectableDb;
  repositoryRegistry: string;
  workspaceRoot: string;
  profiles: CodingExecutorProfile[];
  execute?: typeof executeCodexTask;
  probe?: (profileName: string) => Promise<{ available: boolean; reason?: string }>;
  callback?: (input: CodingAgentCallbackInput) => Promise<unknown>;
  callbackBaseUrl?: string;
  callbackToken?: string;
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
