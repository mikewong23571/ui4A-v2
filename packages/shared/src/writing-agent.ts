/** Wire schema version for the source-grounded Writing Agent specialization. */
export const WRITING_AGENT_SCHEMA_VERSION = 1 as const;

/** Hard specialization ceilings. Deployments and activated definitions may only tighten them. */
export const WRITING_AGENT_LIMITS = {
  maxBriefBytes: 512 * 1024,
  maxSources: 64,
  maxSourceBytes: 128 * 1024,
  maxTotalSourceBytes: 2 * 1024 * 1024,
  maxRequiredSections: 32,
  maxConstraints: 128,
  maxAllowedOutputPaths: 16,
  maxArtifactBytes: 2 * 1024 * 1024,
  maxCitations: 512,
  maxRawEvents: 2_000,
  maxRawBytes: 4 * 1024 * 1024,
  maxRawChunkBytes: 64 * 1024,
} as const;

export type WritingAgentSchemaVersion = typeof WRITING_AGENT_SCHEMA_VERSION;
export type WritingContentHash = `sha256:${string}`;

export interface WritingSource {
  id: string;
  title: string;
  mediaType: 'text/plain' | 'text/markdown' | 'application/json';
  content: string;
  hash: WritingContentHash;
}

export interface WritingCitationPolicy {
  style: 'paragraph-markers';
  requireEveryFactualParagraph: boolean;
}

export interface WritingBudget {
  timeoutSeconds: number;
  maxTurns: number;
  maxRawEvents: number;
  maxRawBytes: number;
  maxRawChunkBytes: number;
}

/** Source-grounded task contract. Source content is task data, never a writable workspace file. */
export interface WritingBrief {
  schemaVersion: WritingAgentSchemaVersion;
  objective: string;
  audience: string;
  format: 'markdown';
  requiredSections: string[];
  constraints: string[];
  allowedOutputPaths: string[];
  sources: WritingSource[];
  citationPolicy: WritingCitationPolicy;
  budget: WritingBudget;
}

export interface WritingArtifact {
  path: string;
  hash: WritingContentHash;
  sizeBytes: number;
  mediaType: 'text/markdown';
}

export interface WritingCitation {
  sourceId: string;
  sourceHash: WritingContentHash;
  /** One-based factual paragraph indexes in the produced Markdown artifact. */
  paragraphs: number[];
  claims: string[];
}

export interface WritingSafetyClaims {
  sourceInputsUnchanged: boolean;
  onlyAllowedOutputs: boolean;
  noRepositoryEffects: boolean;
  noNetworkEffects: boolean;
  noPublishEffects: boolean;
}

/** Provider claim. Independent workspace/source/artifact/render verification remains authoritative. */
export interface WritingResult {
  schemaVersion: WritingAgentSchemaVersion;
  resultId: string;
  status: 'completed' | 'failed';
  summary: string;
  artifact: WritingArtifact;
  citations: WritingCitation[];
  safety: WritingSafetyClaims;
}

const hashPattern = /^sha256:[a-f0-9]{64}$/u;
const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
}

function stringList(value: unknown, label: string, maximum: number): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((item) => typeof item !== 'string' || item.trim() === '')
  ) {
    throw new Error(`${label} must be a bounded non-empty string list`);
  }
}

function relativeOutputPath(value: string, label: string): void {
  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..') ||
    !value.startsWith('out/')
  ) {
    throw new Error(`${label} must be a relative path beneath out/`);
  }
}

function positiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${label} must be positive`);
}

function assertHash(value: unknown, label: string): asserts value is WritingContentHash {
  if (typeof value !== 'string' || !hashPattern.test(value))
    throw new Error(`${label} hash is invalid`);
}

/** Parse one untrusted brief without performing the Node-side source-content hash verification. */
export function assertWritingBrief(value: unknown): WritingBrief {
  if (!record(value) || value.schemaVersion !== WRITING_AGENT_SCHEMA_VERSION) {
    throw new Error('writing brief must use schemaVersion 1');
  }
  nonEmpty(value.objective, 'writing brief objective');
  nonEmpty(value.audience, 'writing brief audience');
  if (value.format !== 'markdown') throw new Error('writing brief format must be markdown');
  stringList(value.requiredSections, 'requiredSections', WRITING_AGENT_LIMITS.maxRequiredSections);
  stringList(value.constraints, 'constraints', WRITING_AGENT_LIMITS.maxConstraints);
  stringList(
    value.allowedOutputPaths,
    'allowedOutputPaths',
    WRITING_AGENT_LIMITS.maxAllowedOutputPaths,
  );
  if (value.allowedOutputPaths.length === 0)
    throw new Error('at least one allowed output path is required');
  for (const path of value.allowedOutputPaths) relativeOutputPath(path, 'allowed output path');
  if (new Set(value.allowedOutputPaths).size !== value.allowedOutputPaths.length) {
    throw new Error('duplicate allowed output path');
  }
  if (
    !Array.isArray(value.sources) ||
    value.sources.length === 0 ||
    value.sources.length > WRITING_AGENT_LIMITS.maxSources
  ) {
    throw new Error('writing brief sources must be non-empty and bounded');
  }
  let totalSourceBytes = 0;
  const sourceIds = new Set<string>();
  for (const candidate of value.sources) {
    if (!record(candidate)) throw new Error('writing source is invalid');
    nonEmpty(candidate.id, 'writing source id');
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(candidate.id))
      throw new Error(`source ${candidate.id} id is invalid`);
    if (sourceIds.has(candidate.id)) throw new Error(`duplicate source ${candidate.id}`);
    sourceIds.add(candidate.id);
    nonEmpty(candidate.title, `source ${candidate.id} title`);
    if (
      !['text/plain', 'text/markdown', 'application/json'].includes(String(candidate.mediaType))
    ) {
      throw new Error(`source ${candidate.id} mediaType is invalid`);
    }
    if (typeof candidate.content !== 'string')
      throw new Error(`source ${candidate.id} content is invalid`);
    const sourceBytes = bytes(candidate.content);
    if (sourceBytes > WRITING_AGENT_LIMITS.maxSourceBytes)
      throw new Error(`source ${candidate.id} exceeds size limit`);
    totalSourceBytes += sourceBytes;
    assertHash(candidate.hash, `source ${candidate.id}`);
  }
  if (totalSourceBytes > WRITING_AGENT_LIMITS.maxTotalSourceBytes)
    throw new Error('writing sources exceed total size limit');
  if (
    !record(value.citationPolicy) ||
    value.citationPolicy.style !== 'paragraph-markers' ||
    typeof value.citationPolicy.requireEveryFactualParagraph !== 'boolean'
  ) {
    throw new Error('citation policy is invalid');
  }
  if (!record(value.budget)) throw new Error('writing budget is invalid');
  positiveInteger(value.budget.timeoutSeconds, 'writing budget timeoutSeconds');
  positiveInteger(value.budget.maxTurns, 'writing budget maxTurns');
  positiveInteger(value.budget.maxRawEvents, 'writing budget maxRawEvents');
  positiveInteger(value.budget.maxRawBytes, 'writing budget maxRawBytes');
  positiveInteger(value.budget.maxRawChunkBytes, 'writing budget maxRawChunkBytes');
  if (
    Number(value.budget.maxRawEvents) > WRITING_AGENT_LIMITS.maxRawEvents ||
    Number(value.budget.maxRawBytes) > WRITING_AGENT_LIMITS.maxRawBytes ||
    Number(value.budget.maxRawChunkBytes) > WRITING_AGENT_LIMITS.maxRawChunkBytes
  ) {
    throw new Error('writing budget exceeds protocol limits');
  }
  if (bytes(JSON.stringify(value)) > WRITING_AGENT_LIMITS.maxBriefBytes)
    throw new Error('writing brief exceeds size limit');
  return value as unknown as WritingBrief;
}

/** Parse one provider WritingResult claim before independent verification. */
export function assertWritingResult(value: unknown): WritingResult {
  if (!record(value) || value.schemaVersion !== WRITING_AGENT_SCHEMA_VERSION)
    throw new Error('writing result must use schemaVersion 1');
  nonEmpty(value.resultId, 'writing result id');
  if (value.status !== 'completed' && value.status !== 'failed')
    throw new Error('writing result status is invalid');
  nonEmpty(value.summary, 'writing result summary');
  if (!record(value.artifact)) throw new Error('writing result artifact is invalid');
  nonEmpty(value.artifact.path, 'writing artifact path');
  relativeOutputPath(value.artifact.path, 'writing artifact path');
  assertHash(value.artifact.hash, 'writing artifact');
  positiveInteger(value.artifact.sizeBytes, 'writing artifact sizeBytes');
  if (Number(value.artifact.sizeBytes) > WRITING_AGENT_LIMITS.maxArtifactBytes)
    throw new Error('writing artifact exceeds size limit');
  if (value.artifact.mediaType !== 'text/markdown')
    throw new Error('writing artifact mediaType is invalid');
  if (!Array.isArray(value.citations) || value.citations.length > WRITING_AGENT_LIMITS.maxCitations)
    throw new Error('writing citations are invalid');
  for (const citation of value.citations) {
    if (!record(citation)) throw new Error('writing citation is invalid');
    nonEmpty(citation.sourceId, 'writing citation sourceId');
    assertHash(citation.sourceHash, `citation ${citation.sourceId}`);
    if (
      !Array.isArray(citation.paragraphs) ||
      citation.paragraphs.some(
        (paragraph) => !Number.isInteger(paragraph) || Number(paragraph) <= 0,
      )
    ) {
      throw new Error(`citation ${citation.sourceId} paragraph indexes are invalid`);
    }
    stringList(
      citation.claims,
      `citation ${citation.sourceId} claims`,
      WRITING_AGENT_LIMITS.maxCitations,
    );
  }
  const safetyKeys = [
    'sourceInputsUnchanged',
    'onlyAllowedOutputs',
    'noRepositoryEffects',
    'noNetworkEffects',
    'noPublishEffects',
  ] as const;
  const safety = value.safety;
  if (
    !record(safety) ||
    Object.keys(safety).length !== safetyKeys.length ||
    safetyKeys.some((key) => safety[key] !== true)
  ) {
    throw new Error('writing result safety claims must all be true');
  }
  return value as unknown as WritingResult;
}
