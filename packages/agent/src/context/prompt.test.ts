import type { SirenEntity } from '@ui4a/engine';
import { describe, expect, it } from 'vitest';

import { createLlmDriver } from '../llm/llm-driver';
import { buildUserPrompt } from '../llm/prompts';
import type { DriverContext } from '../types';
import { describeWorkingContext, WORKING_CONTEXT_PROMPT_BYTES } from './prompt';
import type { WorkingContext } from './working-context';

function entity(rel: string): SirenEntity {
  return {
    class: ['resource'],
    properties: {
      rel,
      identity: `资源 ${rel}`,
      status: 'ready',
      fields: { title: `标题 ${rel}`, body: 'RELATED_BODY_MUST_NOT_LEAK'.repeat(5000) },
      presentation: {
        version: 1,
        fields: [
          { path: 'properties.fields.title', title: '标题', role: 'identity', overview: true },
          { path: 'properties.fields.body', title: '正文', role: 'primary-content' },
        ],
      },
    },
    actions: [
      {
        name: 'foreign-effect',
        title: '关联对象动作',
        method: 'POST',
        href: '/api/exec',
        fields: { type: 'object', properties: {} },
      },
    ],
    links: [],
  };
}

function workingContext(): WorkingContext {
  const root = entity('thread:release');
  root.class = ['work-thread'];
  root.properties.goal = { text: '交付公告', source: 'message:explicit-goal' };
  root.entities = [entity('unrelated:secret')];
  return {
    rel: 'thread:release',
    entity: root,
    references: Array.from({ length: 4 }, (_, index) => ({
      rel: `work:${index}`,
      categories: ['active'],
    })),
    observations: Array.from({ length: 4 }, (_, index) => ({
      rel: `work:${index}`,
      entity: entity(`work:${index}`),
    })),
    unavailable: false,
    truncated: 0,
  };
}

function context(): DriverContext {
  return {
    goal: { verb: '还剩哪些工作' },
    entity: { ...entity('focused:item'), actions: [] },
    currentRel: 'focused:item',
    workingContext: workingContext(),
    trail: [],
    successes: [],
    sitemap: {
      version: 'eight-apps',
      surfaces: Array.from({ length: 24 }, (_, index) => ({
        rel: `entry:${index}`,
        title: `入口 ${index}`,
        app: `app-${index % 8}`,
      })),
      applications: Array.from({ length: 8 }, (_, index) => ({
        name: `app-${index}`,
        title: `应用 ${index}`,
        intent: `应用 ${index} 的工作用途`,
        entry: { role: 'primary-collection', target: `entry:${index}` },
        flows: [
          {
            name: `flow-${index}`,
            title: `流程 ${index}`,
            actions: [{ name: 'advance', title: '推进', node: 'open', guards: ['authorized'] }],
          },
        ],
      })),
    },
  };
}

function answerResponse(): Response {
  const delta = {
    tool_calls: [
      {
        index: 0,
        id: 'call_context',
        type: 'function',
        function: {
          name: 'answer',
          arguments: JSON.stringify({
            content: '工作进度',
            sources: [{ rel: 'work:0', pointer: '/properties/status' }],
          }),
        },
      },
    ],
  };
  const chunk = {
    id: 'chatcmpl-context',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'test',
    choices: [{ index: 0, delta, finish_reason: 'tool_calls' }],
  };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('bounded work-context cognition and provider tools', () => {
  it('retains goal source and related identity/status without bodies, actions or hidden members', () => {
    const described = describeWorkingContext(workingContext());
    expect(described).toContain('message:explicit-goal');
    expect(described).toContain('work:3');
    expect(described).toContain('ready');
    expect(described).not.toContain('RELATED_BODY_MUST_NOT_LEAK');
    expect(described).not.toContain('foreign-effect');
    expect(described).not.toContain('unrelated:secret');
    expect(new TextEncoder().encode(described).byteLength).toBeLessThanOrEqual(
      WORKING_CONTEXT_PROMPT_BYTES,
    );
  });

  it('oversized values are omitted whole, and arbitrarily large reference text stays bounded', () => {
    const working = workingContext();
    working.entity!.properties.identity = '大'.repeat(10000);
    working.references[0]!.rel = 'huge'.repeat(10000);
    const described = describeWorkingContext(working);
    expect(described).not.toContain('大');
    expect(described).toContain('omittedProperties');
    expect(new TextEncoder().encode(described).byteLength).toBeLessThanOrEqual(
      WORKING_CONTEXT_PROMPT_BYTES,
    );
  });

  it('revoked root drops its facts and reference navigation', () => {
    const current = context();
    current.workingContext = {
      rel: 'thread:release',
      unavailable: true,
      references: [],
      observations: [],
      truncated: 0,
    };
    const prompt = buildUserPrompt(current);
    expect(prompt).not.toContain('message:explicit-goal');
    expect(prompt).not.toContain('work:0');
    expect(prompt).toContain('"unavailable":true');
  });

  it('full provider wire stays <=32KiB and only current entity actions can become tools', async () => {
    const current = context();
    current.entity.properties.fields = { title: '当前对象' };
    let wire = '';
    const driver = createLlmDriver({
      apiKey: 'test-key',
      baseURL: 'https://provider.test/v1',
      model: 'test',
      fetchImpl: async (_url, init) => {
        wire = String(init?.body);
        return answerResponse();
      },
    });
    expect(await driver.decide(current)).toMatchObject({ kind: 'answer' });
    expect(new TextEncoder().encode(wire).byteLength).toBeLessThanOrEqual(32 * 1024);
    expect(wire).not.toContain('RELATED_BODY_MUST_NOT_LEAK');
    const body = JSON.parse(wire) as {
      tools: {
        function: { name: string; parameters: { properties: { rel?: { enum?: string[] } } } };
      }[];
    };
    const navigate = body.tools.find(({ function: tool }) => tool.name === 'navigate')!;
    expect(navigate.function.parameters.properties.rel?.enum).toContain('work:3');
    expect(navigate.function.parameters.properties.rel?.enum).toContain('thread:release');
    expect(body.tools.some(({ function: tool }) => tool.name === 'action_foreign-effect')).toBe(
      false,
    );
  });
});
