import { describe, expect, it } from 'vitest';

import {
  APPLICATION_BUNDLE_EDITOR_SCHEMA,
  draftEditorSchema,
  mergeDraftEditorData,
} from './draft-editor-schema';

describe('Draft structured editor schema', () => {
  it('exposes issue-repair fields for Agent Definitions without raw JSON editing', () => {
    const schema = draftEditorSchema('agent-definition', { name: 'writer' });
    expect(schema.properties).toMatchObject({
      name: { type: 'string' },
      intent: { type: 'string' },
      evaluationPolicy: {
        type: 'object',
        properties: { minimumScore: { type: 'number' }, verifiers: { type: 'array' } },
      },
    });
  });

  it('focuses invalid repair on issue-root fields while preserving structured controls', () => {
    const schema = draftEditorSchema('agent-definition', { name: 'writer' }, [
      '/evaluationPolicy/minimumScore',
    ]);
    expect(Object.keys(schema.properties as Record<string, unknown>)).toEqual(['evaluationPolicy']);
  });

  it('mechanically infers a structured Flow editor from the current candidate shape', () => {
    expect(
      draftEditorSchema('flow-definition', { name: 'flow', nodes: [{ name: 'ready' }] }),
    ).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string' },
        nodes: { type: 'array', items: { type: 'object' } },
      },
    });
  });

  it('preserves untouched optional contract schemas when submitting one structured repair', () => {
    expect(
      mergeDraftEditorData(
        {
          contracts: {
            inputSchema: { type: 'object' },
            outputSchema: { type: 'string' },
            contextSchema: { type: 'array' },
            policySchema: { type: 'boolean' },
          },
        },
        {
          contracts: {
            inputSchema: { type: 'string' },
            outputSchema: { type: 'string' },
            contextSchema: { type: 'array' },
            policySchema: { type: 'boolean' },
          },
        },
        ['/contracts/inputSchema'],
      ),
    ).toEqual({
      contracts: {
        inputSchema: { type: 'string' },
        outputSchema: { type: 'string' },
        contextSchema: { type: 'array' },
        policySchema: { type: 'boolean' },
      },
    });
  });

  it('deletes an invalid focused root omitted by the structured closed schema', () => {
    expect(
      mergeDraftEditorData({ name: 'writer', unexpected: { unsafe: true } }, {}, ['/unexpected']),
    ).toEqual({ name: 'writer' });
  });
});

describe('application-bundle structured editor schema (T48 D67.2)', () => {
  const bundlePayload = {
    schema: 'https://ui4a.dev/application-bundle/v1',
    bundle: { name: 'notes', version: 1 },
    applications: [
      {
        name: 'notes',
        title: 'Notes',
        intent: 'Capture notes.',
        entry: { target: 'flow:notes-capture', role: 'primary-create' },
      },
    ],
    capabilities: [],
    flows: [{ name: 'notes-capture', app: 'notes', initial: 'capture', nodes: [] }],
    seed: { rel: 'seed:notes', detail: { instances: {} } },
  };

  it('derives the structured root contract from the Application Bundle v1 parse contract', () => {
    const properties = APPLICATION_BUNDLE_EDITOR_SCHEMA.properties as Record<string, unknown>;
    expect(properties.schema).toMatchObject({
      type: 'string',
      enum: ['https://ui4a.dev/application-bundle/v1'],
    });
    expect(properties.bundle).toMatchObject({
      type: 'object',
      properties: { name: { type: 'string' }, version: { type: 'integer', minimum: 1 } },
      required: ['name', 'version'],
    });
    const applications = properties.applications as Record<string, unknown>;
    const applicationItem = applications.items as Record<string, unknown>;
    expect(applicationItem.properties).toMatchObject({
      name: { type: 'string' },
      title: { type: 'string' },
      intent: { type: 'string' },
      entry: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          role: { enum: ['primary-create', 'primary-task', 'primary-collection', 'resume'] },
        },
      },
    });
    expect(applicationItem.required).toEqual(['name', 'title', 'intent']);
    expect(APPLICATION_BUNDLE_EDITOR_SCHEMA.required).toEqual([
      'schema',
      'bundle',
      'applications',
      'capabilities',
      'flows',
      'seed',
    ]);
  });

  it('dispatches kind=application-bundle to the bundle schema instead of shape inference', () => {
    const schema = draftEditorSchema('application-bundle', bundlePayload);
    expect(schema).toBe(APPLICATION_BUNDLE_EDITOR_SCHEMA);
  });

  it('focuses invalid repair on the bundle root when the issue targets /bundle/name', () => {
    const schema = draftEditorSchema('application-bundle', bundlePayload, ['/bundle/name']);
    expect(Object.keys(schema.properties as Record<string, unknown>)).toEqual(['bundle']);
    expect(schema.title).toBe('Blocking fields');
  });

  it('preserves unrelated bundle roots when submitting one focused repair', () => {
    expect(
      mergeDraftEditorData(
        bundlePayload as unknown as Record<string, unknown>,
        {
          ...(bundlePayload as unknown as Record<string, unknown>),
          bundle: { name: 'ideas', version: 1 },
        },
        ['/bundle/name'],
      ),
    ).toEqual({
      ...bundlePayload,
      bundle: { name: 'ideas', version: 1 },
    });
  });
});
