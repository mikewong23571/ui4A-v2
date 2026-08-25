import type { AgentRunJson } from '@ui4a/engine';
import type { AgentAuthoringBrief, AgentAuthoringResult, JsonObject } from '@ui4a/shared';

import type { ConnectableDb } from '../../../../web/src/db/agent-runs';
import type { executeCodexStructured } from '../host/codex-transport';
import type { AgentFinalizeInput } from '../host/contracts';

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

export interface AuthoringProviderClaim {
  status: 'completed' | 'failed';
  summary: string;
  candidate: JsonObject;
  examples: AgentAuthoringResult['examples'];
  evalCorpus: AgentAuthoringResult['evalCorpus'];
  safety: AgentAuthoringResult['safety'];
}

export type CompiledMessage = {
  blockId: string;
  role: 'system' | 'user' | 'assistant';
  purpose: string;
  content: string;
  sealed: boolean;
};

export interface AuthoringTaskPayload {
  kind: 'agent-definition-authoring-task';
  authoringBrief: AgentAuthoringBrief;
  compiledPrompt: { compiledHash: string; messages: CompiledMessage[] };
}

export interface AuthoringPreparedState {
  kind: 'agent-definition-authoring-prepared';
  workingDirectory: string;
}

export interface AuthoringCompletedState {
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

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asJson(value: unknown): AgentRunJson {
  return JSON.parse(JSON.stringify(value)) as AgentRunJson;
}
