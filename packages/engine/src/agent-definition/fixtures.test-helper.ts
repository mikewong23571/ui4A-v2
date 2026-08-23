import type { AgentDefinition, DerivedAgentDefinitionSource } from '@ui4a/shared';

export function rootDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    schemaVersion: 1,
    ref: 'base-agent@1',
    name: 'base-agent',
    version: 1,
    intent: 'Complete an authorized task',
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
        {
          id: 'objective',
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
      },
      outputSchema: { type: 'object', properties: { response: { type: 'string' } } },
      contextSchema: {
        type: 'object',
        properties: { facts: { type: 'array', items: { type: 'string' } } },
      },
      policySchema: {
        type: 'object',
        properties: { grants: { type: 'array', items: { type: 'string' } } },
      },
    },
    runtimeRequirements: { class: 'general-agent', features: ['streaming'] },
    policies: {
      tools: { allowed: ['read'] },
      context: { allowedSources: ['entity'], maxItems: 20 },
      resources: { allowed: ['entity'] },
      artifacts: { allowedMediaTypes: ['text/plain'], maxCount: 5, maxBytes: 10_000 },
    },
    evaluationPolicy: { verifiers: ['schema'], evalSuiteRefs: ['eval:base@1'], minimumScore: 0.8 },
    ...overrides,
  };
}

export function childDefinition(
  overrides: Partial<DerivedAgentDefinitionSource> = {},
): DerivedAgentDefinitionSource {
  return {
    schemaVersion: 1,
    ref: 'writing-agent@1',
    name: 'writing-agent',
    version: 1,
    extends: 'base-agent@1',
    specialize: {
      replace: { intent: 'Write an evidence-backed document' },
      appendPromptBlocks: [
        {
          id: 'writing-method',
          role: 'system',
          purpose: 'instruction',
          literal: 'Draft, verify, then render.',
        },
      ],
    },
    ...overrides,
  };
}
