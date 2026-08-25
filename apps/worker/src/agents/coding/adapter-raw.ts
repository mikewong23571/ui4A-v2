import { canonicalJson, type AgentRunJson } from '@ui4a/engine';
import type { CodingNormalizedEvent, CodingTask } from '@ui4a/shared';

import {
  appendAgentRunRawEvent,
  listAgentRunRawReceipts,
  readAgentRunPayload,
} from '../../../../web/src/db/agent-runs';
import type { AgentRunWorkflowArgs } from '../host/contracts';
import { record, type CodingAgentAdapterDeps } from './adapter-types';

export function jsonSafe(value: unknown): AgentRunJson {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value !== 'object') return String(value);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
}

function redactPayload(value: unknown, task: CodingTask, workspacePath: string): AgentRunJson {
  const secrets = new Set(task.redaction.secretNames);
  const secretValues = task.redaction.secretNames
    .map((name) => process.env[name])
    .filter((item): item is string => item !== undefined && item !== '');
  const walk = (child: AgentRunJson): AgentRunJson => {
    if (typeof child === 'string') {
      let output = child;
      for (const secret of secretValues) output = output.replaceAll(secret, '[REDACTED]');
      if (task.redaction.redactHostPaths) output = output.replaceAll(workspacePath, '[WORKSPACE]');
      return output;
    }
    if (Array.isArray(child)) return child.map(walk);
    if (child === null || typeof child !== 'object') return child;
    return Object.fromEntries(
      Object.entries(child).map(([key, nested]) => [
        key,
        secrets.has(key) ? '[REDACTED]' : walk(nested),
      ]),
    );
  };
  return walk(jsonSafe(value));
}

export async function rawStats(deps: CodingAgentAdapterDeps, runId: string) {
  const receipts = await listAgentRunRawReceipts(deps.db, runId);
  return {
    count: receipts.length,
    bytes: receipts.reduce((sum, receipt) => sum + Number(receipt.byteLength ?? 0), 0),
    maxOrdinal: receipts.reduce((max, receipt) => Math.max(max, Number(receipt.ordinal ?? 0)), 0),
  };
}

export async function appendBoundedRaw(
  deps: CodingAgentAdapterDeps,
  context: AgentRunWorkflowArgs,
  task: CodingTask,
  workspacePath: string,
  ordinal: number,
  cursor: string,
  payload: unknown,
): Promise<void> {
  const redactedPayload = redactPayload(payload, task, workspacePath);
  const bytes = new TextEncoder().encode(canonicalJson(redactedPayload)).byteLength;
  const stats = await rawStats(deps, context.runId);
  if (ordinal !== stats.maxOrdinal + 1) throw new Error('coding-agent raw ordinal conflict');
  if (stats.count >= task.budget.maxRawEvents)
    throw new Error('coding-agent raw event budget exhausted');
  if (bytes > task.budget.maxRawChunkBytes)
    throw new Error('coding-agent raw chunk budget exceeded');
  if (stats.bytes + bytes > task.budget.maxRawBytes) {
    throw new Error('coding-agent raw byte budget exhausted');
  }
  await appendAgentRunRawEvent(deps.db, {
    runId: context.runId,
    principal: context.principal,
    policyScope: context.policyScope,
    ordinal,
    cursor,
    redactedPayload,
  });
}

export function testRunsFromEvents(events: CodingNormalizedEvent[], claimed: string[]) {
  const started = new Map<string, string>();
  const completed = new Map<string, number>();
  for (const event of events) {
    if (event.kind === 'command-started') started.set(event.commandId, event.summary);
    if (event.kind === 'command-completed') completed.set(event.commandId, event.exitCode);
  }
  return claimed.map((claimedCommand) => {
    const commandPrefix = claimedCommand
      .split(/\s+(?:—|–|-)\s+|:|\s+(?:passes|passed)\b|\s+\(/iu, 1)[0]!
      .trim();
    const match = [...started].find(
      ([, command]) =>
        command.includes(claimedCommand) ||
        (commandPrefix.length >= 3 && command.includes(commandPrefix)),
    );
    const exitCode = match === undefined ? 1 : (completed.get(match[0]) ?? 1);
    return { command: match?.[1] ?? claimedCommand, exitCode, passed: exitCode === 0 };
  });
}

export async function persistedNormalizedEvents(
  deps: CodingAgentAdapterDeps,
  runId: string,
): Promise<CodingNormalizedEvent[]> {
  const receipts = await listAgentRunRawReceipts(deps.db, runId);
  const events: CodingNormalizedEvent[] = [];
  for (const receipt of receipts) {
    const payload = await readAgentRunPayload(deps.db, String(receipt.payloadRef));
    if (record(payload) && payload.kind === 'coding-normalized' && record(payload.event)) {
      events.push(payload.event as unknown as CodingNormalizedEvent);
    }
  }
  return events;
}
