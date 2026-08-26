# T30 呈现平面组合化 — Specification

## 类型

Architecture(呈现平面升级;T27 内容面的承载机;spike → 实施)

## 方向依据(北极星)

`conductor/product-vision.md`:

- §三 workstation 不硬编码:界面从使用里长出来,不从部署里发出来;硬编码只到
  "舞台机械"(渲染宿主/auth/chat 框/canvas 壳/action gate/words 词汇渲染器)。
  组合维是"内容面全是合同实体的呈现"的机器前提——没有它,首页只能手写。
- §六 页面滑梯:workstation 首页写成 React 页面 → agent 进不来、recipe 管不了、
  新应用要改码;正解是与渲染一篇文章同一台 presentation 机器。本 Track 评审
  固定项:**无每应用/每实体类型/每区域特判代码**。
- §八.4:呈现平面要长出组合维——单实体 surface 撑不起工作区;区域 × intent ×
  聚合虚主体是 workstation 零硬编码的真正前提。
- §五 方向性加减法:减法减暴露、加法加聚合;几乎不动引擎,动机器的可见性。
  组合是纯呈现聚合,不加新真相。
- §二 入口论:agent 消费合同,不消费像素。虚主体是呈现层名字,不是业务实体:
  不进业务 sitemap、不可 exec、无业务 actions;CLI/外部 agent 的发现面不受
  组合化影响(D41 口径不变)。

## 背景与动机

presentation plane 的现行模型是"一个 subject → 一个 surface":
`UserSidecarKey = {principal, policyScope, subject, intent, deviceClass}`
(`packages/engine/src/presentation/sidecar.ts:5-11`),`RenderSubject =
string | {selection: string[]}`(`packages/shared/src/presentation/presentation.ts:17`),
`SurfaceTree` 单 root(`packages/engine/src/presentation/surface/types.ts:77-80`)。
planner/recipe/sidecar/deref 全部围绕单主体/单集合。workstation 首页是组合:
多个区域(在等我/在动/工作线)、多种 intent、跨实体聚合。模型缺了"工作区
组合"这一维——这不是配置问题,是呈现平面从"渲染实体"到"组装工作区"的物种
升级。没有它,T27 只能手写页面(传统软件陷阱的最大落点)。

## 核心目标(一句话与判定要点)

**把 presentation plane 从"一个 subject 一个 surface"升级为"工作区组合"这台
机器——区域 × intent × 聚合虚主体,且与单主体共用同一台机器,不分叉。**
交付物是机器,不是页面。判定偏离的三要点,缺一即偏:

1. **交付物是机器,不是页面。** 首页页面/壳/导航归 T27;施工中发现自己在写
   首页布局组件,即页面滑梯,当场退回。
2. **同一台机器。** 单主体 surface = 单区域组合的退化形态;出现"组合走这条
   路径、单实体走那条路径"的双轨,即违背红线与 GR2 精神。
3. **组合不产生真相。** 虚主体只是呈现层名字;一旦被做成业务实体(进 sitemap/
   可 exec/产生业务事件),§八.3 的隐性第二真相就复活了。

## 站点归属

呈现平面(packages/engine 纯内核的组合规划 + apps/web 适配)。机器本身站点
中立:workstation 首页(T27)是首个消费方,meta/raw 不消费。CLI 无
presentation 面(全仓 grep:`apps/cli/src` 零 presentation/surface/sidecar
提及),本 Track 零 CLI 改动。

## 依赖

- T16(`conductor/tracks/archive/t16-semantic-a2ui-sidecars_20260823/`):
  presentation plane 母体——thin request、Application Recipe 预生成、用户级
  跨 session sidecar、pin/promote 通道。本 Track 在其模型上加组合维,机制沿用
  不分叉。
- T26(`conductor/tracks/t26-work-thread-projection_20260825/`,本 Track 动工前
  应已闭环):D44 与 threads 投影——`threads` 集合 / `thread:<id>` 实体
  (`packages/engine/src/projection/work-thread.ts`)、principal-scoped sitemap
  条目(`apps/web/src/engine/service-sitemaps.ts:80-86`,`scope: 'principal'`
  现状唯一先例)、principal-owned 授权口径。threads 是 my-work 的聚合源之一;
  **组合机器对 threads 零特判**,换任何合同集合声明照用。
- T29(`conductor/tracks/archive/t29-presence-situation_20260825/`):Situation
  单一装配点(`apps/web/src/engine/situation.ts:31-38`);`Situation.disclosure`
  (`{scope, thread, focus}`)已预留、暂无消费方,是组合披露将来的自然接缝
  (本 Track 不接)。
- T25 / D41(DECISIONS.md;`conductor/tracks/archive/t25-assistant-scoped-context_20260825/`):
  披露收窄只发生在 prompt 层,绝不窄化公开合同;组合化同样不窄化
  `/api/entity`、sitemap、`/api/presentation` 任何既有形状。
- T24(`conductor/tracks/t24-presentation-honesty_20260825/`):机制词汇已退入
  "为什么这样展示"抽屉(`apps/web/src/components/canvas-why-drawer.tsx`);
  组合的机制信息(区域清单/声明版本/provenance)同归抽屉,不上首屏。
- 执行序(tracks.md 方向 program):T24 → T25 → T26 → **本 Track** → T27 → T28。

## 现状事实(代码锚点;实施前以仓库现状复核)

### 请求与收据合同

- `PresentationIntent`/`PresentationRequest`/`PresentationReceipt`
  (`packages/shared/src/presentation/presentation.ts:26-53`);subject 为
  `RenderSubject`(:17);intent 是自由字符串(无 union、仅非空校验,
  :331-364);禁键 surface/component/bind/dependency/sessionId(:101-107);
  `completePresentationRequest` 由运行时补身份(:370-385)——LLM 只发 thin
  intent(packages/agent/src/types.ts:125、`llm/tool-call-mapping.ts:101-137`)。
- HTTP:`POST /api/presentation`(`apps/web/src/app/api/presentation/route.ts:14`;
  production 覆盖 principal :28-44);`GET`/`POST /api/presentation/sidecar`
  (`apps/web/src/app/api/presentation/sidecar/route.ts`:GET :53-87,含
  `explain=1`;POST :89-265,actions pin|revert|patch|promotion-preview|promote,
  `actor='human'` 强制)。
- surfaceUrl 形状:`/canvas?sidecar=<id>&focus=…`
  (`apps/web/src/engine/presentation/runtime.ts:110-115`);fallback 无 sidecar
  时 `/canvas?focus=…`/`?roots=…`(`engine/presentation/broker.ts:82-88`)。
- presentation 端点不进 `/.well-known/ui4a.json`;组合化维持不变。

### Surface 树与双目录

- `SurfaceTree{schemaVersion:1, root:SurfaceNode}`(types.ts:77-80);节点 kind
  = layout(children)/ slot(name+child)/ repeat(entities source + item)/
  word(bindings)/ diagnostic;**每节点携带 dependencies + provenance**
  (types.ts:36-41);binding 按 subject 引用(types.ts:14-20,actions 只按
  subject 引,不按动作名)。
- 单 root 假设的全部位置:types.ts:79、`sidecar.ts:24-34`
  (SidecarVersionInput.surface)、`recipe/recipe.ts:28`(surfaceTemplate)、
  `patch.ts:35-40`(RenderPatchTarget.surface)、所有 walker 从 root 起步。
- 双目录:semantic catalog(`apps/web/src/engine/presentation/catalog.ts:4-41`,
  id `urn:ui4a:presentation:semantic`,version `semantic-v1`,words
  heading|prose|state|controls|references|collection|member-link)与 A2UI
  render catalog(`apps/web/src/render/registry.ts:241-252`,10 词
  table/chart/stat/timeline/flow/form/diff/kanban/markdown/detail,
  CATALOG_ID `https://ui4a.dev/render/v1/catalog.json` :41);两级映射在
  `apps/web/src/render/presentation/catalog-adapter.ts:35-72`。"新区域形态进
  词汇表"的机械含义 = semantic 词 + adapter 映射 +(必要时)A2UI 词组件,
  不进页面组件。
- validate/normalize/hash:`surface/validate.ts`(`validateSurfaceTree` :454-484,
  失败子树换成 diagnostic 节点)、`surface/normalize.ts`(:49-66)。

### Sidecar 与失效

- 事件 domain='presentation'(`apps/web/src/db/presentation.ts:159-166` 追加),
  kinds:`user-sidecar-instantiated|revised|pinned|staled|reverted|evicted` +
  生命周期 `presentation-requested|resolved|failed` + `render-recipe-promoted`;
  投影表 `presentation_user_sidecars`(:15-43,**subject 列是 JSONB**——虚主体
  标识若为字符串则零 DDL 变更);`rebuildPresentationProjection` :207-219 可重建;
  与业务 fold 隔离(业务 fold 只读 domain='core',
  `apps/web/src/engine/service-event-log.ts:83`)——组合化不动 I5 业务 hash。
- `SidecarDependency` kind = entity-contract | collection-membership |
  definition | catalog | policy(sidecar.ts:13-22);`dependencyDecision`
  (sidecar.ts:361-388):fingerprint 漂移 + mode='rehydrate' → 复用;
  'invalidate' → replanned;缺非 optional → replanned。`collection-membership`
  是聚合源失效的现成钩子。
- fastpath 阶梯(`recipe/resolver.ts:114-203`):user-pinned → user-cache →
  promoted-recipe → candidate-recipe → generic → planner;sidecar 候选按 key
  精确相等匹配(:65-81);stale aggregate 被过滤(:87-103),pinned 不 evict
  (sidecar.ts:306-308)。

### Recipe 与 promotion 的单主体硬编码(本 Track 必须一般化的三处)

- `promoteUserSidecarCandidate` 固定 `slots:[{name:'subject',kind:'entity'}]`
  (`packages/engine/src/presentation/promotion.ts:108`)与
  `subjectSlots:['subject']`(:119);
- web `recipeFor` 过滤 `typeof subject==='string'` 且
  `slots.length===1 && slots[0].name==='subject'`
  (`apps/web/src/engine/presentation/runtime.ts:141-156`)——selection 主体
  至今不进 recipe;
- `ApplicationRecipeSlot` kind union 已含 `'collection'`(recipe.ts:13-16)但
  无任何产出方;scenario 枚举器的 `slots` 只是字符串描述
  (`scenario.ts:32-40`,collection-browse 为 `['subject.rel','members']`)。

### 已具备的多数苗子(组合化复用,不新造)

- `RenderSituation.roots` 已是数组(`packages/shared/src/presentation/presentation.ts:92-99`;
  `packages/engine/src/presentation/lens.ts:205-219`)——多根数据解析已存在;
- slot 节点 kind 与 layout 容器已是合法节点——区域可直接表达,node union 可零新增;
- `subtreeKeysOf`(`apps/web/src/engine/presentation/situation.ts:140`)已有多区域
  subtree key 词汇(flow/collection/entity 三族),canvas 尚未消费;
- canvas `?roots=` 多 surface 网格(`apps/web/src/components/canvas-body.tsx:472`)
  是"多个 surface 各自独立规划",不是组合;**组合 = 一棵 SurfaceTree、一个
  sidecar、一张收据**,compiler/canvas 对 layout/slot 树的既有渲染零分叉;
- chat 薄呈现边界:turn detail 只记 `presentationRequestIds`
  (`apps/web/src/chat/history.ts:29-30`),绝不携 Surface/catalog 数据——
  组合化保持薄边界不变。

### GR3 与基线事实

- GR3 门禁按有效行计(去空行/注释,`scripts/governance/check-size.mjs`);
  下列为原始 wc -l,属保守上界,勿按原始行数过度反应。
  `packages/engine/src/presentation` 根目录直接 .ts 合计 1749(有效 1583)
  /4000;`recipe/` 667;`surface/` 1112(有效 1016)。`surface/validate.ts`
  有效 484/500(原始 504)、`recipe/recipe.ts` 原始 464——贴近单文件上限:
  **组合校验/组装一律进新模块(如 `surface/compose.ts` 或
  `presentation/compose.ts`),不回填**。
- `packages/shared/src/presentation` 677/4000(presentation.ts 428)。
- apps/web 侧:`engine/presentation` 928、`render` 1126、`render/presentation`
  927、`render/canvas` 381,均在门禁内无基线;`db/presentation.ts` 220,但所在
  `apps/web/src/db` 目录基线 4014/4000(T29 登记,shrink-only)——web 侧接线
  保持薄,**db 零变更为设计偏好**(subject JSONB 已兼容虚主体字符串)。
- `apps/web/src/components` 基线 4175/4000(T24 登记)、`apps/web/src/auth`
  4074/4000(T26 登记)——本 Track 原则上不触这两个目录;确需超限由编排
  agent 按 workflow.md 业务优先原则登记例外,subagent 不自行裁剪。

### 不变量锚点

- I2 事实不可发明(GOAL.md:118):组合 surface 同样只含引用,deref 对实体
  缓存实时解引用;`e2e/invariants.spec.ts:299-344` 的 I2 段当前 test.skip,
  常驻等效约束是 property test(`apps/web/src/render/property.test.ts`)。
- I5 可重放(GOAL.md:121):presentation 域独立于业务 hash;presentation 投影
  自身可重建由 `apps/web/src/db/presentation.test.ts`(:95)常驻断言。
- I7 失败安全:LLM 不可用时 generic fallback(`planGenericSurface`)诚实工作;
  组合规划同样必须有零 LLM 的 generic 退路,缺失即缺陷。

## Phase 0:Spike(必须先回答,产出 DECISIONS 条目)

每问给出:候选、约束、推荐默认、否决项与理由。spike 产出一律落
`DECISIONS.md`(D45),分歧先于代码(GOAL.md 约束)。

1. **虚主体标识与 wire 表示。** 候选:
   - (a) **保留字 rel 形字符串**(如 `workspace:<id>`):`RenderSubject` 不新增
     variant,subject 仍是 string;sidecar 表 subject JSONB、key fingerprint、
     `parsePresentationRequest` 全部零形状变更;与 `flow:<name>`/`thread:<id>`
     命名家风一致。约束:`/api/entity` 不解析它(404 是正典,虚主体不是业务
     实体);broker authorize 改走声明解析而非 getEntity。
   - (b) **RenderSubject 新 variant** `{compose: <id>}`:结构化最干净,但动共享
     协议类型,parse/fingerprint/chat-view/tool-call-mapping 全链路跟改。
   - (c) 复用 `{selection: string[]}`:**否决**——selection 是临时多 rel 集合,
     无区域/intent/声明治理语义,聚合规则会散进调用方(§八.3 隐性第二真相)。
   约束:虚主体 id 有界(参照 thread id 口径 1–64 字符
   `[a-z0-9][a-z0-9._-]*`,D44);既有禁键清单不变。
2. **区域声明数据的归属与治理位置。** 候选:
   - (a) **内建声明注册表**:代码内 typed/validated/versioned 纯数据(落位按
     GR3 归属,如 `apps/web/src/applications/` 或 engine 常量),形状 meta-ready
     (id + version,内容寻址方向);定义平面治理显式推迟(同 T26 推迟线模板
     治理的先例);
   - (b) Application bundle 贡献区域:bundle 是应用内容正道,但 my-work 跨应用
     (inbox/threads/delegations 均 app-neutral),首页组合不属于任一应用;
     应用级 workspace 的 bundle 贡献留作后续扩展;
   - (c) 直接定义平面 artifact(事件日志治理的 CompositionDefinition):最终态,
     但本 Track 引入定义生命周期成本过重。
   推荐 (a),形状对齐 (c) 以便将来晋升。约束:声明 = 纯数据(id/version/
   regions[{region, source rel, intent, mode}]),引擎按声明组装,零每区域分支;
   声明版本变更经 sidecar dependency(kind 复用 'definition')走既有失效语义。
   否决:区域声明写进 React 页面/组件 props(页面滑梯);聚合规则写进 service
   函数(§八.3)。
3. **Surface 树的区域表达与单主体退化形态。** 候选:
   - (a) **零新节点**:组合根 = 既有 layout 节点,区域 = 命名 slot 子树;区域→
     源/intent 的绑定发生在规划期,树内由 bindings.subject 与每节点既有
     dependencies/provenance 表达;区域由来经 provenance/explain 呈现。node
     union、walker、validate、compiler、patch 零分叉;
   - (b) 新 `region` 节点 kind(显式 subjectSlice/intent 字段):语义最显,但
     node union 与全部 walker/patch/compiler 分叉,违背"同一台机器"。
   推荐 (a)。单主体退化两个子案:(i) **统一包一层区域 slot**(形状单一;既有
   nodeId 如 root/body/actions 位移 → 误导排查清单内测试按 GR2 一次性迁移);
   (ii) 单区域省略 wrapper(形状两态,walker 须容忍)。推荐 (i)。约束:surface
   id 约定 `presentation-<subject>` 对单主体保持不变,组合主体同法 URL 编码;
   compiler component id 约定(`root`/`node:<id>`)稳定或一次性迁移。
4. **Sidecar key、recipe slot 与 promotion 一般化粒度。** 约束(推荐默认):
   key.subject 承载虚主体标识;**key.intent 仍是单字符串 = 组合 intent**(如
   `work-home`),每区域 intent 住声明、不进 key(防 key 爆裂,pin/promote
   语义不变);`ApplicationRecipeKey.subjectShape` 承载组合形状;slots 按区域
   一般化('collection' slot kind 首次产出);`promotion.ts:108/119` 与
   `runtime.ts:141-156` 的单 slot 硬编码同步一般化(按 slot 形状匹配,不再按
   数量==1)。spike 决断点:promotion 参数化粒度(每区域一个 slot vs 每源实体
   一个 slot)与 `$slot:` 命名规则。
5. **授权、依赖失效与 credentialed 降级形状。** 约束(推荐默认):broker 对
   组合主体解析声明后**逐区域源 fresh getEntity 重授权**(user-level sidecar
   纪律:每次命中都重授权、实时解引用,不变);credentialed 客户端按当前
   policy scope 逐源判定,不可覆盖的源区域降级呈现且不泄漏(收据诚实)。
   spike 决断点:降级形状(区域级 diagnostic/缺席 vs 整请求 failed)与收据
   reasonCode 词汇。依赖 = 全部区域源并集(entity-contract / 集合源加
   collection-membership)+ 声明版本(definition)+ catalog + policy;mode
   语义沿用(membership 漂移 → rehydrate,形状变更 → invalidate),"任一源
   失效触发重规划"。披露边界:D41 不变,组合不窄化任何公开合同。

## 最终形态(实施目标)

1. **组合声明模型(数据)**:CompositionDeclaration 类型 + 严格 parse(字段
   白名单、有界)+ 内建注册表;首个声明 `my-work`(在等我=inbox、在动=
   delegations、工作线=threads;区域源全部为 sitemap 可达合同实体)作为本
   Track 验收载体,供 T27 首页直接消费;声明形状 meta-ready,治理晋升是
   后续 track。
2. **区域 × intent 组合规划**:planner 消费声明,每区域源经既有 generic/recipe
   路径按区域 intent 规划子树,组装为根 layout + 命名 slot 的单棵 SurfaceTree;
   binding-only 不变;新区域形态进词汇表;**单主体 surface = 单区域组合的退化
   形态,同一台机器零分叉**。
3. **组合级 sidecar/recipe**:key 承载虚主体标识 + 组合 intent;依赖 = 全部
   区域源并集 + 声明版本,任一源失效按声明 mode 触发 rehydrate/invalidate;
   pin/stale/revert/promote 与单实体同生命周期;promotion 多 slot 参数化。
4. **web/canvas 承载零分叉**:broker 对组合主体逐源 fresh 重授权;credentialed
   逐源降级(诚实、不泄漏);surfaceUrl/surface id 约定沿用;canvas 单树挂载;
   抽屉/explain 呈现区域清单与声明由来。
5. **binding-only 与薄 chat 不变**:组合不产生业务事实、不产生业务事件;chat
   仍只携 presentationRequestId。

## Scope 边界(非目标)

- 不做 workstation 首页页面/壳/导航(T27 消费 my-work 声明落地首页);
- 不做实体动作一等按钮与 chat 引用可点(T28);组合 surface 内动作控件沿用
  action gate 现状;
- 不做声明的 meta 定义治理(CompositionDefinition 入定义平面是后续 track);
- 不做 LLM 呈现生成路径调整(Recipe/Sidecar 机制沿用);
- 不做应用级 workspace 的 bundle 贡献机制(后续扩展);
- 不做多用户/团队工作台;CLI 零改动(agent 消费合同,不消费像素)。

## 施工纪律红线

- 区域/聚合规则声明式数据;**零每区域/每实体类型/每应用代码分支**;新区域
  形态进词汇表,不进页面组件;
- 虚主体不是业务实体:不进业务 sitemap、不可 exec、无业务 actions、不产生
  业务事件;组合 surface 内动作仍指回真实实体;
- 与单主体 surface 同一台机器:planner/recipe/sidecar/deref/compiler 共用,
  不分叉;单主体 = 单区域退化;
- sidecar 每次命中逐源重授权并实时解引用(user-level 纪律不变);credentialed
  降级不泄漏、不静默;
- GR3:组合内核新逻辑落 packages/engine 新模块;web 侧薄接线;db 零变更为
  设计偏好;例外登记由编排 agent 统一执行(业务优先原则)。

## 验收方向

- 组合声明 parse:非法声明/未知字段/超界/非法 id 一律拒绝;
- 组合规划纯内核测试:声明 → surface 形状(根 layout + 命名 slot + 区域子树)、
  binding 完整性(零字面量,I2 口径)、依赖并集覆盖全部聚合源 + 声明版本;
- 单主体退化等价:同一主体经组合路径与现状路径呈现语义等价(形状以 D45 为准
  一次性迁移,不留双路径);
- sidecar 同生命周期:组合主体与单实体主体同 pin/stale/rehydrate/promote;
  依赖失效:任一聚合源漂移 → 按声明 mode rehydrate/invalidate;
- 授权:组合主体命中逐源重授权发生;credentialed 越 scope 源区域降级且收据
  诚实;未授权源零泄漏;
- binding-only 不变量同口径覆盖组合 surface(deref 值与实体快照一致);
- 端到端 proof:my-work 声明经 `POST /api/presentation` → receipt ready →
  canvas 渲染三区域;零 LLM 时 generic 退路诚实工作(I7);
- 不回归:T16 presentation 套件、invariants、chat 套件全绿;presentation 域
  重建与业务 hash 各自一致。

## 验收目标纠偏与防偏离(本 Track 全程适用)

**既有验收测试与本 Track 目标相悖时,干掉验收目标——修正/迁移/删除测试,
绝不反向修改 track 目标去保绿。** 闭式精确清单(toEqual 全集)只许表达合同
承诺(存在性、可导航),不许冻结实现快照;凡因本 Track 正确落地而红的旧断言,
按 GR2 一次性迁移,不留双路径,处置记录进 plan 任务 notes。

**本 Track 最大的偏离风险不是做不出来,而是为保绿把目标改掉**——组合化重塑
surface 树,大量既有断言会红(见下节排查清单)。四层防线按施工顺序:

1. **分歧先于代码(Phase A):** 五问先落 D45,采纳/否决齐全;否决项写明理由
   即防复辟裁判文书(如"复用 selection 当组合"已否决);spec/plan 回改对齐后,
   后续 Phase 以 D45 为准,不以本 spec 的推荐默认为准。
2. **误导性验收前置迁移(Phase E 第一任务):** 排查清单的处置顺序是先迁移
   测试、再落组合形状——顺序反了,reds 会诱导实施者冻结旧形状、留双路径,
   保绿压过方向。
3. **验收断言锁目标,不锁实现:** 验收方向与 plan DoD 全部指向目标本身(区域
   来自 sitemap 可达合同实体、零每区域/每实体类型分支、binding-only I2 口径、
   presentation 域与业务 hash 各自重放一致、credentialed 降级不泄漏、I7
   generic 退路),不钉死任何具体树形状——形状由 D45 定。
4. **流程门禁:** 每 Phase checkpoint 复跑 `pnpm check` +
   `CI=true pnpm e2e invariants`;T16 presentation 套件与 chat 套件为不回归
   底线;编排 agent 亲自复跑测试,不信口头报告;收尾 `pnpm dev:all` 实际启动
   走查(里程碑约束:系统必须处于可运行状态)。

**静默缺口警戒(红灯之外的偏离形态):** 门禁照绿 ≠ 目标达成。例:I2 e2e 段
当前 test.skip(`e2e/invariants.spec.ts:299-344`),只跑 e2e 不跑常驻
property test(`apps/web/src/render/property.test.ts`),binding-only 回归会
无声漏过——验收命令必须跑全量 vitest,不能只跑 e2e。同类形态:排查清单中
"两侧重放自洽永不红"的闭式断言,扩展覆盖前门禁照绿。

## 误导性验收排查(2026-08-26 复核扩充,行号以当时基线为准)

组合化重塑 surface 树时,以下既有断言会红,按 GR2 一次性迁移;不得为保绿
而冻结旧的命名/参数形状:

- `e2e/t24-presentation-honesty.spec.ts:73-97`:`presentation-<subject>`
  surface ID 与 catalog URI 精确字符串(已复核:现状断言
  `presentation-post%3Afirst-post` 与 catalog.json URI 在抽屉内);
- `e2e/eval/t16-golden.spec.ts:24-27` 与
  `apps/web/src/app/api/presentation/route.test.ts:39`:`sidecar=` URL
  参数形状(组合主体沿用同参数则不动;改形状须同步);
- `e2e/eval/t16-real-llm.spec.ts:55-150`(S24):手工 surface fixture 钉死
  nodeIds(root/body/actions)——opt-in 不构成压力,但落地时必须迁移该
  fixture;
- `apps/web/src/components/canvas-first-screen.test.tsx:173`:surface id
  `presentation-post%3A…` 形状断言——单主体 id 约定保持不变则不红,退化形态
  改动组件树时复核;
- `apps/web/src/engine/presentation/runtime.test.ts:51` 与
  `apps/web/src/chat/client-view.test.ts:9/:42`:`sidecar=` URL 参数解析/断言;
- `apps/web/src/render/presentation/compiler.test.ts:238-246`:bundle
  serialize/restore/replay 精确相等——树形状统一包区域层则红,迁移 fixture;
- `apps/web/src/engine/presentation/recipes.test.ts:41`:publishing bundle 13 个
  scenario 精确计数(`toBe(13)`)——若枚举器新增组合 scenario 即红,开放化
  或更新;
- `apps/web/src/render/registry.test.ts`:10 词精确清单——仅当 A2UI 目录加词
  才红;semantic catalog 加词/升版(`semantic-v1` → 新版)使既有 recipe/sidecar
  的 catalog 依赖按既有语义失效重规划(语义正确,非缺陷),相关断言同步;
- `packages/engine/src/presentation/promotion.test.ts` 与 sidecar route 测试中
  单 slot `'subject'` 假设,随第 4 问一般化更新。
