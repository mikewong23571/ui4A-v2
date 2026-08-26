import type { FactRef } from '@ui4a/agent';

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
