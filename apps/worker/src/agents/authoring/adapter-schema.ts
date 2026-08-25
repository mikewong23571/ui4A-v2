export const AGENT_AUTHORING_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['completed', 'failed'] },
    summary: { type: 'string' },
    candidate: {
      type: 'object',
      properties: {
        schemaVersion: { type: 'integer', const: 1 },
        ref: { type: 'string' },
        name: { type: 'string' },
        version: { type: 'integer', minimum: 1 },
        intent: { type: 'string' },
        prompt: {
          type: 'object',
          properties: {
            schemaVersion: { type: 'integer', const: 1 },
            blocks: {
              type: 'array',
              items: {
                anyOf: [
                  {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                      purpose: {
                        type: 'string',
                        enum: [
                          'authority',
                          'instruction',
                          'task-data',
                          'context-data',
                          'policy-data',
                        ],
                      },
                      sealed: { type: 'boolean' },
                      literal: { type: 'string' },
                    },
                    required: ['id', 'role', 'purpose', 'sealed', 'literal'],
                    additionalProperties: false,
                  },
                  {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                      purpose: {
                        type: 'string',
                        enum: [
                          'authority',
                          'instruction',
                          'task-data',
                          'context-data',
                          'policy-data',
                        ],
                      },
                      sealed: { type: 'boolean' },
                      binding: {
                        type: 'object',
                        properties: {
                          source: { type: 'string', enum: ['task', 'context', 'policy'] },
                          pointer: { type: 'string' },
                          encoding: { type: 'string', const: 'json-delimited' },
                          required: { type: 'boolean' },
                        },
                        required: ['source', 'pointer', 'encoding', 'required'],
                        additionalProperties: false,
                      },
                    },
                    required: ['id', 'role', 'purpose', 'sealed', 'binding'],
                    additionalProperties: false,
                  },
                ],
              },
            },
          },
          required: ['schemaVersion', 'blocks'],
          additionalProperties: false,
        },
        contracts: {
          type: 'object',
          properties: {
            inputSchema: {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'object' },
                properties: {
                  type: 'object',
                  properties: {
                    objective: {
                      type: 'object',
                      properties: { type: { type: 'string', const: 'string' } },
                      required: ['type'],
                      additionalProperties: false,
                    },
                  },
                  required: ['objective'],
                  additionalProperties: false,
                },
                required: {
                  type: 'array',
                  items: { type: 'string', enum: ['objective'] },
                  minItems: 1,
                  maxItems: 1,
                },
                additionalProperties: { type: 'boolean', const: false },
              },
              required: ['type', 'properties', 'required', 'additionalProperties'],
              additionalProperties: false,
            },
            outputSchema: {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'object' },
                properties: {
                  type: 'object',
                  properties: {
                    response: {
                      type: 'object',
                      properties: { type: { type: 'string', const: 'string' } },
                      required: ['type'],
                      additionalProperties: false,
                    },
                    evidence: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', const: 'array' },
                        items: {
                          type: 'object',
                          properties: { type: { type: 'string', const: 'string' } },
                          required: ['type'],
                          additionalProperties: false,
                        },
                      },
                      required: ['type', 'items'],
                      additionalProperties: false,
                    },
                  },
                  required: ['response', 'evidence'],
                  additionalProperties: false,
                },
                required: {
                  type: 'array',
                  items: { type: 'string', enum: ['response', 'evidence'] },
                  minItems: 2,
                  maxItems: 2,
                },
                additionalProperties: { type: 'boolean', const: false },
              },
              required: ['type', 'properties', 'required', 'additionalProperties'],
              additionalProperties: false,
            },
          },
          required: ['inputSchema', 'outputSchema'],
          additionalProperties: false,
        },
        runtimeRequirements: {
          type: 'object',
          properties: {
            class: { type: 'string' },
            features: { type: 'array', items: { type: 'string' } },
          },
          required: ['class', 'features'],
          additionalProperties: false,
        },
        policies: {
          type: 'object',
          properties: {
            tools: {
              type: 'object',
              properties: { allowed: { type: 'array', items: { type: 'string' } } },
              required: ['allowed'],
              additionalProperties: false,
            },
            context: {
              type: 'object',
              properties: {
                allowedSources: { type: 'array', items: { type: 'string' } },
                maxItems: { type: 'integer', minimum: 0 },
              },
              required: ['allowedSources', 'maxItems'],
              additionalProperties: false,
            },
            resources: {
              type: 'object',
              properties: { allowed: { type: 'array', items: { type: 'string' } } },
              required: ['allowed'],
              additionalProperties: false,
            },
            artifacts: {
              type: 'object',
              properties: {
                allowedMediaTypes: { type: 'array', items: { type: 'string' } },
                maxCount: { type: 'integer', minimum: 0 },
                maxBytes: { type: 'integer', minimum: 0 },
              },
              required: ['allowedMediaTypes', 'maxCount', 'maxBytes'],
              additionalProperties: false,
            },
          },
          required: ['tools', 'context', 'resources', 'artifacts'],
          additionalProperties: false,
        },
        evaluationPolicy: {
          type: 'object',
          properties: {
            verifiers: { type: 'array', items: { type: 'string' } },
            evalSuiteRefs: { type: 'array', items: { type: 'string' } },
            minimumScore: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['verifiers', 'evalSuiteRefs', 'minimumScore'],
          additionalProperties: false,
        },
      },
      required: [
        'schemaVersion',
        'ref',
        'name',
        'version',
        'intent',
        'prompt',
        'contracts',
        'runtimeRequirements',
        'policies',
        'evaluationPolicy',
      ],
      additionalProperties: false,
    },
    examples: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          inputJson: { type: 'string' },
          expectedOutcome: { type: 'string' },
        },
        required: ['name', 'inputJson', 'expectedOutcome'],
        additionalProperties: false,
      },
    },
    evalCorpus: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          taskJson: { type: 'string' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'taskJson', 'acceptanceCriteria'],
        additionalProperties: false,
      },
    },
    safety: {
      type: 'object',
      properties: Object.fromEntries(
        ['draftOnly', 'noApprovalRequested', 'noActivationRequested', 'noRuntimeOverride'].map(
          (name) => [name, { type: 'boolean', const: true }],
        ),
      ),
      required: ['draftOnly', 'noApprovalRequested', 'noActivationRequested', 'noRuntimeOverride'],
      additionalProperties: false,
    },
  },
  required: ['status', 'summary', 'candidate', 'examples', 'evalCorpus', 'safety'],
  additionalProperties: false,
} as const;
