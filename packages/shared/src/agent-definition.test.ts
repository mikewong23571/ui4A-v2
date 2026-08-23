import { describe, expect, it } from 'vitest';

import {
  AGENT_DEFINITION_LIMITS,
  AGENT_DEFINITION_SCHEMA_VERSION,
  type AgentDefinition,
  type AgentResultEnvelope,
  type AgentTaskEnvelope,
} from './agent-definition';

const birth = {
  definitionRef: 'base-agent@1' as const,
  flattenedDefinitionHash: `sha256:${'a'.repeat(64)}` as const,
  promptHash: `sha256:${'b'.repeat(64)}` as const,
  runtimeProfileRef: 'standard-agent',
  runtimeProfileVersion: 1,
  taskSchemaHash: `sha256:${'c'.repeat(64)}` as const,
  resultSchemaHash: `sha256:${'d'.repeat(64)}` as const,
};

describe('specialized Agent wire contracts', () => {
  it('round-trips definition, task, and result envelopes as provider-neutral JSON', () => {
    const definition: AgentDefinition = {
      schemaVersion: AGENT_DEFINITION_SCHEMA_VERSION,
      ref: 'base-agent@1',
      name: 'base-agent',
      version: 1,
      intent: 'Complete a bounded task',
      prompt: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'authority',
            role: 'system',
            purpose: 'authority',
            literal: 'Stay within grants.',
            sealed: true,
          },
        ],
      },
      contracts: { inputSchema: { type: 'object' }, outputSchema: { type: 'object' } },
      runtimeRequirements: { class: 'general-agent', features: ['streaming'] },
      policies: {
        tools: { allowed: ['read'] },
        context: { allowedSources: ['entity'], maxItems: 10 },
        resources: { allowed: ['entity'] },
        artifacts: { allowedMediaTypes: ['text/plain'], maxCount: 4, maxBytes: 1_024 },
      },
      evaluationPolicy: {
        verifiers: ['schema'],
        evalSuiteRefs: ['eval:base@1'],
        minimumScore: 0.8,
      },
    };
    const task: AgentTaskEnvelope = {
      schemaVersion: 1,
      runId: 'run-1',
      birth,
      objective: 'Summarize the supplied entity',
      input: { format: 'brief' },
      context: [{ rel: 'post:first-post', revision: 3 }],
      constraints: ['Use supplied facts'],
      grants: [{ category: 'entity', resourceRef: 'post:first-post', permissions: ['read'] }],
      budget: { timeoutSeconds: 60, maxTurns: 4 },
    };
    const result: AgentResultEnvelope = {
      schemaVersion: 1,
      runId: 'run-1',
      status: 'completed',
      output: { summary: 'A short article.' },
      artifacts: [],
      evidence: [],
      proposedEffects: [],
      questions: [],
      provenance: {
        birth,
        trajectory: {
          hash: `sha256:${'e'.repeat(64)}`,
          mediaType: 'application/x-ndjson',
          sizeBytes: 12,
        },
      },
    };

    expect(JSON.parse(JSON.stringify({ definition, task, result }))).toEqual({
      definition,
      task,
      result,
    });
    expect(AGENT_DEFINITION_LIMITS.maxBytes).toBeGreaterThan(
      AGENT_DEFINITION_LIMITS.maxBlockLiteralBytes,
    );
  });
});
