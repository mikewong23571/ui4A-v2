# T28 一等交互与引用 — Specification

## 类型

Feature(交互层;依赖 T27 的站点框架,chat 引用可点部分可独立提前)

> **锚点约定(本 Track 全程):** 全部代码锚点使用"文件路径 + 符号/组件/测试
> 名"的稳定标识,**不写行号**——T27 施工会移动 canvas 宿主、components 目录
> 与 e2e 选择器,行号必然漂移。实施前以仓库现状复核全部锚点。

## 方向依据(北极星)

`conductor/product-vision.md`:

- §二 入口论:**指代可解是协作成立的前提**——"这个""当前""还剩几个"必须对
  双方解析到同一事实;引用可点、可验证。canvas 的根因是"共同注视":引用点击
  落面 = 两人手指同时落在同一行。
- §五 加法:实体动作的一等按钮,可见标注"人/AI 同权"(同一 exec,同一裁决);
  chat 引用可点,引用→事实→画面的因果链可见;呈现按 intent 裁剪,不再全属性
  绑定。减法:机制信息继续退守抽屉(T24 口径)。
- §三:raw 是验钞灯,不是第三个站——它是镜头不是目的地,随处可达的"查看原始
  合同"模式。
- §六 特判滑梯:`if entity.class === 'post'` 的动作组件出现一行即背叛;渲染器
  从合同 actions 通用生成。本 Track 评审固定项:**无每应用/每实体类型特判
  代码**。
- §一.1 AI as assistant:机械轨迹属于审计通道;引用与 raw 呈现零 AI,人话归
  LLM。

## 背景与动机

生产走查(2026-08-25):实体渲染只有数据没有动作——post-status flow 声明的
unpublish/archive 就在实体上,界面却无一可操作控件;"你看到的每样东西,你和
AI 都能按合同操作"这一核心承诺在界面上不存在。chat 回答中的实体名不是链接,
"已请求在画布中展示"与画布真实变化的因果不可见——协作发生了,但不可辨认,
读起来像普通 chatbot。generic surface 把全部属性路径绑成 prose,呈现无 intent
裁剪。方向依据:product-vision.md §一/§二/§五/§六。

## 核心目标(一句话与判定要点)

**让合同的能力可见、协作的证据链可辨认:合同声明的动作在人和 AI 面前是同一组
一等控件,chat 里的实体引用是可点的事实指针,原始合同两步可达,呈现按 intent
裁剪。** 判定偏离的三要点,缺一即偏:

1. **一等 = 同一裁决,不是新通道。** 动作控件继续走 declaration → guard →
   schema → exec 与确认门现状;若出现绕过 action gate/确认门的"便捷"提交
   路径,或专为某实体类型写的动作组件,即背叛(特判滑梯)。
2. **引用 = 结构化事实,不是文本解析。** 引用渲染只消费合同/协议里的结构化
   引用(citations/FactRef/links);若出现对 assistant 文本做正则提取实体名
   的代码,即违反"零自然语言启发式",退回。
3. **raw = 镜头,不是站点。** 原始合同视图零组装、零 AI、随处可达;若长成
   第三个导航站或承载业务操作,即越界。

## 站点归属

workstation 站为主(raw 模式全域可达);meta 站的动作控件沿用其治理视图既有
口径,不在本 Track 重做。CLI 零改动(agent 消费合同,不消费像素)。

## 依赖(全部为稳定符号锚点;实施前以仓库现状复核)

### T27 站点框架(已闭环——D46 + mothership revision 47 现场验收)

- 入口 chrome 已落在 T27 的壳与共享宿主上:共享实现为
  `components/canvas/presentation-surface-host.tsx`;`canvas-body.tsx` 是 URL
  adapter 并创建 scope-aware 页面实体缓存。raw 抽屉与动作控件从该宿主接入。
- SiteNav 已重组且 raw 无顶级入口;presence site 值域为
  `{workstation, meta}`(raw 是模式);i3 页面表与首页 ready 已迁移。
- `apps/web/src/components` 目录基线已移除;新增实现按现有 `canvas/`、`stage/`
  与 sidecar helper 邻近落位。e2e 目录 4507 基线由本 Track 按登记计划收缩。

### T24 呈现诚实化(已闭环)

- "为什么这样展示"抽屉:`apps/web/src/components/canvas-why-drawer.tsx` 的
  `CanvasWhyDrawer`(自持 open 状态的 `<aside>`,aria-label"为什么这样展示";
  含 surface/catalog/sidecar 元数据、pin/patch/promote 操作、explain provenance
  与"原始合同"区——`data-testid="canvas-why-raw-json"` 的 focus 实体原始
  Siren JSON)。raw 模式的抽屉形态以其为先例。
- chat 活动条目链接化:`apps/web/src/components/assistant-ui/thread.tsx` 的
  `ChatThread`——activity 条目渲染为整条可点审计链接(`stepAuditHref` →
  `/api/events?afterSeq=…`,`data-nav="audit:<eventSeq>"`);e2e 覆盖在
  `e2e/t24-presentation-honesty.spec.ts` 的「chat 思考区与活动语言:折叠思考
  可展开,活动条目是事件流下钻链接(合成 SSE 走查)」。引用可点的链接形态
  沿用同一模式。
- 口径继承:机制信息只在抽屉;诊断/机制词不上首屏。

### T30 呈现组合化(已闭环,归档)

- 组合区域 intent 的消费链:`apps/web/src/engine/presentation/runtime-composition.ts`
  的 `planRegion`——区域 intent 经 `selectAndInstantiateRecipe`
  (`recipe-selection.ts`,按 subjectShape + intent + catalogVersion + slot
  形状匹配)命中 recipe;**未命中回退 `planGenericSurface` 时 intent 丢失**
  (generic 路径无 intent 参数)——本 Track 形态 4 的接缝。
- 区域降级:`planRegion` 对不可授权区域产出 `diagnosticSurface()`
  (code `region-unavailable`);D45 要求该 slot 保留、不静默缺席——与形态 4
  "诊断节点只在抽屉暴露"的张力是 Phase A 第 5 问。
- GR3:`packages/engine/src/presentation` 4603/4000 在基线(T30 登记,
  shrink-only)——形态 4 的内核改动优先瘦身既有模块,超限由编排 agent 登记
  例外(业务优先原则)。

### T16 Presentation Plane(已闭环;D27)

binding-only、sidecar 重授权、action gate 现状语义全部沿用;本 Track 不动
Recipe/Sidecar 机制。

## 现状事实(稳定锚点;2026-08-26 勘察,实施前复核)

### 动作控件:雏形已在,一等未满

- 实体页:`apps/web/src/components/entity-view.tsx` 的 `EntityView` 对每个
  `entity.actions` 渲染 `apps/web/src/components/action-runner.tsx` 的
  `ActionRunner` 三形态(有字段 → RJSF 可开合表单;无字段 → 推送按钮;无字段
  且高风险 → 两段式确认);提交经 `apps/web/src/components/exec-client.ts` 的
  `execAction`(POST `/api/exec`);guard 阻断经 `blockedForRenderer` 投影为
  disabled + title 原因(仅当全部失败谓词为 `actor-is-human` 时解除禁用)。
- canvas surface 内:semantic catalog `controls` 词
  (`apps/web/src/engine/presentation/catalog.ts` 的
  `PRESENTATION_SURFACE_CATALOG`)→ adapter 映射 `detail` 组件
  `{mode:'actions'}`(`apps/web/src/render/presentation/catalog-adapter.ts`)→
  `apps/web/src/render/words/detail.tsx` 的 `DetailWord` 渲染 `ActionRunner`
  (live 模式经 `apps/web/src/render/presentation/action-adapter.ts` 先复核再
  exec);generic planner 对 actions 产出独立 region
  (`packages/engine/src/presentation/surface/generic.ts`)。
- **已识别的缺口**(本 Track 形态 1 的真实内容):
  - 双提交路径并存:词条内 `ActionRunner` 直调 exec(live 复核),A2UI SDK 层
    `dispatchAction` 事件由 `apps/web/src/render/canvas/action-gate.ts` 的
    `createActionGate` 白名单拦截——两条路径语义待统一(Phase A 第 1 问);
  - guard 阻断原因只在 title tooltip(="藏"),无可见呈现;
  - 无任何"人/AI 同权"标注;actor 可见性仅存在于确认实体属性表的
    `proposed-by`/`policy-reason`。
- e2e 既有断言(按 role 找按钮,全部实体页路径):`e2e/human.spec.ts` 的
  B1「委托发布(人类)」/B2「点名下线(人类)」/B3「审核队列(人类)」;
  `e2e/s1.spec.ts` 的「UI 走查:首页收件箱 → 确认页 RJSF 批准 → 文章列表该篇
  archived」。

### chat 引用:数据已落库,UI 零消费

- `ChatMessageAppendedDetail.citations?: FactRef[]`
  (`apps/web/src/chat/history.ts`;`FactRef{rel, pointer}` 在
  `packages/agent/src/types.ts`);answer 的 `sources` 经 chat 路由写入
  `chat-message-appended`,`apps/web/src/chat/conversation.ts` 投影保留——
  **端到端已落库,但 UI 无任何消费方渲染 citations**。
- decision envelope:`answer{content, sources: FactRef[]}` 等操作联合在
  `packages/agent/src/types.ts`;工具 schema 在 `packages/agent/src/protocol/
  tools.ts` 的 `buildToolProjection`(answer 参数 required 含 sources)——
  **本 Track 形态 2 不改协议,纯 UI 消费**。
- 消息正文:`apps/web/src/components/assistant-ui/markdown-text.tsx` 的
  `MarkdownText`(react-markdown + GFM)有普通外链样式,无实体 rel 拦截;
  trail 文本投影在 `apps/web/src/chat/trail.ts`。
- 画布回执链接先例:`apps/web/src/components/chat/chat-panel.tsx` 的 render
  回执 Link(`data-nav="render:<concern>"`)与 focus 回执 Link
  (`data-nav="focus:<rel>"`),数据源 `use-chat-session.ts` 的
  `lastRender`/`lastFocus`(SSE `render`/`focus` 帧)。

### raw 合同视图:只有一处,且非随处可达

- 唯一入口:`CanvasWhyDrawer` 的"原始合同"区(focus 实体 Siren JSON)。
- 实体页 `EntityView` 只有属性表/动作/链接/成员,**无 JSON 视图**;全前端无
  "查看原始合同"入口。`components/ui/` 无 Sheet/Drawer 原语(抽屉是手写
  aside)。

### 呈现按 intent 裁剪:角色可消费,裁剪未发生

- 字段角色链已机械可消费:定义层 `FieldDefinition.presentation.role`
  (`packages/shared/src/definition/definition.ts`,封闭枚举 identity/status/
  primary-content/metadata/relation)→ 投影层 `properties.presentation.fields
  [].role`(`packages/engine/src/contract/siren/build.ts` 的
  `fieldPresentationsOf`,缺省按字段名机械推断)→ `apps/web/src/engine/
  presentation/situation.ts` 的 `semanticHintsOf` → `planGenericSurface` 的
  `semanticHints`。
- **裁剪未发生**:`planGenericSurface`
  (`packages/engine/src/presentation/surface/generic.ts`)无 intent 参数;
  `scalarPropertyPaths(entity.properties.fields)` 全量绑为 primary-content,
  其余标量全量绑为 metadata,两者都落到 `prose` 词——即"全属性绑成 prose"
  的现状。region 位次已有 `GENERIC_ROLE_ORDER`。
- 诊断节点现状:`apps/web/src/render/presentation/compiler.ts` 的
  `emitDiagnostic` 把 diagnostic 编译为 surface 内 Text caption 组件
  (deref-failed/catalog-word-unavailable/region-unavailable 等)——形态 4
  要求只在抽屉暴露,与 D45"降级不静默"的衔接见 Phase A 第 5 问。

### GR3 与测试基线事实

- 基线(shrink-only):`packages/engine/src/presentation` 4603/4000、
  `apps/web/src/components` 4491/4000(T27 重组窗口)、`e2e` 4126/4000、
  `apps/web/src/auth` 4074/4000、`apps/web/src/db` 4014/4000、`scripts/t22`
  与四个文件条目(helm/compose 契约测试、chat route、floating-chat 测试;
  基线 notes 分归 T22/T26/T24 在途)。
- 有余量的目录:`apps/web/src/render` 1975、`render/words` 1319、
  `apps/web/src/chat` 2553、`apps/web/src/components/chat` 2468(均 <4000)。
- I2 e2e 段当前 `test.skip`(`e2e/invariants.spec.ts` 的 I2 describe)——
  常驻等效约束是 property test:`apps/web/src/render/property.test.ts`
  (fast-check:随机实体 × 随机 spec 的 provenance 溯源 + 字面载荷注入必拒)。
  **验收命令必须跑全量 vitest,不能只跑 e2e**(静默缺口警戒)。

## Phase A 决策点(spike,产出 DECISIONS 条目;编号顺延,T27 spike 占 D46)

每问给出:候选、约束、推荐默认、否决项与理由。分歧先于代码(GOAL.md 约束)。

1. **动作一等控件的统一形态与提交路径。** 现状:实体页 ActionRunner 直调
   exec,canvas 词条 ActionRunner live 复核,SDK 事件另走 createActionGate
   白名单——三条路径。候选:(a) 呈现层统一(同一 ActionRunner 升级为一等
   控件,实体页/canvas/组合区域同源),提交路径按宿主分层但语义一致(同一
   /api/exec、同一 declaration → guard → schema、同一确认门);(b) 全量收编
   进 gate。约束:不改裁决/确认门语义(非目标);零每实体类型特判。
   "人/AI 同权"标注的形态(控件旁注 vs 统一图例)一并裁决——文案面向任务
   语言(product-guidelines)。guard 阻断原因从 title tooltip 升级为可见
   呈现:内容来自合同 `guard-results` 结构,零硬编码文案。
2. **chat 引用的呈现与点击行为。** citations(FactRef{rel,pointer})已端到端
   落库。候选:(a) 消息尾部引用列表(chips);(b) 正文内联实体链接(需
   markdown 渲染层的 rel 拦截);(c) 尾部列表 + 内联两者。点击 = 画布聚焦
   (沿用 `/canvas?focus=<rel>` 既有链路;T27 共享宿主落地后复核 href 形态)。
   "引用→事实→画面"因果链的最小形态(引用高亮 ↔ 画布定位联动)一并裁决。
   红线:只消费结构化 citations,绝不解析 assistant 自然语言文本。
3. **raw 模式形态与入口。** 候选:(a) 随处抽屉(why 抽屉的"原始合同"区推广
   到实体页/chat 引用);(b) 全局视图切换(URL 参数或模式 toggle,整页裸
   合同);(c) 独立路由。北极星:镜头不是目的地;任何实体两步内可见原始
   合同 JSON;零组装、零 AI。纳入范围一并裁决:未组装 Siren JSON 为必备,
   事件切片(/api/events 定位链接)与 provenance(explain)为候选。入口
   控件遵守 i3 fuzz 注记规则(参照既有 `[data-nav="local:canvas-why"]`
   模式)。
4. **intent 裁剪的规则与接线。** intent 如何进入 generic 回退路径(现状:
   `planRegion` 回退 `planGenericSurface` 时 intent 丢失;`planGenericSurface`
   无 intent 参数);裁剪规则形状:按投影已有的字段 role
   (identity/status/primary-content/metadata/relation)+ intent 机械选择字段
   子集——候选:(a) role 优先级限量(GENERIC_ROLE_ORDER 已有位次);(b)
   intent → role 集合映射表(声明式数据,非代码分支)。红线:零每实体类型
   分支;binding-only 不变(裁剪只减绑定,不引入字面量);I2 property test
   口径不回归。
5. **诊断节点的呈现位置。** 现状:diagnostic 编译为 surface 内 Text caption;
   目标:诊断细节(deref-failed 等)只在抽屉暴露。与 D45 的张力:区域降级
   (region-unavailable)不得静默缺席——候选:(a) surface 内保留最小在位
   指示(非机制词,如"此区域暂不可用"),细节归抽屉;(b) 全部进抽屉,
   区域槽位留空态占位。裁决须同时满足"诊断不上首屏"与"降级不静默、不
   泄漏"(D45 第 5 问口径)。

## 最终形态(实施目标)

1. **动作一等按钮。** 实体合同声明的 actions 由通用 action 渲染器生成一等
   控件(实体页/canvas/组合区域同一渲染器;action gate 裁决、确认门、表单/
   schema 现状语义不变),可见标注"人/AI 同权"——同一 exec、同一裁决,一眼
   可读。guard 阻断的动作用合同 guard-results 可见呈现原因,不藏进 tooltip。
2. **chat 引用可点。** assistant 消息的结构化引用(citations)渲染为可点
   入口,点击 = 画布聚焦同一实体;引用 → 事实 → 画面的因果链可见(最小
   联动形态按第 2 问)。渲染只消费结构化 FactRef,零文本解析。
3. **raw 模式。** "查看原始合同"从实体页/canvas/引用随处可达:未组装的
   Siren JSON(必备)+ 事件切片/provenance(按第 3 问);零组装、零 AI;
   镜头不是站点,无顶级导航入口(T27 已坐实)。
4. **呈现按 intent 裁剪。** generic surface 规划按呈现 intent 选择字段(role
   驱动的声明式规则),不再全属性绑定;诊断细节只在抽屉暴露,降级在位指示
   按第 5 问。

## Scope 边界(非目标)

- 不重做 meta 治理视图的动作控件;
- 不改 action gate/裁决/确认门/exec 语义;
- 不做新的 render words(词汇表扩充是独立候选);
- 不做 presentation 的 LLM 生成路径调整(Recipe/Sidecar 机制不动);
- 不改 chat 协议/envelope(citations 已在协议与日志中,本 Track 纯 UI 消费);
- 不动站点结构/presence 值域(T27 领土);
- CLI 零改动。

## 施工纪律红线

- 动作/引用渲染器零每实体类型特判:全部从合同 actions/guard-results 与结构化
  citations 通用生成;
- 引用解析只消费结构化 FactRef,不解析自然语言;
- raw 模式展示原始合同数据,零组装、零 AI(审计通道铁律);
- intent 裁剪规则是声明式数据/纯函数,零 `if entity.class === …` 分支;
- 新控件全部 data-action/data-nav 注记(i3 fuzz 常驻约束);
- GR3:业务优先不为凑行数拆分;例外登记由编排 agent 统一执行,subagent 只
  如实报告。

## 验收方向

- 动作渲染:每个声明 action 有一等控件,提交过同一裁决(复用 I3 fuzz);
  guard 阻断原因可见;同权标注走查可读;
- 引用 e2e:chat 回答引用可点,点击后画布聚焦同一实体;引用渲染只来自
  结构化 citations(无文本解析代码扫描);
- raw 模式:任何实体两步内可见原始合同 JSON;raw 视图零 AI(无 LLM 调用);
- 呈现裁剪:generic surface 绑定字段数显著下降且无信息回归(走查+快照);
  诊断细节只在抽屉;降级区域不静默缺席;
- binding-only 不回归:property test 全量通过(I2 口径);
- 不回归:`pnpm check`、`CI=true pnpm e2e invariants` 全绿;T16 presentation
  套件、T24 honesty 套件、chat 套件全绿;
- 里程碑约束:`pnpm dev:all` 实际启动走查,系统可运行。

## 验收目标纠偏与误导性验收排查(2026-08-26,锚点为测试名/符号名)

**既有验收测试与本 Track 目标相悖时,干掉验收目标——修正/迁移/删除测试,
绝不反向修改 track 目标去保绿。** 闭式精确清单只许表达合同承诺(存在性、
可导航),不许冻结实现快照;凡因本 Track 正确落地而红的旧断言,按 GR2
一次性迁移,不留双路径,处置记录进 plan 任务 notes。

排查结论:本 Track 与既有验收基本同向,无反向施压项——动作作为一等按钮
已被 `e2e/human.spec.ts` 的 B1/B2/B3 人类走查与 `e2e/s1.spec.ts` 的「UI
走查:首页收件箱 → 确认页 RJSF 批准」断言(按 role 找按钮),chat 活动条目
链接化已被 `e2e/t24-presentation-honesty.spec.ts` 的「chat 思考区与活动语言:
折叠思考可展开,活动条目是事件流下钻链接」断言。留意项:

- raw 抽屉/入口新控件须遵守 i3 fuzz 注记规则(data-action/data-nav,参照
  既有 `[data-nav="local:canvas-why"]` 模式),否则 i3 红——常驻约束,不是
  误导;
- 呈现按 intent 裁剪落地后,断言"全属性绑定"的旧快照/闭式断言若有残留一律
  删除或开放化(GR2),不得保留双口径——重点扫描 generic planner 与 compiler
  的单测 fixture;
- guard 原因可见化改动 ActionRunner 呈现,`entity-view.test.tsx` 的
  guard-results 注入/disabled 用例需同步扩展而非冻结旧呈现;
- 诊断节点位置变化会红 `canvas-why-drawer.test.tsx` 与 compiler 诊断用例——
  按第 5 问裁决一次性迁移;
- **静默缺口警戒:** I2 e2e 段当前 test.skip,binding-only 回归只靠
  `apps/web/src/render/property.test.ts`——验收必须跑全量 vitest,不能只跑
  e2e;裁剪若引入字面量绑定,e2e 门禁照绿而 I2 已破。
