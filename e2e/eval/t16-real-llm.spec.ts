import { expect, test } from '@playwright/test';
import { createPresentationRevisionAgent } from '@ui4a/agent';
import {
  applyRenderPatch,
  createRenderPatchTarget,
  validateSurfaceTree,
  type SurfaceNode,
  type SurfaceTree,
} from '../../packages/engine/src/index';
import { runPresentationResponsibilityStory } from './presentation-responsibility-story';

import {
  captureReadOnlyStory,
  isolatedEvalDatabaseUrl,
  loadLlmEvalProfile,
  runEvalTurn,
  withIsolatedStoryServer,
} from '../kits/story-eval-kit';

const RUN_LLM_EVAL = process.env.RUN_LLM_EVAL === '1';
test.skip(!RUN_LLM_EVAL, 'RUN_LLM_EVAL=1 is required for T16 real-LLM acceptance');
const variants = [
  '当前应用是干啥的？',
  '当前这个应用主要解决什么问题？',
  '介绍一下这个内容发布应用能做什么。',
  '这里有哪些主要流程和可操作资源？',
  '如果我是新用户，这个应用是干嘛的？',
];

test('T57 G4: real Presentation revisions preserve responsibility through generic, Recipe and Sidecar', async ({}, testInfo) => {
  test.setTimeout(600_000);
  expect(process.env.DATABASE_URL).toBe(isolatedEvalDatabaseUrl());
  const profile = loadLlmEvalProfile();
  const evidence: unknown[] = [];
  try {
    await withIsolatedStoryServer(profile, (base) =>
      runPresentationResponsibilityStory(base, profile, evidence),
    );
  } finally {
    await testInfo.attach('presentation-responsibility-real-llm-evidence.json', {
      body: Buffer.from(
        JSON.stringify({ schemaVersion: 1, model: profile.model, evidence }, null, 2),
      ),
      contentType: 'application/json',
    });
  }
});

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
  const surface: SurfaceTree = {
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
          kind: 'slot' as const,
          id: 'subject-region',
          role: 'primary-content' as const,
          name: 'subject',
          dependencies: [],
          provenance: [{ kind: 'generic-fallback' as const, ref: 'fixture' }],
          child: {
            kind: 'layout' as const,
            id: 'subject-content',
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
                dependencies: [
                  { kind: 'catalog', subject: 'catalog:t16', version: '1' },
                  {
                    kind: 'entity',
                    subject: 'post:first-post',
                    version: 'fixture',
                    paths: ['properties.fields.body'],
                  },
                ],
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
                dependencies: [
                  { kind: 'catalog', subject: 'catalog:t16', version: '1' },
                  {
                    kind: 'entity',
                    subject: 'post:first-post',
                    version: 'fixture',
                    paths: ['$actions'],
                  },
                ],
                provenance: [{ kind: 'generic-fallback' as const, ref: 'fixture' }],
              },
            ],
          },
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
  expect(validateSurfaceTree(surface, catalog).valid, 'S24 fixture must be a valid Surface').toBe(
    true,
  );
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
  function pathTo(node: SurfaceNode, id: string): SurfaceNode[] | undefined {
    if (node.id === id) return [node];
    const children =
      node.kind === 'layout'
        ? node.children
        : node.kind === 'slot'
          ? [node.child]
          : node.kind === 'repeat'
            ? [node.item]
            : [];
    for (const child of children) {
      const path = pathTo(child, id);
      if (path !== undefined) return [node, ...path];
    }
    return undefined;
  }
  const checks = results.map((result) => {
    if (result.status !== 'patch') return { passed: false, status: result.status };
    const applied = applyRenderPatch(createRenderPatchTarget(surface), result.patch, catalog, 7);
    if (!applied.ok) return { passed: false, status: 'invalid-patch', reason: applied.reason };
    const bodyPath = pathTo(applied.target.surface.root, 'body');
    const actionsPath = pathTo(applied.target.surface.root, 'actions');
    const collapsed = new Set(applied.target.collapsedNodeIds);
    const bodyVisible = bodyPath !== undefined && bodyPath.every((node) => !collapsed.has(node.id));
    const actionsCollapsed = actionsPath !== undefined && collapsed.has(actionsPath.at(-1)!.id);
    // Density on the actual reading region is equivalent to density on its body leaf.
    // A closer explicit override wins; a collapsed reading ancestor never counts as emphasis.
    const readingDensity = bodyPath
      ?.filter((node) => node.role === 'primary-content')
      .map((node) => applied.target.densityByNodeId[node.id])
      .filter((density) => density !== undefined)
      .at(-1);
    const readingSpacious = readingDensity === 'spacious';
    return {
      passed: actionsCollapsed && bodyVisible && readingSpacious,
      status: 'applied',
      actionsCollapsed,
      bodyVisible,
      readingSpacious,
    };
  });
  const passed = checks.filter((check) => check.passed);
  await testInfo.attach('t16-s24-real-llm-evidence.json', {
    body: Buffer.from(
      JSON.stringify(
        { schemaVersion: 1, model: profile.model, instructions, results, checks },
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });
  expect(passed.length / instructions.length).toBeGreaterThanOrEqual(0.8);
  expect(JSON.stringify(results)).not.toMatch(/className|css|pixel|<script/i);
});
