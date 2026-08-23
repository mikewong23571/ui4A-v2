import { describe, expect, it } from 'vitest';

import type { AgentDefinition, AgentResultEnvelope } from '@ui4a/shared';

import { validateAgentResultProposal } from './result-validation';

const definition: AgentDefinition = {
  schemaVersion: 1,
  ref: 'writing-agent@1',
  name: 'writing-agent',
  version: 1,
  intent: 'Write',
  prompt: {
    schemaVersion: 1,
    blocks: [
      {
        id: 'authority',
        role: 'system',
        purpose: 'authority',
        literal: 'Use grants.',
        sealed: true,
      },
    ],
  },
  contracts: {
    inputSchema: { type: 'object' },
    outputSchema: {
      type: 'object',
      properties: { document: { type: 'string' } },
      required: ['document'],
      additionalProperties: false,
    },
  },
  runtimeRequirements: { class: 'document-agent', features: [] },
  policies: {
    tools: { allowed: [] },
    context: { allowedSources: [], maxItems: 0 },
    resources: { allowed: [] },
    artifacts: { allowedMediaTypes: ['text/markdown'], maxCount: 1, maxBytes: 1_000 },
  },
  evaluationPolicy: { verifiers: ['schema', 'citation'], evalSuiteRefs: ['eval:writing'] },
};

const artifact = {
  hash: `sha256:${'1'.repeat(64)}` as const,
  mediaType: 'text/markdown',
  sizeBytes: 100,
};

function result(output: unknown = { document: 'Grounded text.' }): AgentResultEnvelope {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    status: 'completed',
    output: output as never,
    artifacts: [artifact],
    evidence: [
      { verifier: 'schema', artifact, passed: true },
      { verifier: 'citation', artifact, passed: true },
    ],
    proposedEffects: [
      { capability: 'publishing', action: 'save-draft', parameters: { artifact: artifact.hash } },
    ],
    questions: [],
    provenance: {
      birth: {
        definitionRef: 'writing-agent@1',
        flattenedDefinitionHash: `sha256:${'2'.repeat(64)}`,
        promptHash: `sha256:${'3'.repeat(64)}`,
        runtimeProfileRef: 'document-default',
        runtimeProfileVersion: 1,
        taskSchemaHash: `sha256:${'4'.repeat(64)}`,
        resultSchemaHash: `sha256:${'5'.repeat(64)}`,
      },
      trajectory: {
        hash: `sha256:${'6'.repeat(64)}`,
        mediaType: 'application/x-ndjson',
        sizeBytes: 10,
      },
    },
  };
}

describe('validateAgentResultProposal', () => {
  it('accepts independently verified contracted output while retaining effects as proposals', () => {
    const report = validateAgentResultProposal({
      definition,
      result: result(),
      expectedRunId: 'run-1',
      verifiedArtifacts: new Map([[artifact.hash, artifact]]),
      verifiedVerifiers: new Map([
        ['schema', { passed: true, artifactHash: artifact.hash }],
        ['citation', { passed: true, artifactHash: artifact.hash }],
      ]),
    });
    expect(report.pass).toBe(true);
    expect(report.proposedEffects).toHaveLength(1);
    expect(report.executedEffects).toEqual([]);
  });

  it('reports schema, artifact and verifier failures without short-circuiting', () => {
    const invalid = result({ unexpected: true });
    invalid.artifacts[0] = { ...artifact, mediaType: 'application/octet-stream' };
    const report = validateAgentResultProposal({
      definition,
      result: invalid,
      expectedRunId: 'other-run',
      verifiedArtifacts: new Map(),
      verifiedVerifiers: new Map([['schema', { passed: false }]]),
    });
    expect(report.pass).toBe(false);
    expect(report.checks.filter((check) => !check.pass).map((check) => check.name)).toEqual([
      'run-identity-valid',
      'output-schema-valid',
      'artifact-policy-valid',
      'artifact-integrity-valid',
      'verifier-evidence-valid',
    ]);
  });
});
