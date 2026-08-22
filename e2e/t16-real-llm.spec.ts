import { expect, test } from '@playwright/test';
import { createPresentationRevisionAgent } from '@ui4a/agent';

import {
  captureReadOnlyStory,
  isolatedEvalDatabaseUrl,
  loadLlmEvalProfile,
  runEvalTurn,
  withIsolatedStoryServer,
} from './story-eval-kit';

const RUN_LLM_EVAL = process.env.RUN_LLM_EVAL === '1';
test.skip(!RUN_LLM_EVAL, 'RUN_LLM_EVAL=1 is required for T16 real-LLM acceptance');
test.describe.configure({ mode: 'serial' });

const variants = [
  '当前应用是干啥的？',
  '当前这个应用主要解决什么问题？',
  '介绍一下这个内容发布应用能做什么。',
  '这里有哪些主要流程和可操作资源？',
  '如果我是新用户，这个应用是干嘛的？',
];

test('S1/S3: real Chat understands the application and current Markdown layers', async ({}, testInfo) => {
  test.setTimeout(600_000);
  expect(process.env.DATABASE_URL).toBe(isolatedEvalDatabaseUrl());
  const profile = loadLlmEvalProfile();
  const result = await withIsolatedStoryServer(profile, (baseUrl) =>
    captureReadOnlyStory(baseUrl, async () => {
      const turns = [];
      for (const [index, text] of variants.entries()) {
        turns.push(await runEvalTurn(baseUrl, `t16-s1-${index}`, `t16-s1-${index}:1`, text));
      }
      turns.push(
        await runEvalTurn(
          baseUrl,
          't16-s3',
          't16-s3:1',
          '请分别说明聊天、展示词汇表和文章字段是否支持 Markdown。',
        ),
      );
      return turns;
    }),
  );
  await testInfo.attach('t16-real-llm-evidence.json', {
    body: Buffer.from(JSON.stringify({ schemaVersion: 1, model: profile.model, result }, null, 2)),
    contentType: 'application/json',
  });
  expect(result.safety.passed).toBe(true);
  expect(
    result.turns.slice(0, variants.length).filter((turn) => turn.outcome === 'answered').length /
      variants.length,
  ).toBeGreaterThanOrEqual(0.8);
  expect(result.turns[variants.length]?.outcome).toBe('answered');
});

test('S24: real Presentation Agent produces semantic patches for five human phrasings', async ({}, testInfo) => {
  test.setTimeout(600_000);
  const profile = loadLlmEvalProfile();
  const agent = createPresentationRevisionAgent();
  const instructions = [
    '正文更突出，动作收起来。',
    '把阅读区域放宽松一点，并折叠操作区。',
    '我想专注阅读内容，弱化并收起那些按钮。',
    'Increase the body emphasis and collapse the actions region.',
    '让文章内容更醒目，操作工具先隐藏。',
  ];
  const surface = {
    schemaVersion: 1 as const,
    root: {
      kind: 'layout' as const,
      id: 'root',
      role: 'primary-content' as const,
      layout: 'stack' as const,
      dependencies: [],
      provenance: [{ kind: 'generic-fallback' as const, ref: 'fixture' }],
      children: [
        {
          kind: 'word' as const,
          id: 'body',
          role: 'primary-content' as const,
          word: 'prose',
          bindings: {
            value: {
              kind: 'property' as const,
              subject: 'post:first-post',
              path: 'properties.fields.body',
            },
          },
          dependencies: [],
          provenance: [{ kind: 'generic-fallback' as const, ref: 'fixture' }],
        },
        {
          kind: 'word' as const,
          id: 'actions',
          role: 'actions' as const,
          word: 'controls',
          bindings: {
            actions: { kind: 'actions' as const, subject: 'post:first-post' },
          },
          dependencies: [],
          provenance: [{ kind: 'generic-fallback' as const, ref: 'fixture' }],
        },
      ],
    },
  };
  const catalog = {
    id: 'catalog:t16',
    version: '1',
    words: {
      prose: {
        roles: ['primary-content' as const],
        bindings: { value: { sources: ['property' as const], required: true } },
      },
      controls: {
        roles: ['actions' as const],
        bindings: { actions: { sources: ['actions' as const], required: true } },
      },
    },
  };
  const results = [];
  for (const [index, instruction] of instructions.entries()) {
    results.push(
      await agent.revise({
        request: {
          sidecarId: 'sidecar:t16',
          baseVersion: 7,
          messageId: `message:${index}`,
          instruction,
        },
        surface,
        catalog,
      }),
    );
  }
  const passed = results.filter(
    (result) =>
      result.status === 'patch' &&
      result.patch.operations.length > 0 &&
      result.patch.operations.every(
        (operation) =>
          operation.kind === 'pin' || ['root', 'body', 'actions'].includes(operation.nodeId),
      ),
  );
  await testInfo.attach('t16-s24-real-llm-evidence.json', {
    body: Buffer.from(
      JSON.stringify({ schemaVersion: 1, model: profile.model, instructions, results }, null, 2),
    ),
    contentType: 'application/json',
  });
  expect(passed.length / instructions.length).toBeGreaterThanOrEqual(0.8);
  expect(JSON.stringify(results)).not.toMatch(/className|css|pixel|<script/i);
});
