type EditorSchema = Record<string, unknown>;

const STRING_ARRAY: EditorSchema = { type: 'array', items: { type: 'string' } };

const PROMPT_BLOCK: EditorSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', title: 'Block id' },
    role: { type: 'string', title: 'Role', enum: ['system', 'user', 'assistant'] },
    purpose: { type: 'string', title: 'Purpose' },
    sealed: { type: 'boolean', title: 'Sealed authority' },
    literal: { type: 'string', title: 'Literal instruction' },
    binding: {
      type: 'object',
      title: 'Typed binding',
      properties: {
        source: { type: 'string', title: 'Source' },
        pointer: { type: 'string', title: 'JSON pointer' },
        encoding: { type: 'string', title: 'Encoding' },
        required: { type: 'boolean', title: 'Required' },
      },
      additionalProperties: false,
    },
  },
  required: ['id', 'role', 'purpose'],
  additionalProperties: false,
};

/** Human-oriented structured subset of the Agent Definition v1 source contract. */
export const AGENT_DEFINITION_EDITOR_SCHEMA: EditorSchema = {
  type: 'object',
  title: 'Agent Definition candidate',
  properties: {
    schemaVersion: { type: 'integer', title: 'Schema version', enum: [1] },
    ref: { type: 'string', title: 'Definition ref' },
    name: { type: 'string', title: 'Definition name' },
    version: { type: 'integer', title: 'Version', minimum: 1 },
    intent: { type: 'string', title: 'Intent' },
    extends: { type: 'string', title: 'Exact parent ref' },
    prompt: {
      type: 'object',
      title: 'Prompt contract',
      properties: {
        schemaVersion: { type: 'integer', title: 'Prompt schema version', enum: [1] },
        blocks: { type: 'array', title: 'Prompt blocks', items: PROMPT_BLOCK },
      },
      additionalProperties: false,
    },
    contracts: {
      type: 'object',
      title: 'Task and result contracts',
      properties: {
        inputSchema: { type: 'object', title: 'Input JSON Schema', additionalProperties: true },
        outputSchema: { type: 'object', title: 'Output JSON Schema', additionalProperties: true },
        contextSchema: { type: 'object', title: 'Context JSON Schema', additionalProperties: true },
        policySchema: { type: 'object', title: 'Policy JSON Schema', additionalProperties: true },
      },
      additionalProperties: false,
    },
    runtimeRequirements: {
      type: 'object',
      title: 'Runtime requirements',
      properties: {
        class: { type: 'string', title: 'Runtime class' },
        features: { ...STRING_ARRAY, title: 'Required features' },
      },
      additionalProperties: false,
    },
    policies: {
      type: 'object',
      title: 'Least-privilege policies',
      properties: {
        tools: {
          type: 'object',
          properties: { allowed: { ...STRING_ARRAY, title: 'Allowed tools' } },
          additionalProperties: true,
        },
        resources: {
          type: 'object',
          properties: { allowed: { ...STRING_ARRAY, title: 'Allowed resources' } },
          additionalProperties: true,
        },
        artifacts: { type: 'object', title: 'Artifact policy', additionalProperties: true },
        context: { type: 'object', title: 'Context policy', additionalProperties: true },
      },
      additionalProperties: true,
    },
    evaluationPolicy: {
      type: 'object',
      title: 'Evaluation policy',
      properties: {
        minimumScore: { type: 'number', title: 'Minimum score', minimum: 0, maximum: 1 },
        verifiers: { ...STRING_ARRAY, title: 'Verifiers' },
        evalSuiteRefs: { ...STRING_ARRAY, title: 'Eval suites' },
      },
      additionalProperties: false,
    },
    specialize: { type: 'object', title: 'Specialization overrides', additionalProperties: true },
  },
  required: ['schemaVersion', 'name', 'version', 'intent'],
  additionalProperties: false,
};

function inferSchema(value: unknown): EditorSchema {
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (Array.isArray(value)) {
    return { type: 'array', items: value[0] === undefined ? {} : inferSchema(value[0]) };
  }
  if (typeof value === 'object' && value !== null) {
    return {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [
          key,
          inferSchema(child),
        ]),
      ),
      additionalProperties: true,
    };
  }
  return {};
}

function pointerRoot(path: string): string | undefined {
  const first = path.split('/')[1];
  return first === undefined || first === ''
    ? undefined
    : first.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function draftEditorSchema(
  kind: string,
  payload: unknown,
  issuePaths: readonly string[] = [],
): EditorSchema {
  const complete =
    kind === 'agent-definition' ? AGENT_DEFINITION_EDITOR_SCHEMA : inferSchema(payload);
  const issueRoots = new Set(issuePaths.flatMap((path) => pointerRoot(path) ?? []));
  if (issueRoots.size === 0 || typeof complete.properties !== 'object') return complete;
  const properties = Object.fromEntries(
    Object.entries(complete.properties as Record<string, unknown>).filter(([key]) =>
      issueRoots.has(key),
    ),
  );
  if (Object.keys(properties).length === 0) return complete;
  return {
    ...complete,
    title: 'Blocking fields',
    properties,
    required: Array.isArray(complete.required)
      ? complete.required.filter((key) => typeof key === 'string' && issueRoots.has(key))
      : [],
  };
}

/** Replace focused issue roots (including deletion) while preserving unrelated candidate roots. */
export function mergeDraftEditorData(
  original: Record<string, unknown>,
  edited: Record<string, unknown>,
  issuePaths: readonly string[] = [],
): Record<string, unknown> {
  const focusedRoots = new Set(issuePaths.flatMap((path) => pointerRoot(path) ?? []));
  if (focusedRoots.size === 0) return { ...edited };
  const merged: Record<string, unknown> = { ...original };
  for (const root of focusedRoots) {
    if (Object.hasOwn(edited, root)) merged[root] = edited[root];
    else delete merged[root];
  }
  return merged;
}
