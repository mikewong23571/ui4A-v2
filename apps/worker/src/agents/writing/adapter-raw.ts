import { canonicalJson, type AgentRunJson } from '@ui4a/engine';
import type { WritingBrief } from '@ui4a/shared';

import {
  appendAgentRunRawEvent,
  listAgentRunRawReceipts,
  readAgentRunPayload,
} from '../../../../web/src/db/agent-runs';
import type { CodexTransportProgress } from '../host/codex-transport';
import type { AgentRunWorkflowArgs } from '../host/contracts';
import { record, type WritingAgentAdapterDeps } from './adapter-types';

export function jsonSafe(value: unknown): AgentRunJson {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value !== 'object') return String(value);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
}

function redactRaw(value: unknown, brief: WritingBrief, workspacePath: string): AgentRunJson {
  const sources = brief.sources.map((source) => [source.content, `[SOURCE:${source.id}]`] as const);
  const walk = (child: AgentRunJson): AgentRunJson => {
    if (typeof child === 'string') {
      let output = child.replaceAll(workspacePath, '[WORKSPACE]');
      for (const [content, replacement] of sources)
        if (content !== '') output = output.replaceAll(content, replacement);
      return output;
    }
    if (Array.isArray(child)) return child.map(walk);
    if (child === null || typeof child !== 'object') return child;
    return Object.fromEntries(Object.entries(child).map(([key, nested]) => [key, walk(nested)]));
  };
  return walk(jsonSafe(value));
}

export async function rawStats(deps: WritingAgentAdapterDeps, runId: string) {
  const receipts = await listAgentRunRawReceipts(deps.db, runId);
  return {
    count: receipts.length,
    bytes: receipts.reduce((sum, receipt) => sum + Number(receipt.byteLength ?? 0), 0),
    maxOrdinal: receipts.reduce((max, receipt) => Math.max(max, Number(receipt.ordinal ?? 0)), 0),
  };
}

export async function appendRaw(
  deps: WritingAgentAdapterDeps,
  context: AgentRunWorkflowArgs,
  brief: WritingBrief,
  workspacePath: string,
  ordinal: number,
  cursor: string,
  value: unknown,
): Promise<void> {
  const payload = redactRaw(value, brief, workspacePath);
  const byteLength = new TextEncoder().encode(canonicalJson(payload)).byteLength;
  const stats = await rawStats(deps, context.runId);
  if (ordinal !== stats.maxOrdinal + 1) throw new Error('writing-agent raw ordinal conflict');
  if (
    stats.count >= brief.budget.maxRawEvents ||
    byteLength > brief.budget.maxRawChunkBytes ||
    stats.bytes + byteLength > brief.budget.maxRawBytes
  ) {
    throw new Error('writing-agent raw trajectory budget exhausted');
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

export async function persistedProgress(
  deps: WritingAgentAdapterDeps,
  runId: string,
): Promise<CodexTransportProgress[]> {
  const progress: CodexTransportProgress[] = [];
  for (const receipt of await listAgentRunRawReceipts(deps.db, runId)) {
    const value = await readAgentRunPayload(deps.db, String(receipt.payloadRef));
    if (record(value) && value.kind === 'writing-progress' && record(value.event))
      progress.push(value.event as unknown as CodexTransportProgress);
  }
  return progress;
}
