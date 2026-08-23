import { describe, expect, it } from 'vitest';

import {
  AGENT_AUTHORING_LIMITS,
  AGENT_AUTHORING_SCHEMA_VERSION,
  assertAgentAuthoringBrief,
  assertAgentAuthoringResult,
  type AgentAuthoringBrief,
  type AgentAuthoringResult,
} from './agent-authoring';

const brief: AgentAuthoringBrief = {
  schemaVersion: 1,
  description: 'Create a read-only compliance review Agent that cites supplied evidence.',
  requestedRef: 'compliance-review-agent@1',
  constraints: ['Never send remediation', 'Return findings as proposals'],
  registry: {
    runtimeClasses: [
      { name: 'general-agent', features: ['structured-result', 'streamed-events', 'cancel'] },
    ],
    tools: ['source-read'],
    resources: ['evidence-sources'],
    contextSources: ['evidence-sources'],
    verifiers: ['schema', 'citation-coverage'],
    baseDefinitions: [],
  },
  budget: {
    timeoutSeconds: 180,
    maxTurns: 16,
    maxRawEvents: 500,
    maxRawBytes: 2 * 1024 * 1024,
    maxRawChunkBytes: 64 * 1024,
  },
};

const candidate = {
  schemaVersion: 1 as const,
  ref: 'compliance-review-agent@1' as const,
  name: 'compliance-review-agent',
  version: 1,
  intent: 'Review supplied evidence and propose remediation.',
  prompt: {
    schemaVersion: 1 as const,
    blocks: [
      {
        id: 'authority',
        role: 'system' as const,
        purpose: 'authority' as const,
        literal: 'Use only granted evidence. Never approve, activate, or send remediation.',
        sealed: true,
      },
      {
        id: 'task',
        role: 'user' as const,
        purpose: 'task-data' as const,
        binding: {
          source: 'task' as const,
          pointer: '/objective',
          encoding: 'json-delimited' as const,
          required: true,
        },
      },
    ],
  },
  contracts: {
    inputSchema: {
      type: 'object',
      properties: { objective: { type: 'string' } },
      required: ['objective'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { findings: { type: 'array', items: { type: 'string' } } },
      required: ['findings'],
      additionalProperties: false,
    },
  },
  runtimeRequirements: {
    class: 'general-agent',
    features: ['structured-result', 'streamed-events'],
  },
  policies: {
    tools: { allowed: ['source-read'] },
    context: { allowedSources: ['evidence-sources'], maxItems: 20 },
    resources: { allowed: ['evidence-sources'] },
    artifacts: { allowedMediaTypes: ['application/json'], maxCount: 4, maxBytes: 100_000 },
  },
  evaluationPolicy: {
    verifiers: ['schema', 'citation-coverage'],
    evalSuiteRefs: ['eval:compliance-review-agent@1'],
    minimumScore: 0.8,
  },
};

const result: AgentAuthoringResult = {
  schemaVersion: 1,
  resultId: 'authoring-result:1',
  status: 'completed',
  summary: 'Drafted a compliance review specialization.',
  candidate,
  examples: [
    {
      name: 'missing evidence',
      inputJson: '{"objective":"review","sources":[]}',
      expectedOutcome: 'Reports that evidence is insufficient without inventing facts.',
    },
  ],
  evalCorpus: [
    {
      id: 'eval:compliance-review-agent@1',
      taskJson: '{"objective":"review supplied evidence"}',
      acceptanceCriteria: ['Uses only supplied evidence', 'Does not send remediation'],
    },
  ],
  safety: {
    draftOnly: true,
    noApprovalRequested: true,
    noActivationRequested: true,
    noRuntimeOverride: true,
  },
  validation: {
    valid: true,
    issues: [],
    pendingEvalSuiteRefs: ['eval:compliance-review-agent@1'],
    checks: [{ name: 'prompt-bindings-valid', pass: true }],
  },
};

describe('Agent Definition authoring contract', () => {
  it('accepts a bounded natural-language brief and typed Draft result', () => {
    expect(assertAgentAuthoringBrief(brief)).toEqual(brief);
    expect(assertAgentAuthoringResult(result)).toEqual(result);
    expect(AGENT_AUTHORING_SCHEMA_VERSION).toBe(1);
  });

  it('rejects unknown registry grants, duplicate tokens, and widened budgets', () => {
    expect(() =>
      assertAgentAuthoringBrief({
        ...brief,
        registry: { ...brief.registry, tools: ['read', 'read'] },
      }),
    ).toThrow(/duplicate/i);
    expect(() =>
      assertAgentAuthoringBrief({
        ...brief,
        budget: { ...brief.budget, maxRawEvents: AGENT_AUTHORING_LIMITS.maxRawEvents + 1 },
      }),
    ).toThrow(/budget/i);
    expect(() =>
      assertAgentAuthoringBrief({ ...brief, requestedRef: 'floating-agent@latest' }),
    ).toThrow(/requestedRef/i);
  });

  it('rejects non-JSON examples, mismatched candidate refs, and self-governance claims', () => {
    expect(() =>
      assertAgentAuthoringResult({
        ...result,
        examples: [{ ...result.examples[0]!, inputJson: '{bad' }],
      }),
    ).toThrow(/inputJson/i);
    expect(() =>
      assertAgentAuthoringResult({
        ...result,
        candidate: { ...candidate, ref: 'other-agent@1', name: 'other-agent' },
      }),
    ).not.toThrow();
    expect(() =>
      assertAgentAuthoringResult({
        ...result,
        safety: { ...result.safety, noActivationRequested: false },
      }),
    ).toThrow(/safety/i);
  });
});
