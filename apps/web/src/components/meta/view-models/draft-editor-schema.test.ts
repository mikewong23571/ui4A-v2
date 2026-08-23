import { describe, expect, it } from 'vitest';

import { draftEditorSchema, mergeDraftEditorData } from './draft-editor-schema';

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
