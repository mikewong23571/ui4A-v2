/** Independent Presentation Agent: bounded context, binding-only template, and fail-safe transport. */
import { validateRecipeCandidate, type SurfaceCatalog } from '@ui4a/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildPresentationPrompt,
  createPresentationAgent,
  parsePresentationCandidate,
  summarizePresentationCatalog,
  type PresentationGenerationInput,
} from './presentation-agent';
import { createScriptedTransport } from './testkit';

const CONFIG = {
  apiKey: 'test-key',
  baseURL: 'https://provider.test/v1',
  model: 'test-presentation-model',
} as const;

const CATALOG: SurfaceCatalog = {
  id: 'ui4a-core',
  version: 'catalog-v3',
  words: {
    prose: {
      roles: ['primary-content'],
      bindings: { value: { sources: ['property'], required: true } },
    },
    actionList: {
      roles: ['actions'],
      bindings: { actions: { sources: ['actions'], required: true } },
    },
  },
};

function input(overrides: Partial<PresentationGenerationInput> = {}): PresentationGenerationInput {
  return {
    scenario: {
      key: 'entity-inspect:post',
      kind: 'entity-inspect',
      subjectShape: 'post',
      intent: 'inspect',
      definitionRefs: ['application:publishing', 'flow:post-status'],
      slots: ['subject.rel'],
      versions: { enumerator: 1, application: '7', flow: '3' },
    },
    definitions: [
      { kind: 'application', ref: 'application:publishing', version: '7' },
      {
        kind: 'flow',
        ref: 'flow:post-status',
        version: '3',
        allowedPointers: ['properties.fields.body'],
      },
    ],
    catalog: summarizePresentationCatalog(CATALOG),
    examples: [],
    ...overrides,
  };
}

function validModelOutput(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    root: {
      kind: 'layout',
      id: 'entity-shell',
      role: 'primary-content',
      layout: 'stack',
      children: [
        {
          kind: 'word',
          id: 'primary-content',
          role: 'primary-content',
          word: 'prose',
          bindings: {
            value: {
              kind: 'property',
              subject: '$slot:subject.rel',
              path: 'properties.fields.body',
            },
          },
        },
      ],
    },
  };
}

interface MutableModelOutput {
  root: {
    children: Array<{
      word: string;
      bindings: { value: Record<string, unknown> };
    }>;
  };
}

function mutableModelOutput(): MutableModelOutput {
  return structuredClone(validModelOutput()) as unknown as MutableModelOutput;
}

function sseResponse(text: string): Response {
  const chunks = [
    {
      id: 'chatcmpl-presentation',
      object: 'chat.completion.chunk',
      created: 1,
      model: CONFIG.model,
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-presentation',
      object: 'chat.completion.chunk',
      created: 1,
      model: CONFIG.model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('Presentation Agent context boundary', () => {
  it('projects only bounded definitions, scenario, live catalog summary, and examples', () => {
    const contaminated = {
      ...input(),
      chatHistory: [{ role: 'user', content: 'private chat literal' }],
      principal: 'user:alice',
      sessionId: 'session:secret',
    } as PresentationGenerationInput;

    const prompt = buildPresentationPrompt(contaminated);

    expect(prompt).toContain('entity-inspect:post');
    expect(prompt).toContain('catalog-v3');
    expect(prompt).toContain('flow:post-status');
    expect(prompt).not.toContain('private chat literal');
    expect(prompt).not.toContain('user:alice');
    expect(prompt).not.toContain('session:secret');
    expect(prompt).toContain('binding-only');
    expect(prompt).toContain('"kind":"layout"');
    expect(prompt).toContain('"kind":"property"');
  });

  it('rejects over-budget examples before transport', async () => {
    const transport = createScriptedTransport(() =>
      sseResponse(JSON.stringify(validModelOutput())),
    );
    const agent = createPresentationAgent({ ...CONFIG, fetchImpl: transport.fetch });
    const result = await agent.generate(
      input({
        examples: Array.from({ length: 4 }, (_, index) => ({
          scenarioKind: 'entity-inspect',
          surfaceTemplate: { ...validModelOutput(), example: index },
        })),
      }),
    );

    expect(result).toMatchObject({ status: 'failed', reasonCode: 'context-invalid' });
    expect(transport.calls).toHaveLength(0);
  });

  it('rejects a factual example before it can enter the Presentation prompt', async () => {
    const transport = createScriptedTransport(() =>
      sseResponse(JSON.stringify(validModelOutput())),
    );
    const agent = createPresentationAgent({ ...CONFIG, fetchImpl: transport.fetch });
    const factualExample = { ...validModelOutput(), title: 'live article title' };

    const result = await agent.generate(
      input({ examples: [{ scenarioKind: 'entity-inspect', surfaceTemplate: factualExample }] }),
    );

    expect(result).toMatchObject({ status: 'failed', reasonCode: 'context-invalid' });
    expect(transport.calls).toHaveLength(0);
  });
});

describe('Presentation candidate parser', () => {
  it('accepts a parameterized, catalog-backed binding tree and adds trusted provenance', () => {
    const result = parsePresentationCandidate(JSON.stringify(validModelOutput()), input(), {
      model: CONFIG.model,
      generatedAt: '2026-08-23T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'candidate',
      candidate: {
        key: { scenario: 'entity-inspect:post' },
        slots: [{ name: 'subject.rel', kind: 'entity' }],
        dependencies: [
          { kind: 'definition', subject: 'application:publishing', version: '7' },
          { kind: 'definition', subject: 'flow:post-status', version: '3' },
          { kind: 'catalog', subject: 'ui4a-core', version: 'catalog-v3' },
        ],
        provenance: {
          model: CONFIG.model,
          generatedAt: '2026-08-23T00:00:00.000Z',
        },
      },
    });
    if (result.status !== 'candidate') throw new Error('expected candidate');
    expect(validateRecipeCandidate(result.candidate, CATALOG)).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ['live factual literal', () => ({ ...validModelOutput(), title: '这是第一篇完整文章' })],
    ['principal field', () => ({ ...validModelOutput(), principal: 'user:alice' })],
    ['session identifier', () => ({ ...validModelOutput(), sessionId: 'session:abc' })],
    [
      'unknown catalog word',
      () => {
        const output = mutableModelOutput();
        output.root.children[0].word = 'invented-card';
        return output;
      },
    ],
    [
      'unbound subject slot',
      () => {
        const output = mutableModelOutput();
        output.root.children[0].bindings.value.subject = '$slot:subject.missing';
        return output;
      },
    ],
    [
      'direct factual binding',
      () => {
        const output = mutableModelOutput();
        output.root.children[0].bindings.value = { kind: 'property', value: 'secret body' };
        return output;
      },
    ],
  ])('rejects %s without throwing', (_label, buildOutput) => {
    const result = parsePresentationCandidate(JSON.stringify(buildOutput()), input(), {
      model: CONFIG.model,
      generatedAt: '2026-08-23T00:00:00.000Z',
    });
    expect(result).toMatchObject({ status: 'failed', reasonCode: 'output-invalid' });
  });

  it('rejects a path not declared by the bounded definition context', () => {
    const output = mutableModelOutput();
    output.root.children[0].bindings.value.path = 'properties.private';

    const result = parsePresentationCandidate(JSON.stringify(output), input(), {
      model: CONFIG.model,
      generatedAt: '2026-08-23T00:00:00.000Z',
    });

    expect(result).toMatchObject({ status: 'failed', reasonCode: 'output-invalid' });
  });
});

describe('Presentation Agent transport', () => {
  const previous = {
    key: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
  };

  beforeEach(() => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    if (previous.key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previous.key;
    if (previous.baseURL === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = previous.baseURL;
    if (previous.model === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = previous.model;
  });

  it('returns an honest structured failure when provider profile is unavailable', async () => {
    const agent = createPresentationAgent();
    await expect(agent.generate(input())).resolves.toMatchObject({
      status: 'failed',
      reasonCode: 'configuration-unavailable',
    });
  });

  it('uses injected OpenAI-protocol transport and returns the candidate', async () => {
    const transport = createScriptedTransport(() =>
      sseResponse(JSON.stringify(validModelOutput())),
    );
    const agent = createPresentationAgent({ ...CONFIG, fetchImpl: transport.fetch });

    const result = await agent.generate(input());

    expect(result.status).toBe('candidate');
    expect(transport.calls).toHaveLength(1);
    const body = JSON.stringify(transport.calls[0]!.body);
    expect(body).toContain(CONFIG.model);
    expect(body).toContain('entity-inspect:post');
    expect(body).not.toContain('chatHistory');
  });

  it('turns provider and malformed-output failures into structured results', async () => {
    const provider = createScriptedTransport(
      () => new Response('provider unavailable', { status: 503 }),
    );
    const malformed = createScriptedTransport(() => sseResponse('not-json'));

    await expect(
      createPresentationAgent({ ...CONFIG, fetchImpl: provider.fetch }).generate(input()),
    ).resolves.toMatchObject({ status: 'failed', reasonCode: 'transport-failed' });
    await expect(
      createPresentationAgent({ ...CONFIG, fetchImpl: malformed.fetch }).generate(input()),
    ).resolves.toMatchObject({ status: 'failed', reasonCode: 'output-invalid' });
  });
});
