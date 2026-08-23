import { describe, expect, it } from 'vitest';

import type { AgentAuthoringBrief, AgentAuthoringResult, AgentDefinition } from '@ui4a/shared';

import { validateAuthoredAgentDefinition } from './validate';

const brief: AgentAuthoringBrief = {
  schemaVersion: 1,
  description: 'Create a read-only reviewer.',
  requestedRef: 'review-agent@1',
  constraints: ['Draft only'],
  registry: {
    runtimeClasses: [{ name: 'general-agent', features: ['structured-result'] }],
    tools: ['source-read'],
    resources: ['evidence-sources'],
    contextSources: ['evidence-sources'],
    verifiers: ['schema'],
    baseDefinitions: [],
  },
  budget: {
    timeoutSeconds: 120,
    maxTurns: 10,
    maxRawEvents: 100,
    maxRawBytes: 100_000,
    maxRawChunkBytes: 10_000,
  },
};

const candidate: AgentDefinition = {
  schemaVersion: 1,
  ref: 'review-agent@1',
  name: 'review-agent',
  version: 1,
  intent: 'Review evidence and propose findings.',
  prompt: {
    schemaVersion: 1,
    blocks: [
      {
        id: 'authority',
        role: 'system',
        purpose: 'authority',
        literal: 'Use supplied evidence only. Return proposals and never approve or activate.',
        sealed: true,
      },
      {
        id: 'task',
        role: 'user',
        purpose: 'task-data',
        binding: {
          source: 'task',
          pointer: '/objective',
          encoding: 'json-delimited',
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
  runtimeRequirements: { class: 'general-agent', features: ['structured-result'] },
  policies: {
    tools: { allowed: ['source-read'] },
    context: { allowedSources: ['evidence-sources'], maxItems: 8 },
    resources: { allowed: ['evidence-sources'] },
    artifacts: { allowedMediaTypes: ['application/json'], maxCount: 2, maxBytes: 50_000 },
  },
  evaluationPolicy: {
    verifiers: ['schema'],
    evalSuiteRefs: ['eval:review-agent@1'],
    minimumScore: 0.8,
  },
};

const result: AgentAuthoringResult = {
  schemaVersion: 1,
  resultId: 'result:review-agent@1',
  status: 'completed',
  summary: 'Drafted reviewer.',
  candidate,
  examples: [
    { name: 'basic', inputJson: '{"objective":"review"}', expectedOutcome: 'Returns findings.' },
  ],
  evalCorpus: [
    {
      id: 'eval:review-agent@1',
      taskJson: '{"objective":"review"}',
      acceptanceCriteria: ['Uses only evidence'],
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
    pendingEvalSuiteRefs: ['eval:review-agent@1'],
    checks: [],
  },
};

describe('authored Agent Definition mechanical validation', () => {
  it('accepts parseable sources that pass every non-Eval activation invariant', () => {
    const validation = validateAuthoredAgentDefinition({ brief, result });
    expect(validation.artifact.ref).toBe('review-agent@1');
    expect(
      validation.checks
        .filter((check) => check.name !== 'eval-evidence-valid')
        .every((check) => check.pass),
    ).toBe(true);
    expect(validation.pendingEvalSuiteRefs).toEqual(['eval:review-agent@1']);
  });

  it('rejects ref drift, unregistered grants, and missing generated Eval suites', () => {
    expect(() =>
      validateAuthoredAgentDefinition({
        brief,
        result: {
          ...result,
          candidate: { ...candidate, ref: 'other-agent@1', name: 'other-agent' },
        },
      }),
    ).toThrow(/requestedRef/i);
    expect(() =>
      validateAuthoredAgentDefinition({
        brief,
        result: {
          ...result,
          candidate: {
            ...candidate,
            policies: { ...candidate.policies, tools: { allowed: ['shell'] } },
          },
        },
      }),
    ).toThrow(/tools-registered|activation invariant/i);
    expect(() =>
      validateAuthoredAgentDefinition({
        ...{ brief, result },
        result: { ...result, evalCorpus: [{ ...result.evalCorpus[0]!, id: 'eval:other@1' }] },
      }),
    ).toThrow(/Eval suite/i);
  });
});
