/**
 * T12 Phase A / Task 2 — 真实 GLM 门控:render LLM 路径实测
 * (RUN_LLM_E2E + GLM_API_KEY 双门控,默认 skip;与 llm-smoke/llm-thinking 同模式)。
 *
 * spec 验收 2 的门控部分:rule miss 的展示意图经 LLM 路径产 spec、过校验
 * (零字面 + 处境核对 + bindSchema)、凝固留痕、画布渲染。真实 glm-5.3 端点
 * (D20;简单步 4-9s[D22],render 为单次生成,超时给足)。
 *
 * ```bash
 * GLM_API_KEY=$(cat ~/.secrets/glm_coding_plan_key) RUN_LLM_E2E=1 \
 *   CI=true pnpm exec playwright test e2e/llm-render.spec.ts
 * ```
 *
 * 意图设计(确定性 rule miss):「按分类可视化当前内容」——
 * - hasDisplayIntent 命中(「可视化」∈ DISPLAY_TOKENS),过展示意图前置闸;
 * - collectionOf 确定性 miss:意图零 ascii 词元(无 articles/comments 词元命中
 *   sitemap 集合面),且不含 NOUN_LEXICON 中文名词(文章/评论)——rule 词表对
 *   种子域内「展示 + 已知集合」几乎全覆盖(必产 table/chart),miss 只能由
 *   「展示意图不点名集合」构造;「分类」虽 ∈ DIMENSION_LEXICON,但 collectionOf
 *   miss 在先使维度分支不可达,不影响 miss 的确定性;
 * - 故响应携带 render 载荷 ⇔ 走了 LLM fallthrough(rule 路径不可能产出)。
 *
 * 断言(每次凝固载荷必过——「若凝固则形状合法」立即失败,不重试):
 * 1. 响应为 SSE render 帧(渲染 LLM 路径 inline 已 SSE 化:thinking-delta
 *    增量 + render 帧回执,载荷与旧 JSON 回执同形;final 帧 = 诚实失败交回
 *    普通循环)+ 凝固留痕(render-spec-frozen
 *    事件 detail.spec 与载荷一致、requestedBy.actor=agent);
 * 2. spec.component 取自词汇表(/api/render/catalog,D12 同源)+ bind 递归零
 *    字面(validateSpec;bindSchema 校验与画布 planSurface 同源,画布干净渲染
 *    即其 e2e 级证据);
 * 3. 画布(/canvas?concern=…):surface 可见 + data-active + 词条 DOM 可见 +
 *    零页面错误 + 本 concern 零规划失败;chart 词条额外与实体快照逐项对拍
 *    (aria-label 维度计数,s5 的 I2 手法,期望值从 /api/entity 快照动态计算)。
 *
 * 稳定性口径(实测后选择「每轮硬断言 + 有界重试」):
 * - 探测(2026-08,真实 glm-5.3):本意图 11 个 chat 回合 100% 过三闸(5 次
 *   fresh 生成,其余同 concern 凝固复用);fresh 生成 2/5 附加 caption 字段引用
 *   (成员级路径挂在集合实体上,画布 plan 期 deref 响亮失败:canvas-errors 留痕
 *   「字段路径 fields.category 在实体 articles 上不存在」,本 concern surface 不
 *   渲染,其余 surface 无恙——已实测)。「过闸但渲染断裂」是生产侧缺口(另测得:
 *   kanban 导向意图 2/2 fresh 产 collection+dimension 绑定,过闸但 kanban 运行时
 *   asMembers 拒聚合结果,React 渲染期抛错且无错误边界,画布全页归零——已实测),
 *   按非目标如实报告,不在本任务修生产代码;
 * - 口径:最多 MAX_ROUNDS 轮(chat + 画布走查),画布干净渲染的首轮跑全量断言
 *   后收官;零过闸或零干净渲染如实失败(逐轮报告随断言输出,不恒绿空转)。
 *   单轮干净渲染率约 3/5,5 轮成功率 > 99%。
 *
 * 观测(逐轮 outcome/concern/component/bind/时延)打印到 stdout;不含任何凭证。
 */
import { expect, test } from '@playwright/test';

import { validateSpec } from '../apps/web/src/render/validator';

import { SCENARIO_BASE, withFreshServer } from './server-kit';

test.skip(
  !process.env.RUN_LLM_E2E || !process.env.GLM_API_KEY,
  'RUN_LLM_E2E/GLM_API_KEY 未设置(真实 GLM render 门控,默认 skip)',
);

test.beforeEach(() => {
  test.setTimeout(420_000);
});

/** 门控意图:确定性 rule miss 的展示意图(设计与证据见文件头注释)。 */
const INTENT = '按分类可视化当前内容';

/** 重试上限(画布干净渲染口径;稳定性口径见文件头注释)。 */
const MAX_ROUNDS = 5;

/** render 短路响应载荷(route.ts respondWithFrozenSpec 的消费面子集)。 */
interface ChatRenderResponse {
  outcome: string;
  driver: string;
  summary?: string | null;
  render?: {
    concern: string;
    spec: { concern: string; component: string; bind: Record<string, unknown> };
    frozenNow: boolean;
    canvasUrl: string;
  };
}

/** SSE 终帧消费面(诚实失败交回普通循环时的报告原料;llm-smoke 同口径)。 */
interface SseFinalFrame {
  type: string;
  payload?: { outcome?: string; summary?: string | null };
}

/** /api/events 读回行(本 spec 只消费这些字段)。 */
interface LoggedEvent {
  kind: string;
  detail: unknown;
}

/** render-spec-frozen detail(engine render-spec.ts RenderSpecFrozenDetail 的镜像)。 */
interface RenderSpecFrozenDetail {
  concern: string;
  spec: { concern: string; component: string; bind: unknown };
  requestedBy: { actor: string };
}

/** 沿属性路径下钻(与 deref walkPath 同口径;快照对拍的期望值计算用)。 */
function walkPath(source: unknown, path: readonly string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** bind 中的集合引用节点(chart series 消费面;非集合引用节点返回 undefined)。 */
function collectionRefOf(
  bind: Record<string, unknown>,
  key: string,
): { collection: string; dimension?: string } | undefined {
  const node = bind[key];
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return undefined;
  // 断言理由:上方已排除 null/数组,object 即 JSON 对象(Record 收窄)。
  const record = node as Record<string, unknown>;
  if (typeof record.collection !== 'string') return undefined;
  return {
    collection: record.collection,
    ...(typeof record.dimension === 'string' ? { dimension: record.dimension } : {}),
  };
}

/**
 * 期望 chart aria-label:/api/entity 快照成员按维度路径分组计数(与 deref 同口径:
 * 组序 = 维度值在成员序上的首次出现序;s5 articlesByCategory 的泛化)。
 */
async function expectedChartLabel(collection: string, dimension: string): Promise<string> {
  const response = await fetch(`${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent(collection)}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    entities: { properties: Record<string, unknown> }[];
  };
  const segments = dimension.split('.');
  if (segments[0] !== collection) {
    throw new Error(`维度 "${dimension}" 的 rel 前缀与集合 "${collection}" 不一致(快照对拍口径)`);
  }
  const path = segments.slice(1);
  const counts = new Map<string, number>();
  for (const member of body.entities) {
    const value = walkPath(member.properties, path);
    if (value === undefined) {
      throw new Error(`快照成员缺维度路径 "${path.join('.')}"(deref 必已先失败,不该走到这里)`);
    }
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return `维度计数:${[...counts.entries()].map(([key, count]) => `${key}=${count}`).join(', ')}`;
}

test('真实 GLM:rule miss 展示意图 → LLM 产 spec → 过闸凝固 → 画布渲染', async ({ page }) => {
  await withFreshServer(async () => {
    // 词汇表词名清单(component 取自词汇表的断言数据源;目录与注册表同源,D12)。
    const catalogResponse = await fetch(`${SCENARIO_BASE}/api/render/catalog`);
    expect(catalogResponse.status).toBe(200);
    const catalog = ((await catalogResponse.json()) as { components: Record<string, unknown> })
      .components;

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    const roundReports: string[] = [];
    let renderRounds = 0;
    let rendered: { concern: string; component: string } | null = null;

    for (let round = 1; round <= MAX_ROUNDS && rendered === null; round += 1) {
      const startedAt = Date.now();
      const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: `llm-render-r${round}-${Date.now()}`,
          driver: 'llm',
          goal: { verb: INTENT },
        }),
      });
      const elapsedMs = Date.now() - startedAt;
      const contentType = response.headers.get('content-type') ?? '';

      // 渲染路径 SSE 化(inline):render 帧 = 过闸回执(载荷与旧 JSON 同形);
      // final 帧 = 诚实失败交回普通循环(不留半成品 spec,不凝固),如实记录
      // 后进入下一轮。防御性保留 JSON 分支(非 inline 形态/未来回归)。
      let json: ChatRenderResponse | undefined;
      if (contentType.includes('text/event-stream')) {
        const raw = await response.text();
        const frames = raw
          .split('\n\n')
          .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data:')))
          .filter((line): line is string => line !== undefined)
          .map((line) => JSON.parse(line.slice('data:'.length).trim()) as SseFinalFrame);
        const renderFrame = frames.find((frame) => frame.type === 'render');
        if (renderFrame === undefined) {
          const finalFrame = frames.find((frame) => frame.type === 'final');
          roundReports.push(
            `#${round} 交回普通循环(${elapsedMs}ms):outcome=${finalFrame?.payload?.outcome ?? '?'} ` +
              `summary=${finalFrame?.payload?.summary ?? ''}`,
          );
          continue;
        }
        json = renderFrame.payload as ChatRenderResponse;
      } else {
        json = (await response.json()) as ChatRenderResponse;
      }
      if (json.render === undefined) {
        roundReports.push(
          `#${round} 响应无 render 载荷(${elapsedMs}ms):${json.outcome} ${json.summary ?? ''}`,
        );
        continue;
      }
      renderRounds += 1;
      const render = json.render;
      const spec = render.spec;

      // —— 验收 1/2:每次凝固载荷的形状硬断言(「若凝固则形状合法」,立即失败)——
      expect(json.outcome, `第 ${round} 轮 outcome`).toBe('done');
      expect(
        json.driver,
        `第 ${round} 轮 driver=llm(确定性 rule miss ⇒ render 载荷只能来自 LLM 路径)`,
      ).toBe('llm');
      expect(spec.concern).toBe(render.concern);
      expect(
        catalog[spec.component],
        `第 ${round} 轮 component "${spec.component}" 须取自词汇表`,
      ).toBeDefined();
      expect(validateSpec(spec), `第 ${round} 轮 bind 递归零字面(铁律 2)`).toEqual({
        valid: true,
      });
      expect(render.canvasUrl).toBe(`/canvas?concern=${encodeURIComponent(render.concern)}`);

      // 凝固留痕:render-spec-frozen 事件 detail.spec 与响应载荷同 spec,actor=agent。
      const eventsResponse = await fetch(`${SCENARIO_BASE}/api/events`);
      const events = ((await eventsResponse.json()) as { events: LoggedEvent[] }).events;
      const frozen = events
        .filter((event) => event.kind === 'render-spec-frozen')
        .map((event) => event.detail as RenderSpecFrozenDetail)
        .find((detail) => detail.concern === render.concern);
      expect(frozen, `第 ${round} 轮凝固事件发生(render-spec-frozen)`).toBeDefined();
      expect(frozen!.spec, `第 ${round} 轮凝固 spec 与响应载荷一致`).toEqual(spec);
      expect(frozen!.requestedBy.actor).toBe('agent');

      // —— 验收 3:画布走查(非抛出筛查;干净渲染才进入全量断言)——
      const errorsBefore = pageErrors.length;
      await page.goto(`${SCENARIO_BASE}${render.canvasUrl}`);
      const surface = page.locator(`[data-concern="${render.concern}"]`);
      const surfaceVisible = await surface
        .waitFor({ timeout: 30_000 })
        .then(() => true, () => false);
      const canvasErrorItems = await page
        .locator('[data-testid="canvas-errors"] li')
        .allTextContents();
      const ownPlanErrors = canvasErrorItems.filter((item) =>
        item.startsWith(`${render.concern}:`),
      );
      const newPageErrors = pageErrors.slice(errorsBefore);
      const wordCount = surfaceVisible
        ? await surface.locator(`[data-word="${spec.component}"]`).count()
        : 0;

      if (!surfaceVisible || wordCount === 0 || ownPlanErrors.length > 0 || newPageErrors.length > 0) {
        roundReports.push(
          `#${round} 过闸但画布未干净渲染(${elapsedMs}ms):${render.concern}/${spec.component} ` +
            `bind=${JSON.stringify(spec.bind)} surface=${surfaceVisible} word=${wordCount} ` +
            `planErrors=${JSON.stringify(ownPlanErrors)} pageErrors=${JSON.stringify(newPageErrors)}`,
        );
        continue;
      }

      // 干净渲染的首轮:全量断言(含 chart 数值与实体快照逐项对拍,I2 e2e 级)。
      rendered = { concern: render.concern, component: spec.component };
      await expect(surface, '激活 surface 须 data-active(chat 回执的画布入口形态)').toHaveAttribute(
        'data-active',
        'true',
      );
      const word = surface.locator(`[data-word="${spec.component}"]`);
      await expect(word, `词条 ${spec.component} 可见`).toBeVisible();
      const series = collectionRefOf(spec.bind, 'series');
      if (spec.component === 'chart' && series?.dimension !== undefined) {
        const expectedLabel = await expectedChartLabel(series.collection, series.dimension);
        await expect(word, 'chart 数值与实体快照逐项一致(不发明、不丢失)').toHaveAttribute(
          'aria-label',
          expectedLabel,
        );
        await expect(word.locator('svg'), '图表主体真实渲染(SVG,非空占位)').toBeVisible();
      }
      roundReports.push(
        `#${round} 画布干净渲染(${elapsedMs}ms):${render.concern}/${spec.component} ` +
          `bind=${JSON.stringify(spec.bind)} frozenNow=${render.frozenNow}`,
      );
    }

    // —— 硬底线(不恒绿空转):LLM 路径至少过闸一次 + 至少一轮完整路径 ——
    console.log(`[llm-render] 逐轮报告:\n${roundReports.join('\n')}`);
    expect(
      renderRounds,
      `LLM 路径至少过闸一次(产 render 载荷):\n${roundReports.join('\n')}`,
    ).toBeGreaterThanOrEqual(1);
    expect(
      rendered !== null,
      `至少一轮完整路径(凝固 + 画布干净渲染):\n${roundReports.join('\n')}`,
    ).toBe(true);
    console.log(
      `[llm-render] 观测:过闸轮次=${renderRounds}/${Math.min(MAX_ROUNDS, roundReports.length)},` +
        `成功路径=${rendered === null ? '(无)' : `${rendered.concern}(${rendered.component})`}`,
    );
  });
});
