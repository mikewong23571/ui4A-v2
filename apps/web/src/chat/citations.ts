import type { FactRef, TrailStep } from '@ui4a/agent';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse canonical FactRefs and deduplicate exact pairs in first-seen order. */
export function parseCitations(value: unknown): FactRef[] {
  if (!Array.isArray(value)) throw new Error('citations must be an array');
  const citations: FactRef[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      Object.keys(candidate).some((key) => key !== 'rel' && key !== 'pointer') ||
      typeof candidate.rel !== 'string' ||
      candidate.rel === '' ||
      typeof candidate.pointer !== 'string' ||
      !candidate.pointer.startsWith('/')
    ) {
      throw new Error('citation must contain only non-empty rel and JSON Pointer');
    }
    const key = `${candidate.rel}\u0000${candidate.pointer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({ rel: candidate.rel, pointer: candidate.pointer });
  }
  return citations;
}

/** Fail closed at untrusted UI/projection boundaries. */
export function citationsOrEmpty(value: unknown): FactRef[] {
  try {
    return parseCitations(value);
  } catch {
    return [];
  }
}

/**
 * 终局引用的确定性退守(T40 F-12):从轨迹 executed 步的动作后实体摘要派生
 * 引用——append 类动作的动作后实体即新实体,引用可直接点进实体页。纯轨迹
 * 数据派生,零模型措辞;导航步不产生动作后果,不收。去重,上限 4。
 */
export function trailEntityRefs(steps: readonly TrailStep[]): FactRef[] {
  const refs: FactRef[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.outcome !== 'executed') continue;
    const rel = step.entity?.rel;
    if (rel === undefined || rel === '' || seen.has(rel)) continue;
    seen.add(rel);
    refs.push({ rel, pointer: '/' });
    if (refs.length >= 4) break;
  }
  return refs;
}

/**
 * 终局消息的引用选择(T40 F-12):LLM sources 优先;缺席时退守轨迹 executed
 * 步派生的实体引用——exec 回合(done 无 sources)的终局消息因此可点进实体页,
 * 且同一派生随 chat-message-appended 持久化,历史重放不丢引用。
 */
export function finalTurnCitations(
  sources: FactRef[] | undefined,
  steps: readonly TrailStep[],
): FactRef[] {
  if (sources !== undefined && sources.length > 0) return sources;
  return trailEntityRefs(steps);
}
