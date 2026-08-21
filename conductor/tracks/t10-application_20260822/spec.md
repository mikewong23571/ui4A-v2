# T10 Application 切片 — Spec

> Track ID: `t10-application_20260822` · Type: Feature · 状态: approved(编排 agent 代行验收)
> 上下文:`DECISIONS.md` D19(六点演进路线,本 track = 路线 T1);`conductor/refs/arch-brief.md` §10;定义层 `packages/shared/src/definition.ts`;sitemap 推导 `packages/engine/src/sitemap.ts`;agent 循环 `packages/agent/src/loop.ts`、`rule-driver.ts`。

## Overview

引入 **application 作为定义平面实体**:归组 flows、**intent 为本体**(一段话声明"这个应用解决什么"),业务实例不重新归父,不做站点分裂。sitemap 从扁平 flows 升级为按 app 分组投影;agent 发现链从"读 sitemap 选 flow"升级为**两层发现**(选 app〔读 intent〕→ 选 flow);既有 flow 按域归类,无归属字段的统一落 `default`。

动机(D19):meta 服务个人工作流扩展,定义将持续生产且未经策划;发现层(sitemap flows 平铺)会退化回 CLI 式能力堆叠。application 补的是**发现层的语境**,不是裁决层的围墙。本 track 是六点路线的第一棒,为后续版本/archive(T2)、人类默认页(T3)、meta 可视化(T4)、角色 scope(T5)提供载体。

## 架构决定

1. **ApplicationDefinition(shared/definition.ts)**:`{name, title, intent, entry?}`——name 机器标识,title/intent 人类与 agent 共读,entry 声明默认入口(T3 默认页消费,本 track 仅落字段)。实体 rel 前缀 `meta/application:<name>`,与 `meta/flow:`、`meta/activation:` 同层。
2. **membership 方向:flow 声明归属,清单派生**。`FlowDefinition` 增可选字段 `app?: string`;application **不持成员清单**(避免双重真相),成员关系由推导时从 flow 定义聚合。**单属**:一个 flow 恰属一个 app;parse 归一化:缺省 → `'default'`。
3. **激活不变式第七条 `app-known`**:submit 时 flow.app(归一化后)必须指向已激活的 application 定义;非法引用被拒且留痕(定义平面非法显式拒,同 S2 哲学),不静默归并。`default` application 由 seed 保证始终激活。
4. **定义入日志同构扩展**:boot seed 把 application 定义与 flow 定义同等作为 active 定义事件入日志;fold 出活跃 app 定义;重放一致(I5 保持,扩展重放测试)。**meta 编辑动词本 track 不扩展**(add-app/set-intent 等归后续,同 T4 缓 remove-* 口径)——T1 的 app 定义经 seed 进入。
5. **sitemap 分组投影**:`Sitemap` 增 `applications: [{name, title, intent, flows: [...]}]`;扁平 `flows[]` **保留**(向后兼容,条目增 `app` 字段);surfaces 条目增 `app` 字段;version 仍为内容 hash,app 定义变更自动 bump(纯推导免费获得)。
6. **agent 两层发现(软边界)**:agent loop 静态上下文按 app 分组呈现(name+intent+flows);rule-driver 决策链第一层前加 **app 定位层**(目标相关性先匹配 app intent,再在该 app 内选 flow/资源)。**不做硬过滤**:links 可天然跨 app(超媒体原则,跨 app 深链合法);application 是发现层边界,不是裁决层围墙。startRel 机制不变。
7. **seed 分类**:既有业务 flows 按域归入 ≥2 个语义 app(如 `publishing` / `community`),`default` 仅作归一化兜底——保证两层发现在 demo 中真实可验。

## Acceptance Criteria

1. `CI=true pnpm check` 全绿;`CI=true pnpm e2e` 全过(既有零回归 + 新增);
2. parse/归一化单测:ApplicationDefinition 校验(name/title/intent 必填);flow.app 缺省 → default;指向未定义 app → 激活不变式 `app-known` 拒且留痕(422 + 事件带原因);
3. 定义入日志:application 定义事件参与 fold,重放后活跃 app 定义与在线一致(I5 扩展测试);
4. sitemap 合同测试:`/.well-known/ui4a.json` 含 applications 分组(name/title/intent/flows),扁平 flows 索引保留且条目带 app;app 定义变更后 version 变化;
5. agent 上下文:静态上下文按 app 分组、intent 在场(单测/合同测试);rule-driver app 定位层单测(目标词命中 app intent → 该 app 内入口优先);
6. 全回归:B1–B4 / S1–S5 / I1–I6 既有断言零改动通过(行为兼容:扁平 flows 保留);
7. demo 走查:sitemap JSON 人工可读确认 ≥2 个 app 分组各带 intent。

## Out of Scope(非目标)

- application 的 meta 编辑动词与 lifecycle 接入(add-app / set-intent / deprecate-app → 后续 track);
- 版本机制(app manifest 锁成员版本)与 archive 机制 → 路线 T2;
- `/app/<name>` 人类默认页、scoped chat → 路线 T3;meta 可视化 → 路线 T4;角色 archetype / policy scope → 路线 T5;
- 硬边界裁决(跨 app 动作拒绝)——明确不做,application 非站点分裂;
- 业务实例归父 / 数据平面改动——零改动。

## 施工上下文(自包含:subagent 无需再做 discovery)

**模块地图(精确触点)**:

- 定义层:`packages/shared/src/definition.ts`——FlowDefinition(:150-158)、实体 rel 前缀常量(:189-192,此处加 `meta/application:`);parse 在 `packages/engine/src/parse.ts`(parseFlowDefinition,模块加载即校验,非法定义响亮失败)。
- 激活不变式:`packages/engine/src/invariants.ts`(+ `invariants.test.ts`)——现有六项,`app-known` 加在这里;submit 时求值于 `packages/engine/src/meta.ts:305-381`。
- seed 源:`apps/web/src/domain/flows.ts`——既有 flow 共三个:article-drafting(B1 发布向导)/ post-status(B2 状态机)/ comment-moderation(B3 审核),导出 `businessFlowList`(声明序 = sitemap 展示序)。建议分组:`publishing` = {article-drafting, post-status},`community` = {comment-moderation};application seed 常量放同文件或新建 `apps/web/src/domain/applications.ts`(与 flow 同等 boot 入日志)。
- 定义入日志 / fold:boot seed 接线在 `apps/web/src/engine/service.ts`(definition-seeded 事件);fold 在 `packages/engine/src/fold.ts`(definitions 表)。
- sitemap:`packages/engine/src/sitemap.ts`——Sitemap 类型(:38-58)、deriveSitemap(:137-178);HTTP 暴露在 `apps/web/src/app/.well-known/ui4a.json/route.ts`。
- agent 视野:`packages/agent/src/types.ts:91-94` SitemapSummary(现仅 surfaces 的 rel/title)——Phase D 在此加 applications 分组;静态上下文组装在 `packages/agent/src/loop.ts:57-71`,决策分层在 `packages/agent/src/rule-driver.ts`。

**既有断言红线(不得破坏)**:业务站 sitemap 排除 `_meta`(e2e 有断言);扁平 `flows[]` 保留(e2e/合同测试既有消费);B1–B4/S1–S5/I1–I6 断言零改动。

**基础设施与命令**:PG `docker compose up -d --wait`(宿主 5433);单测 `CI=true pnpm vitest run <path>`;质量门 `CI=true pnpm check`;e2e `CI=true pnpm e2e`(自动起 3100 端口,D5)。**改 apps/web 前必读 `apps/web/AGENTS.md`**(本仓 Next.js 有破坏性变更,先读 `node_modules/next/dist/docs/` 相关指南再写码)。actor/principal 自报口径(D8)。subagent prompt 四要素合同见 `conductor/workflow.md`。
