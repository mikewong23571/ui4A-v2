import { Buffer } from 'node:buffer';

import type { SirenAction } from '@ui4a/engine';
import { afterAll, describe, expect, it } from 'vitest';

import { createLlmDriver } from './llm-driver';
import { buildLlmMessages } from './prompts';
import { createScriptedTransport, instanceEntity, type RecordedCall } from '../testkit/testkit';
import type { DriverContext, SitemapSummary } from '../types';

const DECIDE_WIRE_BUDGET_BYTES = 32 * 1024;
const textEncoder = new TextEncoder();

const TEST_LLM_CONFIG = {
  apiKey: 'test-key',
  baseURL: 'https://provider.test/v1',
  model: 'test-model',
} as const;

interface BudgetCase {
  name: string;
  app: string;
  rel: string;
  flow: string;
  action: SirenAction;
  goal: DriverContext['goal'];
}

interface BudgetMeasurement {
  name: string;
  messagesBytes: number;
  wireBytes: number;
}

const budgetCases: BudgetCase[] = [
  {
    name: 'business 文章阅读',
    app: 'publishing',
    rel: 'post:welcome',
    flow: 'post-status',
    action: action('archive', '归档文章'),
    goal: { verb: '阅读文章并概括正文', targetRel: 'post:welcome' },
  },
  {
    name: 'business 向导',
    app: 'editorial',
    rel: 'article-drafting:main',
    flow: 'article-drafting',
    action: action('next', '下一步'),
    goal: { verb: '继续填写文章向导', fields: { title: '操作流程' } },
  },
  {
    name: 'meta 定义治理',
    app: 'governance',
    rel: 'meta/draft:draft-1',
    flow: 'definition-governance',
    action: action('submit', '提交定义草案'),
    goal: { verb: '检查并提交定义草案', targetRel: 'meta/draft:draft-1' },
  },
];

const measurements: BudgetMeasurement[] = [];

function action(name: string, title: string): SirenAction {
  return {
    name,
    title,
    method: 'POST',
    href: '/api/exec',
    fields: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { note: { type: 'string', title: '说明' } },
      required: ['note'],
      additionalProperties: false,
    },
  };
}

function utf8Bytes(value: unknown): number {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const encodedBytes = textEncoder.encode(serialized).byteLength;
  expect(encodedBytes).toBe(Buffer.byteLength(serialized, 'utf8'));
  return encodedBytes;
}

function schema(marker: string): Record<string, unknown> {
  return {
    type: 'object',
    description: marker.repeat(12_000),
    properties: {
      payload: { type: 'string', description: marker.repeat(12_000) },
    },
  };
}

function sitemapFor(testCase: BudgetCase): {
  sitemap: SitemapSummary;
  marker: string;
  foreignRel: string;
} {
  const marker = `FOREIGN_SCHEMA_${testCase.app.toUpperCase()}_MUST_NOT_REACH_PROMPT`;
  const foreignRel = `foreign-${testCase.app}-entry`;
  const foreignApps = [`foreign-${testCase.app}-one`, `foreign-${testCase.app}-two`];
  const applications: SitemapSummary['applications'] = [
    {
      name: testCase.app,
      intent: `处理 ${testCase.name}`,
      flows: [
        {
          name: testCase.flow,
          title: `${testCase.name}流程`,
          actions: [
            {
              name: testCase.action.name,
              title: testCase.action.title,
              node: 'active',
              guards: ['authorized'],
            },
          ],
        },
      ],
    },
    ...foreignApps.map((app, index) => ({
      name: app,
      intent: `foreign application ${index + 1}`,
      flows: [
        {
          name: `${app}-flow`,
          title: `Foreign flow ${index + 1}`,
          actions: [
            {
              name: `foreign-action-${index + 1}`,
              title: `Foreign action ${index + 1}`,
              node: 'foreign',
              guards: [],
            },
          ],
        },
      ],
    })),
  ];
  const sitemap: SitemapSummary = {
    version: `budget-${testCase.app}-v1`,
    surfaces: [
      { rel: `${testCase.app}-home`, title: `${testCase.name}入口`, app: testCase.app },
      { rel: foreignRel, title: 'Foreign entry one', app: foreignApps[0] },
      {
        rel: `foreign-${testCase.app}-second-entry`,
        title: 'Foreign entry two',
        app: foreignApps[1],
      },
    ],
    applications,
    capabilities: [
      {
        name: `${testCase.app}-capability`,
        title: `${testCase.name} capability`,
        kind: 'transform',
        intent: `辅助 ${testCase.name}`,
        input: 'navigate to capability input contract by rel',
        output: 'navigate to capability output contract by rel',
        inputSchema: schema(marker),
        outputSchema: schema(marker),
        scope: { applications: [testCase.app], flows: [testCase.flow] },
      },
      ...foreignApps.map((app, index) => ({
        name: `${app}-capability`,
        title: `Foreign capability ${index + 1}`,
        kind: 'effect' as const,
        intent: `foreign capability intent ${index + 1}`,
        input: `foreign capability ${index + 1} input rel`,
        output: `foreign capability ${index + 1} output rel`,
        inputSchema: schema(marker),
        outputSchema: schema(marker),
        scope: { applications: [app], flows: [`${app}-flow`] },
      })),
    ],
  };
  expect(utf8Bytes(sitemap)).toBeGreaterThan(DECIDE_WIRE_BUDGET_BYTES);
  return { sitemap, marker, foreignRel };
}

function contextFor(testCase: BudgetCase): {
  context: DriverContext;
  marker: string;
  foreignRel: string;
} {
  const { sitemap, marker, foreignRel } = sitemapFor(testCase);
  const entity = instanceEntity({
    rel: testCase.rel,
    flow: testCase.flow,
    node: 'active',
    title: testCase.name,
    fields: { body: `当前 ${testCase.name} 的授权事实` },
    actions: [testCase.action],
    collection: `${testCase.app}-home`,
    guardResults: [{ action: testCase.action.name, blocked: false }],
  });
  return {
    marker,
    foreignRel,
    context: {
      goal: testCase.goal,
      app: testCase.app,
      currentRel: testCase.rel,
      entity,
      trail: [],
      successes: [],
      sitemap,
    },
  };
}

function sseToolResponse(toolName: string, args: unknown): Response {
  const chunks = [
    {
      id: 'chatcmpl-budget',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_budget',
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-budget',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function requestBody(calls: RecordedCall[]): Record<string, unknown> {
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toContain('/chat/completions');
  expect(calls[0]?.body).toBeDefined();
  return calls[0]!.body!;
}

describe('32 KiB decide prompt wire budget', () => {
  it.each(budgetCases)('$name: messages stay bounded without capability schemas', (testCase) => {
    const { context, marker, foreignRel } = contextFor(testCase);
    const serialized = JSON.stringify(buildLlmMessages(context));
    const messagesBytes = utf8Bytes(serialized);

    expect(messagesBytes).toBeLessThanOrEqual(DECIDE_WIRE_BUDGET_BYTES);
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain('inputSchema');
    expect(serialized).not.toContain('outputSchema');
    expect(serialized).toContain(testCase.action.name);
    expect(serialized).toContain(foreignRel);
  });

  it.each(budgetCases)(
    '$name: real driver request including tools stays within budget',
    async (testCase) => {
      const { context, marker, foreignRel } = contextFor(testCase);
      const transport = createScriptedTransport(() =>
        sseToolResponse('answer', {
          content: '已读取当前授权事实。',
          sources: [{ rel: testCase.rel, pointer: '/properties/fields/body' }],
        }),
      );
      const driver = createLlmDriver({ ...TEST_LLM_CONFIG, fetchImpl: transport.fetch });

      await expect(driver.decide(context)).resolves.toEqual({
        kind: 'answer',
        content: '已读取当前授权事实。',
        sources: [{ rel: testCase.rel, pointer: '/properties/fields/body' }],
      });

      const body = requestBody(transport.calls);
      const serialized = JSON.stringify(body);
      const wireBytes = utf8Bytes(serialized);
      const messagesBytes = utf8Bytes(buildLlmMessages(context));
      measurements.push({ name: testCase.name, messagesBytes, wireBytes });

      expect(wireBytes).toBeLessThanOrEqual(DECIDE_WIRE_BUDGET_BYTES);
      expect(serialized).not.toContain(marker);
      expect(serialized).not.toContain('FOREIGN_SCHEMA_');
      expect(serialized).toContain(`action_${testCase.action.name}`);
      expect(serialized).toContain(foreignRel);
    },
  );
});

afterAll(() => {
  process.stdout.write(`prompt budget bytes ${JSON.stringify(measurements)}\n`);
});
