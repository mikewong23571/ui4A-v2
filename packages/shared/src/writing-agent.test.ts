import { describe, expect, it } from 'vitest';

import {
  WRITING_AGENT_LIMITS,
  WRITING_AGENT_SCHEMA_VERSION,
  assertWritingBrief,
  assertWritingResult,
  type WritingBrief,
  type WritingResult,
} from './writing-agent';

const sourceContent = 'UI4A stores business truth in an append-only event log.';
const sourceHash =
  'sha256:585960c3b9ab79b4a327f2f7fe0225623be1ff4f87423c0ff02ace396bbc03ad' as const;

const brief: WritingBrief = {
  schemaVersion: WRITING_AGENT_SCHEMA_VERSION,
  objective: 'Explain the event-log architecture.',
  audience: 'engineering leads',
  format: 'markdown',
  requiredSections: ['Overview', 'Operational impact'],
  constraints: ['Use only supplied sources'],
  allowedOutputPaths: ['out/article.md'],
  sources: [
    {
      id: 'S1',
      title: 'Architecture note',
      mediaType: 'text/plain',
      content: sourceContent,
      hash: sourceHash,
    },
  ],
  citationPolicy: { style: 'paragraph-markers', requireEveryFactualParagraph: true },
  budget: {
    timeoutSeconds: 180,
    maxTurns: 20,
    maxRawEvents: 1_000,
    maxRawBytes: 2 * 1024 * 1024,
    maxRawChunkBytes: 64 * 1024,
  },
};

const result: WritingResult = {
  schemaVersion: 1,
  resultId: 'writing-result:1',
  status: 'completed',
  summary: 'Produced the requested explainer.',
  artifact: {
    path: 'out/article.md',
    hash: `sha256:${'1'.repeat(64)}`,
    sizeBytes: 123,
    mediaType: 'text/markdown',
  },
  citations: [
    {
      sourceId: 'S1',
      sourceHash,
      paragraphs: [1],
      claims: ['The event log stores business truth.'],
    },
  ],
  safety: {
    sourceInputsUnchanged: true,
    onlyAllowedOutputs: true,
    noRepositoryEffects: true,
    noNetworkEffects: true,
    noPublishEffects: true,
  },
};

describe('Writing Agent wire contract', () => {
  it('accepts one bounded source-grounded brief and result', () => {
    expect(assertWritingBrief(brief)).toEqual(brief);
    expect(assertWritingResult(result)).toEqual(result);
    expect(sourceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(WRITING_AGENT_LIMITS.maxSources).toBeGreaterThan(0);
  });

  it('rejects malformed source hashes, traversal, duplicates, and budget widening', () => {
    expect(() =>
      assertWritingBrief({ ...brief, sources: [{ ...brief.sources[0]!, hash: 'sha256:bad' }] }),
    ).toThrow(/source S1 hash/i);
    expect(() => assertWritingBrief({ ...brief, allowedOutputPaths: ['../article.md'] })).toThrow(
      /allowed output path/i,
    );
    expect(() =>
      assertWritingBrief({ ...brief, sources: [...brief.sources, brief.sources[0]!] }),
    ).toThrow(/duplicate source/i);
    expect(() =>
      assertWritingBrief({
        ...brief,
        budget: { ...brief.budget, maxRawBytes: WRITING_AGENT_LIMITS.maxRawBytes + 1 },
      }),
    ).toThrow(/budget/i);
  });

  it('rejects unverified or effect-capable result claims', () => {
    expect(() =>
      assertWritingResult({ ...result, artifact: { ...result.artifact, path: '/tmp/article.md' } }),
    ).toThrow(/artifact path/i);
    expect(() =>
      assertWritingResult({
        ...result,
        safety: { ...result.safety, noPublishEffects: false },
      }),
    ).toThrow(/safety/i);
    expect(() =>
      assertWritingResult({
        ...result,
        safety: { sourceInputsUnchanged: true },
      }),
    ).toThrow(/safety/i);
    expect(() =>
      assertWritingResult({
        ...result,
        citations: [{ ...result.citations[0]!, paragraphs: [0] }],
      }),
    ).toThrow(/paragraph/i);
  });
});
