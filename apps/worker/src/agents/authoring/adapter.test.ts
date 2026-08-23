import { describe, expect, it } from 'vitest';

import type { AgentAuthoringBrief, AgentDefinition } from '@ui4a/shared';

import {
  parseAgentAuthoringProfiles,
  parseAuthoringProviderClaim,
  type AgentAuthoringProfile,
} from './adapter';

const profile: AgentAuthoringProfile = {
  name: 'authoring-codex',
  runtimeClass: 'agent-definition-authoring',
  providerId: 'codex',
  transport: 'sdk',
  model: 'deployment-selected',
  apiKeyEnv: 'AUTHORING_API_KEY',
  timeoutSeconds: 120,
  maxTurns: 12,
  envAllowlist: ['PATH'],
  networkPolicy: 'none',
};

const brief: AgentAuthoringBrief = {
  schemaVersion: 1,
  description: 'Create a read-only triage Agent.',
  requestedRef: 'triage-agent@1',
  constraints: ['Propose replies but never send them'],
  registry: {
    runtimeClasses: [{ name: 'general-agent', features: ['structured-result'] }],
    tools: ['case-read'],
    resources: ['support-case'],
    contextSources: ['support-case'],
    verifiers: ['schema'],
    baseDefinitions: [],
  },
  budget: {
    timeoutSeconds: 120,
    maxTurns: 12,
    maxRawEvents: 100,
    maxRawBytes: 100_000,
    maxRawChunkBytes: 10_000,
  },
};

const candidate: AgentDefinition = {
  schemaVersion: 1,
  ref: 'triage-agent@1',
  name: 'triage-agent',
  version: 1,
  intent: 'Classify support cases and propose unsent replies.',
  prompt: {
    schemaVersion: 1,
    blocks: [
      {
        id: 'authority',
        role: 'system',
        purpose: 'authority',
        literal: 'Read the supplied case. Never send replies, approve, or activate.',
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
      properties: { proposedReply: { type: 'string' } },
      required: ['proposedReply'],
      additionalProperties: false,
    },
  },
  runtimeRequirements: { class: 'general-agent', features: ['structured-result'] },
  policies: {
    tools: { allowed: ['case-read'] },
    context: { allowedSources: ['support-case'], maxItems: 4 },
    resources: { allowed: ['support-case'] },
    artifacts: { allowedMediaTypes: ['application/json'], maxCount: 2, maxBytes: 50_000 },
  },
  evaluationPolicy: {
    verifiers: ['schema'],
    evalSuiteRefs: ['eval:triage-agent@1'],
    minimumScore: 0.8,
  },
};

const providerClaim = {
  status: 'completed',
  summary: 'Drafted triage specialization.',
  candidate,
  examples: [
    {
      name: 'billing case',
      inputJson: '{"objective":"triage billing case"}',
      expectedOutcome: 'Classifies and proposes, but does not send, a reply.',
    },
  ],
  evalCorpus: [
    {
      id: 'eval:triage-agent@1',
      taskJson: '{"objective":"triage billing case"}',
      acceptanceCriteria: ['No send effect'],
    },
  ],
  safety: {
    draftOnly: true,
    noApprovalRequested: true,
    noActivationRequested: true,
    noRuntimeOverride: true,
  },
};

describe('Agent Definition authoring adapter contract', () => {
  it('parses one exact server-owned profile without fallback', () => {
    expect(parseAgentAuthoringProfiles(JSON.stringify([profile]))).toEqual([profile]);
    expect(() =>
      parseAgentAuthoringProfiles(JSON.stringify([{ ...profile, runtimeClass: 'general-agent' }])),
    ).toThrow(/invalid/i);
  });

  it('converts a string-encoded candidate into a mechanically valid typed Draft result', () => {
    const result = parseAuthoringProviderClaim(brief, providerClaim, 'agent-run:authoring-1');
    expect(result).toMatchObject({
      resultId: 'authoring-result:agent-run:authoring-1',
      candidate: { ref: 'triage-agent@1' },
      safety: { draftOnly: true, noActivationRequested: true },
      validation: { valid: true },
    });
  });

  it('rejects malformed definitions and any approval/activation claim', () => {
    expect(() =>
      parseAuthoringProviderClaim(
        brief,
        { ...providerClaim, candidate: 'not-an-object' },
        'agent-run:bad',
      ),
    ).toThrow(/Provider result/i);
    expect(() =>
      parseAuthoringProviderClaim(
        brief,
        {
          ...providerClaim,
          safety: { ...providerClaim.safety, noActivationRequested: false },
        },
        'agent-run:unsafe',
      ),
    ).toThrow(/safety/i);
  });

  it('keeps a bounded but invalid candidate as a revisable Draft with failed checks', () => {
    const result = parseAuthoringProviderClaim(
      brief,
      {
        ...providerClaim,
        candidate: { schemaVersion: 1, ref: 'triage-agent@1', name: 'broken' },
      },
      'agent-run:revisable',
    );
    expect(result.validation.valid).toBe(false);
    expect(result.validation.issues.join('\n')).toMatch(/parse-error|identity|version/i);
    expect(result.safety.draftOnly).toBe(true);
  });
});
