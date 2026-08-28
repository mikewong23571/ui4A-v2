import { createHash } from 'node:crypto';

import { canonicalJson } from '@ui4a/engine';

import type { DbExecutor } from '@ui4a/db/events';
import { appendEvent } from '@ui4a/db/events';

import { findEvent } from './event-log';

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
 * capability runner 的持久化边界。模型调用发生在 activity adapter 外层;
 * 本函数把已验证输出物化为 append-only artifact,重试按 artifact rel 幂等。
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
