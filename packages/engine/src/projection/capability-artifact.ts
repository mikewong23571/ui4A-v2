import type { CapabilityArtifactSnapshot, EngineSnapshot } from '@ui4a/shared';

/** capability worker 写入日志的完整、可重放 artifact 载荷。 */
export interface CapabilityArtifactCreatedDetail {
  id: string;
  capability: string;
  source: { rel: string; field: string };
  model: string;
  outputSchema: Record<string, unknown>;
  content: unknown;
  contentHash: string;
  createdBy: { actor: 'human' | 'agent'; principal?: string };
}

export function artifactRel(id: string): string {
  return `artifact:${id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDetail(value: unknown): CapabilityArtifactCreatedDetail {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.createdBy)) {
    throw new Error('capability-artifact-created 缺少结构化 detail');
  }
  const requiredStrings = [
    value.id,
    value.capability,
    value.source.rel,
    value.source.field,
    value.model,
    value.contentHash,
    value.createdBy.actor,
  ];
  if (requiredStrings.some((candidate) => typeof candidate !== 'string' || candidate === '')) {
    throw new Error('capability-artifact-created detail 含空 provenance 字段');
  }
  if (!isRecord(value.outputSchema)) {
    throw new Error('capability-artifact-created outputSchema 必须是对象');
  }
  return value as unknown as CapabilityArtifactCreatedDetail;
}

/** 物化正式工件；同 rel 同内容幂等，冲突内容响亮失败。 */
export function applyCapabilityArtifactCreated(
  snapshot: EngineSnapshot,
  event: { seq: number; kind?: string; rel?: string; actor?: unknown; detail?: unknown },
): EngineSnapshot {
  const detail = parseDetail(event.detail);
  const rel = artifactRel(detail.id);
  if (event.rel !== rel) {
    throw new Error(`capability-artifact-created rel 必须为 "${rel}"`);
  }
  if (
    snapshot.capabilities !== undefined &&
    snapshot.capabilities[detail.capability] === undefined
  ) {
    throw new Error(`capability-artifact-created 引用了未注册能力 "${detail.capability}"`);
  }
  if (snapshot.instances[detail.source.rel]?.fields[detail.source.field] === undefined) {
    throw new Error(
      `capability-artifact-created 来源不存在:${detail.source.rel}#${detail.source.field}`,
    );
  }
  const artifact: CapabilityArtifactSnapshot = { rel, ...detail };
  const existing = snapshot.artifacts?.[rel];
  if (existing !== undefined) {
    if (JSON.stringify(existing) !== JSON.stringify(artifact)) {
      throw new Error(`capability artifact "${rel}" 已存在且内容冲突(seq=${event.seq})`);
    }
    return snapshot;
  }
  return { ...snapshot, artifacts: { ...(snapshot.artifacts ?? {}), [rel]: artifact } };
}
