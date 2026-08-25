import type { AgentRunJson } from '@ui4a/engine';
import type { WritingBrief, WritingResult } from '@ui4a/shared';

import type { ConnectableDb } from '../../../../web/src/db/agent-runs';
import type { executeCodexStructured } from '../host/codex-transport';
import type { AgentFinalizeInput } from '../host/contracts';
import type { DocumentWorkspaceHandle } from './workspace';

export interface DocumentAgentProfile {
  name: string;
  runtimeClass: 'document-agent';
  providerId: string;
  transport: 'sdk';
  model: string;
  endpoint?: string;
  apiKeyEnv: string;
  artifactBackend: 'isolated-document-workspace';
  timeoutSeconds: number;
  maxTurns: number;
  envAllowlist: string[];
  networkPolicy: 'none' | 'source-only';
}

export type CompiledMessage = {
  blockId: string;
  role: 'system' | 'user' | 'assistant';
  purpose: string;
  content: string;
  sealed: boolean;
};

export interface WritingTaskPayload {
  kind: 'writing-task';
  writingBrief: WritingBrief;
  compiledPrompt: { compiledHash: string; messages: CompiledMessage[] };
}

export interface WritingPreparedState {
  kind: 'writing-agent-prepared';
  workspace: DocumentWorkspaceHandle;
}

export interface WritingCompletedState {
  kind: 'writing-agent-completed';
  workspace: DocumentWorkspaceHandle;
  nativeSessionId: string;
  claim: WritingResult;
}

export interface WritingAgentCallbackInput {
  baseUrl: string;
  token: string;
  runId: string;
  outcome: AgentFinalizeInput['outcome'];
}

export interface WritingAgentAdapterDeps {
  db: ConnectableDb;
  workspaceRoot: string;
  profiles: DocumentAgentProfile[];
  execute?: typeof executeCodexStructured;
  probe?: () => Promise<{ available: boolean; reason?: string }>;
  callback?: (input: WritingAgentCallbackInput) => Promise<unknown>;
  callbackBaseUrl?: string;
  callbackToken?: string;
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asJson(value: unknown): AgentRunJson {
  return JSON.parse(JSON.stringify(value)) as AgentRunJson;
}
