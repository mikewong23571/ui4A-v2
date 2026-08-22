import { describe, expect, it } from 'vitest';

import {
  buildPresentationRevisionPrompt,
  parsePresentationRevision,
} from './presentation-revision';

const request = {
  sidecarId: 'sidecar:1',
  baseVersion: 2,
  messageId: 'message:9',
  instruction: '正文更舒展，收起元数据',
};

const input = {
  request,
  surface: {
    schemaVersion: 1 as const,
    root: {
      kind: 'word' as const,
      id: 'body',
      role: 'primary-content' as const,
      word: 'prose',
      bindings: {
        value: {
          kind: 'property' as const,
          subject: 'post:first',
          path: 'properties.fields.body',
        },
      },
      dependencies: [],
      provenance: [{ kind: 'generic-fallback' as const, ref: 'fixture' }],
    },
  },
  catalog: {
    id: 'catalog',
    version: '1',
    words: {
      prose: {
        roles: ['primary-content' as const],
        bindings: { value: { sources: ['property' as const], required: true } },
      },
    },
  },
};

describe('Presentation Revision Agent boundary', () => {
  it('turns model JSON into a versioned semantic Patch with user-message provenance', () => {
    expect(
      parsePresentationRevision(
        '{"operations":[{"kind":"density","nodeId":"body","density":"spacious"}]}',
        request,
      ),
    ).toMatchObject({
      status: 'patch',
      patch: {
        sidecarId: 'sidecar:1',
        baseVersion: 2,
        source: { kind: 'revision', ref: 'message:9' },
      },
    });
  });

  it('rejects factual/arbitrary output and keeps the prompt free of Chat history', () => {
    expect(parsePresentationRevision('{"operations":[],"body":"secret"}', request)).toMatchObject({
      status: 'failed',
      reasonCode: 'output-invalid',
    });
    const prompt = buildPresentationRevisionPrompt(input);
    expect(prompt).toContain(request.instruction);
    expect(prompt).not.toMatch(/chatHistory|sessionId|assistantMessages|principal/);
  });
});
