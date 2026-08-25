export const WRITING_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    resultId: { type: 'string' },
    status: { type: 'string', enum: ['completed', 'failed'] },
    summary: { type: 'string' },
    artifact: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        hash: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
        sizeBytes: { type: 'integer', minimum: 1 },
        mediaType: { type: 'string', const: 'text/markdown' },
      },
      required: ['path', 'hash', 'sizeBytes', 'mediaType'],
      additionalProperties: false,
    },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceId: { type: 'string' },
          sourceHash: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
          paragraphs: { type: 'array', items: { type: 'integer', minimum: 1 } },
          claims: { type: 'array', items: { type: 'string' } },
        },
        required: ['sourceId', 'sourceHash', 'paragraphs', 'claims'],
        additionalProperties: false,
      },
    },
    safety: {
      type: 'object',
      properties: Object.fromEntries(
        [
          'sourceInputsUnchanged',
          'onlyAllowedOutputs',
          'noRepositoryEffects',
          'noNetworkEffects',
          'noPublishEffects',
        ].map((name) => [name, { type: 'boolean', const: true }]),
      ),
      required: [
        'sourceInputsUnchanged',
        'onlyAllowedOutputs',
        'noRepositoryEffects',
        'noNetworkEffects',
        'noPublishEffects',
      ],
      additionalProperties: false,
    },
  },
  required: ['schemaVersion', 'resultId', 'status', 'summary', 'artifact', 'citations', 'safety'],
  additionalProperties: false,
} as const;
