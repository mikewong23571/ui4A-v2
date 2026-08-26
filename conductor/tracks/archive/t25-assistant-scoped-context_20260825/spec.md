# T25 Assistant 上下文收窄 — Specification

## 类型

Feature(agent/chat 上下文工程;零合同语义变更——HTTP 合同、事件语义、裁决语义不动)

## 方向依据(北极星)

`conductor/product-vision.md`:

- §一.3 scoped context is the most important:不把全量 sitemap/定义全文一次性
  灌进 prompt;按当前 scope → 当前实体 → 可用动作分层披露;反例即本 Track 的
  直接动因(2026-08-25 生产日志,五步 agent 回合 prompt 近 300KB)。
- §一.2 native context aware:上下文必须来自客户端事实(clientView/位置/scope
  声明),不来自启发式;起点词级交集探测是 §五减法清单中点名的下一个启发式。
- §八.2:处境只有一个装配点,agent prompt 构造消费 T29 装配输出,禁止各自重算。
- §八 CLI 纪律三:披露收窄发生在 prompt 层,不窄化 HTTP 合同——sitemap/entity
  端点是外部 agent 的发现面,内嵌助手"少看"是效率选择,外部 agent"能看"是
  合同承诺。

## 背景与动机

生产实测(2026-08-25):单个五步 agent 回合的 decide prompt 近 300KB——整个
meta sitemap、每条 flow 定义的版本摘要(内嵌定义全文)一次性灌入,LLM 要在
里面捞一个 `next` 动作。起点解析则用动词与 surface 标题做词级交集逐个探测
(又一处启发式猜测,与已清除的平面正则同族)。有限上下文内,收窄决定质量;
这正是"scoped context is the most important"在 agent 侧的欠账。

## 站点归属

跨站上下文层(其披露以"用户当前所在站点/scope"为边界;站点形态本身归 T27)。

## 依赖

- T29(已完成,归档于 `conductor/tracks/archive/t29-presence-situation_20260825/`):
  处境装配唯一模块 `apps/web/src/engine/situation.ts`(`assembleSituation`,
  输出 `Situation{principal, site, scope, thread, focus, disclosure}`);
  chat 侧入口 `apps/web/src/engine/chat-situation.ts`(`situationForChat`);
  presence 投影 `apps/web/src/db/presence.ts`;clientView 协议 v2
  `packages/shared/src/presentation/chat-view.ts`。
- T24(已完成):chat 失败分层与结构化 reason 形状是本 Track"失败语义不变"
  的对接点(`apps/web/src/chat/failure-reason.ts`、`apps/web/src/chat/sse.ts`)。

## 现状事实(代码锚点,核对基线 HEAD 4e3e2ef;实施前以仓库现状复核)

- decide prompt 唯一组装点:`packages/agent/src/llm/prompts.ts`
  (`buildUserPrompt` / `buildLlmMessages`);发送点
  `packages/agent/src/llm/llm-driver.ts`(streamText,含 tools 投影)。
  sitemap 块整段 JSON 注入,无字节上限;capabilities 携带 inputSchema/
  outputSchema 全文。已有收窄仅有:loop 内按 app 推断的 scopedSitemap 过滤
  (`packages/agent/src/loop/loop.ts` inferEntityApplication 段)与计数界
  (observations ≤8、messages ≤12、audit ≤8),全链路无字节预算。
- 起点探测:`apps/web/src/chat/start.ts` `resolveStartRel`(sitemap 词级交集
  + 逐个 GET /api/entity 探测,兜底 articles);词法原语在
  `packages/agent/src/protocol/match.ts`(overlaps/VERB_LEXICON,仍被
  `protocol/plan.ts` 与 testkit rule-driver 消费,本 Track 不删 match.ts)。
  调用方仅 `apps/web/src/app/api/chat/route.ts` 两处(inline 与 delegated
  派发前)。同文件 `isDiscoveryOnlyIntent` 已无生产消费方(仅测试引用)。
- clientView 协议 v2 无 `subject`/`route` 字段;"用户正注视的实体"对应
  `clientView.presence.focus`(`RenderSubject = string | {selection: string[]}`,
  `packages/shared/src/presentation/presentation.ts`)。
- scope 默认入口的数据载体已存在:`ApplicationDefinition.entry?: string`
  (`packages/shared/src/definition/definition.ts`,T10 落字段,暂无消费方,
  本 Track 是首个);应用定义从服务组合层快照 `EngineSnapshot.applications`
  读取(sitemap 推导已消费同一快照,`apps/web/src/engine/service-sitemaps.ts`)。
- delegated(Temporal)路径:`apps/worker/src/delegation.ts` 构造的
  DriverContext 无 clientView、无 app 过滤(全量 sitemap 直入);派发面
  `apps/web/src/temporal/delegation.ts` `DelegationDispatchArgs.startRel`
  已存在,尚无 scope 参数。
- 反向治理门禁:`packages/agent/src/governance/t21-source-governance.test.ts`
  断言 resolveStartRel 不得消费 clientView(D33 条款的机械形式);本 Track
  修订 D33 后同步改写。
- D33(`DECISIONS.md`)条款"合同 discovery 的 resolveStartRel 不被 client
  view 机械改写"与本 Track 最终形态 2 存在直接张力;按 GOAL.md 约束(实现与
  文档冲突时先在 DECISIONS.md 记录),落档新决定是施工第一步。

## 最终形态

1. **分层披露。** agent 首轮上下文只含:当前 scope 的 sitemap 切片、当前
   实体(合同全形)、可用动作。site/scope/focus 由 T29 处境装配唯一供给
   (本 Track 不另建 scope 推导);sitemap 切片内容以装配输出为输入机械计算。
   其他 scope 仅披露"可导航入口"(rel + title,不含实体全形、不含 capability
   schema 全文);capability 等大体积定义按 rel 引用,需要时导航读取。跨 scope
   内容靠 agent 显式导航获取(navigate 工具可达其他 scope 入口),每次导航
   留痕(事件日志现状即支持:inline 写 `chat-navigation-completed`,
   delegated 写 `delegation-step`)。
2. **起点即事实。** 删除 `resolveStartRel` 的 sitemap 词级交集探测。起点链:
   `clientView.presence.focus`(用户正注视的实体,string 形 RenderSubject 即
   rel)→ scope 默认入口(`ApplicationDefinition.entry`)→ 站点兜底
   (business: `articles`;meta: `meta/flows`,现状约定)——每一级都是事实或
   约定入口,不是猜测;链上不做可达性预探测(探测请求数=0),起点实体不可
   得时走既有 `start_entity_unavailable` 诚实失败路径。delegated(Temporal)
   场景天然无 clientView:直接从 scope 默认入口起,不允许退化为词级探测;
   委托派发方有明确起点时经显式参数传入(显式正典,同 T29 纪律)。
3. **prompt 预算。** 单次 decide 请求设硬上限(目标 ≤32KB,wire 级口径,含
   tools 投影);超限即披露层 bug,测试断言拦截。
4. **失败语义不变。** 上下文收窄后"合同未暴露能力"的诚实失败路径保留;拒绝
   仍即数据;失败 code 集合(`no_progress_loop / driver_fail /
   start_entity_unavailable / loop_exception`)不变。

## Scope 边界(非目标)

- 不做 LLM 意图分类器(已否决的方向:平面归属跟位置走,本轮同理);
- 不改 runAgent 循环协议与工具集形状(仅改披露内容与起点供给);
- 不删 `packages/agent/src/protocol/match.ts`(plan 匹配与 testkit 仍消费);
- 不做 chat 对话面的措辞/轨迹呈现(T24 已完成);
- 不做工作线概念(归 T26;本 Track 的 scope 边界将来由工作线承接);
- 不窄化 HTTP 合同:`/.well-known/ui4a.json`、`/api/entity` 对外行为不变
  (CLI/外部 agent 发现面不受披露收窄影响)。

## 施工纪律红线

- 披露规则零自然语言启发式(起点、scope 边界全部来自结构化事实);
- 分层逻辑按 scope/rel 归属机械计算,无每应用特判(北极星 §六评审项);
- inline(chat 路由)与 delegated(worker)两路径共用同一披露切片实现,
  不得两处各算;
- `apps/web/src/app/api/chat/route.ts` 处于 GR3 shrink-only 基线
  (`scripts/governance/size-baseline.json`):新逻辑落新模块,不推高基线;
  确需超限按 workflow.md 业务优先原则由编排 agent 登记例外。

## 验收方向

- prompt 大小测试:典型回合(读文章/走向导/定义治理)单次 decide 请求
  ≤ 预算(wire 级断言);
- 回归测试:"新增一篇文章…介绍操作流程"端到端完成且无 meta 越界(北极星
  §一.2 反例用例);
- 起点解析测试:presence focus 优先;词级交集调用被移除(探测请求数=0);
- 双路径一致性:inline 与 delegated 消费同一切片函数(测试切面);
- 既有 chat 套件、Story Eval(T15 门槛)与 invariants 全绿。
