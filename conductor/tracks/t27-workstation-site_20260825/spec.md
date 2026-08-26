# T27 Workstation 站点 — Specification

## 类型

Feature(站点结构与首页;T24/T26/T29/T30 产出的首个消费场景)

## 方向依据(北极星)

`conductor/product-vision.md`:

- §二 入口论:人和 AI 从同一份投影进入,而不是各进一扇门;指代可解是协作成立
  的前提。**agent 不需要站点**——agent 消费合同,不消费像素;站点全是为人建的。
- §三 工作形态:三种形态两个半站——workstation(家,默认落点,AI 助手前置,
  scope 是工作线,信任投影)/ meta(工具间,进入定义层必须显式意图;`/_meta`
  后端已独立,前端坐实同样的物理隔离)/ raw(验钞灯,不是第三个站,降格为随处
  可达的"查看原始合同"模式,抽屉归 T28)。两座显式的桥:workstation →(在
  meta 中编辑此定义)→ meta;任意处 →(查看原始合同)→ raw(T28)。跨站链接
  保留 scope。
- §三 workstation 不硬编码:界面从使用里长出来,不从部署里发出来。硬编码只到
  "舞台机械"(渲染宿主/auth/chat 框/canvas 壳/action gate/words 词汇渲染器);
  内容面全是合同实体的呈现——"在等我"=`inbox`,"在动"=`delegations`,工作线
  =投影。
- §五 加减法:顶层导航零件表(收件箱/事件流/委托监控)折叠为上下文到达;加法
  ="我的事"首页(什么在等我、什么在动、上次停在哪)与 scope 的显式声明与常显
  ("你在哪、在看什么"永远在场)。
- §六 页面滑梯:workstation 首页写成 React 页面 → agent 进不来、recipe 管不了、
  新应用要改码;正解是与渲染一篇文章同一台 presentation 机器。本 Track 评审
  固定项:**无每应用/每实体类型/每区块特判代码**。
- §八.2:处境只有一个装配点。前端常显是 T29 装配输出的消费方,不得自行重算。

## 背景与动机

当前前端没有"门":用户无法进入某个工作范围,打开应用回答不了三个问题——
我上次干到哪了?什么在等我?什么在动?导航栏是机器零件表(首页/收件箱/事件流/
画布/委托监控/定义管理,`apps/web/src/components/site-nav.tsx:8-15`),首页是
六区块硬编码 React 页面(`apps/web/src/components/home-body.tsx`,306 行),
应用最强的"活性"(一切皆进行中的投影)完全不可感。更糟的是方向反压:
`home-body.tsx:19-20` 注释承认首页锚点为 human/s1 e2e 故意保留——e2e 正在
约束首页设计。T24/T26/T29/T30 已把事实层与组合机器备齐(见"依赖"),本 Track
用它们把站点与首页真正落地。

## 核心目标(一句话与判定要点)

**把"门"和"家"立起来——三种工作形态的路由分割坐实,首页从机器零件表变成
"我的事"(在等我/在动/工作线),且内容面全部经 T30 组合机器呈现,零硬编码
页面。** 本 Track 是"减法+坐实",不加任何新的业务/呈现能力。判定偏离的三
要点,缺一即偏:

1. **交付物是门与家,不是新能力。** 施工中发现自己在写新投影、新事件种类、
   新呈现机制,即越界——那些是 T26/T29/T30 的产出,本 Track 只消费。
2. **内容面零硬编码。** 首页区块 = my-work 声明区域经同一台 presentation
   机器;出现"为首页写区块组件"(页面滑梯)或任何 `if region === …` /
   `if entity.class === …` 特判,即背叛,当场退回。合法硬编码只有舞台机械
   (壳/导航框/chat 面板/常显条)。
3. **处境同源留痕。** 常显与声明只走 T29 既有 presence/situation/clientView
   链路;前端自行重算处境、新造事件种类、用启发式猜 scope/thread,即违反
   装配单点(§八.2)。

## 站点归属

本 Track 即站点分割本身:workstation 站落地,meta 站维持现状仅做桥链接收口,
raw 降格为模式(抽屉实现归 T28;现状导航本无 raw 顶级入口,本 Track 坐实
"raw 不是站点"并保证裸视图过渡可达)。

## 依赖(锚点 2026-08-26 复核;实施前以仓库现状再复核)

### T30 呈现组合化(内容面唯一承载机;已闭环,归档于 `conductor/tracks/archive/t30-presentation-composition_20260825/`)

- 声明模型:`CompositionDeclaration{id, version, regions[{region, source, intent,
  mode}]}` 与严格 parser 在 `packages/shared/src/presentation/composition.ts`
  (字段白名单、region 唯一、`COMPOSITION_MODES=['rehydrate','invalidate']`)。
- **my-work 声明**:`apps/web/src/engine/presentation/compositions.ts:24-49`,
  version `'1'`,三区域全部 `mode:'rehydrate'`、源全部为 sitemap 可达合同实体:
  - `waiting-for-me` ← `inbox`(intent "Review work waiting for me");
  - `in-motion` ← `delegations`(intent "Track work currently in motion");
  - `work-lines` ← `threads`(intent "Follow active work lines")。
- 组合规划内核:`packages/engine/src/presentation/compose.ts`
  (`assembleSurfaceRegions`/`composeSurfaceRegions`;根 layout + 每区域命名
  slot + 区域子树);单主体已统一为 `layout → slot(subject) → subtree` 退化
  形态(`packages/engine/src/presentation/surface/generic.ts:105-108`),同一台
  机器零分叉。
- web 运行时:broker 识别 `workspace:<id>` 并逐区域 fresh `getEntity` 重授权
  (`apps/web/src/engine/presentation/broker.ts:90-121`);不可授权区域保留
  `diagnostic(code='region-unavailable')` slot(`runtime-composition.ts:18-30`),
  部分授权收据 `ready` + `partial-authorization`(`runtime.ts:288-290/:315`)。
- canvas 承载:组合与单实体共用 sidecar 单树挂载路径
  (`apps/web/src/components/canvas-body.tsx`;`?focus=workspace:my-work` 即作为
  单 focus 走 `POST /api/presentation` → sidecar → hydrate);组合区域清单进
  why 抽屉(`canvas-why-drawer.tsx:151-164`)。
- D45(DECISIONS.md)全部口径是本 Track 的继承约束:虚主体不是业务实体(不进
  sitemap、不可 exec、无业务事件);区域/intent 只在声明;逐源授权不泄漏。
- my-work 聚合规则(principal 过滤口径、区域构成)由 T30 声明承载,本 Track
  不改;演进走声明版本升级(同 id 内容变化必须换 version)。

### T26 工作线投影("我的工作线"数据源;已闭环)

- `threads` 集合与 `thread:<id>` 实体:`packages/engine/src/projection/work-thread.ts`
  `projectWorkThreads`(:204-217,class `['collection','threads']`,成员带
  `rel:['item']` + href)与 `projectWorkThread`(:180-202,class
  `['work-thread', status]`;properties 五类 = id/owner/goal/status + context/
  active(带 statusPointer)/approval/recent-events;links 含 context/active/
  approval 引用与 event 审计链接 `/api/events?afterSeq=…`)。
- 动作:`threads#create`(fields id/goal/goalSource)与 `thread:<id>` 的
  attach/detach/pause/resume/complete/archive(`work-thread.ts:22-110`);
  owner = 服务端可信 principal;archived 无动作;裁决走通用
  declaration → guard → schema(`work-thread-command.ts:143-190`)。
- sitemap:`threads` surface 已加入(`apps/web/src/engine/service-sitemaps.ts:81-87`,
  `scope:'principal'`);I5 `enumerateEntityRels` 已纳入。
- chat 自动 attach:presence 指向已存在且同 owner 的线时,当前 user message
  追加显式 `thread-reference-attached(category=context, source='presence')`
  (`apps/web/src/engine/chat-thread.ts:11-34`、`apps/web/src/app/api/chat/route.ts:946-959`)。
- D44:成员资格显式引用聚合;CLI 无 presence 可完成建线/挂载/查态/审计全流程;
  线跨 session、owner 绑定 principal。

### T29 在场与处境(scope 常显与进线留痕的事实层;已闭环)

- presence 事件四种:`presence-site-changed|presence-scope-changed|
  presence-thread-changed|presence-focus-changed`(domain=`'presence'`,
  `packages/shared/src/presence.ts:33-38`);有界(`MAX_PRESENCE_VALUE_LENGTH=256`,
  每 principal 120 次/分钟,`db/presence.ts:254-261`);投影表
  `presence_current(principal, site, scope, thread, focus, updated_seq)`
  (`db/presence.ts:23-36`),独立 fold,不进业务 snapshot。
- 处境单一装配点:`assembleSituation`(`apps/web/src/engine/situation.ts:73-87`),
  `Situation{principal, site, scope, thread, focus, disclosure{scope,thread,focus}}`
  (:31-38);既有消费方:chat 路由(`api/chat/route.ts:815/927/943`)、entity
  路由(`api/entity/route.ts:59-74`)、`situationForChat`
  (`engine/chat-situation.ts:8-45`);消费矩阵测试
  `engine/situation-consumers.test.ts`。红线继承:装配零启发式;消费方不得
  自行推导(前端常显的数据源形态是 Phase A 第 2 问)。
- 客户端上报:`PresenceReporter`(`app/layout.tsx:22-23` 挂载)→
  `apps/web/src/presence/client.ts`:`presenceObservationForLocation` 从 URL 推导
  site(pathname `/meta` 前缀 → `'meta'`,否则 `'business'`,:51)/ scope
  (`?scope=`,:54)/ thread(`?thread=`,:55)/ focus(依次 `?focus=`→`?roots=`
  →`?rel=`,:36-46);`POST /api/presence`(:123-139),250ms debounce,变化点
  才上报(:64-66 四种 change kind)。
- clientView v2:`ClientViewPresence{clientInstanceId, site, scope, thread, focus,
  presenceSeq?}`(`packages/shared/src/presentation/chat-view.ts:15-23`);user
  message 同写 `chat-message-appended`(`chat/client-view.ts:15-35`、
  `api/chat/route.ts:946-954`)。

### T24 呈现诚实化(机制信息归抽屉;已闭环)

- canvas 首屏零机制词汇;"为什么这样展示"抽屉承载 surface id/catalog/sidecar
  生命周期/provenance(`canvas-why-drawer.tsx`);chat 思考流折叠 + 活动语言 +
  失败分层(机械层只产结构化 reason,人话归 LLM)。
- 本 Track 继承:新首屏同样零机制词汇;组合的机制信息(区域清单/声明版本)
  已在抽屉(T30),不上新首屏。

### T25 分层披露(边界声明;已闭环,本 Track 不改动其实现)

- D41:起点链 `startRelFromSituation`(`apps/web/src/chat/start-chain.ts:8-15`:
  Situation 字符串 focus → `applications[scope].entry` → 站点兜底 business
  `articles` / meta `meta/flows`);prompt wire budget 32 KiB
  (`packages/agent/src/llm/prompt-budget.test.ts`)。
- 关系:本 Track 改变的是 presence 输入(用户在哪/看什么),披露收窄仍只发生在
  prompt 层;不窄化 `/.well-known/ui4a.json`、`/api/entity` 等任何公开合同。

### T28(后续 track,非依赖)

实体动作一等按钮、chat 引用可点、raw 模式抽屉归 T28。本 Track 为其坐实站点
框架(零件表折叠、raw 无顶级入口);组合 surface 内动作控件沿用 action gate
现状。

## 现状事实(代码锚点;2026-08-26 复核,实施前以仓库现状再复核)

### 路由与壳

- 15 个 page.tsx 路由:`/`(page.tsx:11-17,EntityCacheProvider + HomeBody)、
  `/entity?rel=`、`/events`、`/delegations`、`/canvas`、`/chat`、`/meta`、
  `/meta/self`、`/meta/entity`、`/meta/activations`、`/meta/activation/[id]`、
  `/meta/capabilities`、`/meta/capability/[name]`、`/meta/flows`、
  `/meta/flow/[name]`。**无 `/inbox` 路由**——收件箱即 `/entity?rel=inbox`。
- 壳:`apps/web/src/components/app-shell.tsx:20-37`(AppShell:sticky 顶栏 +
  `max-w-5xl` 主栅格 + aside 槽);`apps/web/src/app/layout.tsx:15-28`
  (AppShell `aside={<FloatingChat />}` + PresenceReporter)。
- SiteNav `NAV_ITEMS`(`site-nav.tsx:8-15`):首页 `/`、收件箱
  `/entity?rel=inbox`、事件流 `/events`、画布 `/canvas`、委托监控
  `/delegations`、定义管理 `/meta`——六项零件表,即本 Track 重组对象。
- chat 三形态壳(FAB/sidebar/独立窗口)在
  `components/chat/floating-chat.tsx:41-112`,FAB `data-nav="local:chat-open"`;
  chat 是助手主入口,首屏保留(本 Track 不动其形态与 SSE 链路)。

### 首页现状(退役对象)

- `home-body.tsx`(306 行,`'use client'`)六区块全部硬编码 `section`+`Card`:
  标题(APP_NAME+v,:146-149);运行概览(stat×3 + timeline,
  `data-testid="situation"`,:157-185);文章(成员链接 + flow 入口,:187-228);
  收件箱(:230-246);评论队列(:248-264);委托监控(纯链接,:266-283);
  定义管理(纯链接,:285-303)。
- 取数:`cache.get('articles'/'comments'/'inbox'/'delegations')` +
  `fetch('/api/events')`(:84-91);401 经 `redirectToLoginOnAuthError`。
- `apps/web/src/app/home.test.tsx`(384 行)整文件钉死旧首页六区块;其中
  "纯导航首页零可提交元素"断言(:306-324)在新首页(= surface 宿主)下迁移为
  action gate 口径(可提交元素全部经 action gate,与 canvas 同口径)。

### canvas 宿主(首页复用对象)

- `canvas-body.tsx`(545 行):入口参数 `concern|focus|roots|sidecar|refresh`
  (:111-119);单 focus 时 `POST /api/presentation`(body subject = focus,
  :223-247)→ `GET /api/presentation/sidecar`(:250-316)→
  `hydratePresentationSurface`(:346)→ action gate(`createActionGate` +
  `createCanvasActionHandler`,:320-326)→ 单树渲染(:510-541);
  `requestedFocuses.length !== 1` 时回退逐实体 generic 网格(:359-381)。
- 结论:以 `workspace:my-work` 为单 focus 的组合渲染链已存在。首页落地 =
  壳 + 同一宿主(提炼共享),不复制渲染链——页面滑梯正解。

### GR3 与基线事实

- `apps/web/src/components` 4491/4000 在基线(T24/T30 登记),note 明确收缩窗口
  = **T27 按 canvas/why/sidecar feature 子目录重组 components/**;home-body.tsx
  退役释出约 259 有效行。`apps/web/src/app` 456/4000 无基线。
- `e2e` 4126/4000 在基线(note:T27 落地时提炼共享 presentation evidence kit)。
- `apps/web/src/auth` 4074/4000(note:T27 接入时提炼 principal resource
  helpers)与 `apps/web/src/db` 4014/4000(T29 登记)——本 Track 原则上不触。
- GR3 按有效行计(去空行/注释,`scripts/governance/check-size.mjs`);纪律:
  业务优先不为凑行数拆分,超限由编排 agent 登记例外(workflow.md),subagent
  只如实报告。

### 不变量锚点

- I3 fuzz:`e2e/i3.spec.ts:31-47` PAGES 表 7 页(首页/事件流/收件箱/实体页/
  BIOS 激活页/画布/舰队页;首页 ready = `[data-testid="situation"]`,随新首页
  更换);`e2e/invariants.spec.ts:363-372` I3 ready 选择器同口径。**所有新控件
  必须 data-action/data-nav 注记**——零白名单 fuzz 是常驻不变量。
- I5:重放世界已含 threads(T26);站点重组不动事件语义,业务 hash 不变。
- I7:LLM 不可用时组合规划 generic 退路诚实工作(T30 已保证);首页渲染不依赖
  LLM。

## Phase A 决策投影(D46)

D46 已完成五问决断；以下是 Phase B–F 必须实现的单一路径，不得恢复被否决形态。

1. **首页落地形态。** `/` 保留独立的“家”语义，内嵌从 `canvas-body.tsx`
   提炼的共享 Sidecar 单树宿主，固定 subject=`workspace:my-work`；`/canvas`
   与 `/` 共用 `POST /api/presentation` → Sidecar → hydrate → action gate →
   单树渲染链。不得把 `/` 重定向到 Canvas，也不得复制第二套宿主。
2. **处境常显与显式声明。** 壳级常显固定展示 site/scope/thread/focus，直接
   回显 `presenceObservationForLocation` 产生的当前客户端 URL 观察，并明示为
   “你在 URL 中声明的处境”；它不展示 granted scopes、不在浏览器重算
   Situation，也不新增 GET 端点。切换 scope、进线、出线与跨站全部使用 URL
   导航；指向 `thread:<id>` 的链接统一携带 `?thread=<id>`，出线删除该参数。
   `PresenceReporter` 自动留痕，Chat 经 clientView v2 消费同一观察；不增加
   壳级“设为当前工作线”控件。
3. **站点命名与 presence site 值域。** 值域一次性改为
   `{workstation, meta}`：`/meta` 前缀推导 `meta`，其余路由推导
   `workstation`；同步迁移 Situation defaults、起点链站点兜底与测试，不保留
   `business` 双路径。raw 是随处可达的查看模式，不进入 site 值域。
4. **导航与零件表折叠。** 顶栏按 workstation/meta 分区；“我的事”与“共同
   注视”保留为 workstation 顶级入口，meta 是显式越界入口；收件箱、事件流、
   委托监控收进壳级“系统”区且原路由全部保留。所有新增可点元素带
   `data-nav`/`data-action`，raw 不新增顶级入口，首页内容区不承载这些舞台零件。
5. **跨站桥推导。** 仅按 canonical rel 命名约定
   `flow:<name>` ↔ `meta/flow:<name>` 双向机械推导，不建映射表、不在 React
   中按实体类型分支。workstation focus 为 `flow:<name>` 时显示“在 meta 中
   编辑此定义”，链接 `/meta/flow/<name>?scope=<scope>`；meta 定义页显示
   “查看活实例”，链接 `/canvas?focus=flow:<name>&scope=<scope>`。零实例或
   多实例沿用 `resolveFlowRelAlias` 的诚实 404；其他实体不显示桥。

## 最终形态(实施目标)

1. **三形态路由坐实。** workstation = `/`(默认落点);meta = `/meta`(既有,
   进入定义层的显式意图不变);raw 不是站点(无顶级入口;抽屉归 T28)。导航按
   站点组织;零件表(收件箱/事件流/委托监控)折叠为壳级系统区,路由全部保留
   (过渡态:T28 raw 抽屉落地前任何时刻裸视图可达——切片化施工,不留废墟)。
   presence site 值域一次性使用 `{workstation,meta}`。
2. **"我的事"首页。** `/` = 壳 + 共享 canvas 宿主渲染 `workspace:my-work`
   组合 surface:在等我(waiting-for-me ← inbox)、在动(in-motion ←
   delegations)、我的工作线(work-lines ← threads;线的"上次停在哪"由
   `thread:<id>` 投影的 statusPointer/recent-events 承载,T26 已落)。区块 =
   声明区域,不是组件;零每区块 React 特判。home-body 六区块硬编码全部退役;
   运行概览 stat/timeline 不移植(事实由区域与系统区事件流承载)。应用内容
   (文章/评论队列)到达路径不变(实体页/canvas focus/导航),首页不再平铺。
3. **scope 常显与声明。** 页面常驻"你在哪、在看什么"(站点/scope/工作线/注视
   对象;壳级,舞台机械);切换 scope、进线/出线、跨站跳转是显式动作,presence
   事件自动留痕(既有机制),chat 上下文经 clientView v2 同源消费(既有)——
   进入即声明,声明即留痕。零新事件种类、零装配分支。
4. **内容面零硬编码页面。** 首页内容面全部经 T30 组合机器;舞台机械(壳、
   导航框、chat 面板、常显条)是唯一合法硬编码。my-work 声明演进(区域增改)
   走声明版本升级,不改首页代码。
5. **跨站双桥。** workstation 注视 flow 实体/flow 入口 →"在 meta 中编辑此
   定义"(显式越界,保 scope);meta flow 定义 →"查看活实例"(回
   workstation);严格使用 `flow:<name>` ↔ `meta/flow:<name>` 命名约定，零映射表、
   零类型分支。

## Scope 边界(非目标)

- 不做 raw 抽屉本体(归 T28);
- 不做实体动作一等按钮与 chat 引用可点(归 T28);首页 surface 内动作控件沿用
  action gate 现状;
- 不做呈现按 intent 裁剪(generic surface 全属性绑定的裁剪归 T28);
- 不改 meta 控制台内部治理视图(桥链接为最小壳级加法);
- 不改 my-work 声明内容与聚合规则(T30 已定型;演进走声明版本升级);
- 不做业务应用内容(CVE/track 应用是后续 track 的验收场);
- 不做多用户/团队视图、在线状态/协作感知(单实验用户现状);
- 不动 chat 三形态壳与 SSE 链路(chat 是主入口,首屏保留)。

## 施工纪律红线

- 首页零每区块/每实体类型/每应用 React 特判;区块 = 组合声明区域 + 同一台
  presentation 机器;
- 常显与声明零自然语言启发式;全部输入是 URL/presence 结构化事实;
- 处境装配仍只有一处(`situation.ts`);前端只回显 URL observation，不重算处境;
- 导航/常显/桥属舞台机械;文案面向任务语言,机器名只在辅助说明
  (product-guidelines);
- 新控件全部 data-action/data-nav 注记(i3 fuzz 常驻约束);
- GR3:业务优先不为凑行数拆分;例外登记由编排 agent 统一执行,subagent 只
  如实报告。

## 验收方向

- 首页三区块数据源断言:全部来自 my-work 声明的区域源(sitemap 可达合同
  实体),由组合 surface 承载(区块 = 区域声明,非组件);无前端私有数据源;
- **CLI 对照:首页展示的等我/在动/工作线三类事实,经 CLI 读同一合同实体
  (`inbox`/`delegations`/`threads`)逐项核对一致(人机同源的合同层证明);**
- 无每应用/每区块特判组件(代码扫描 + review);
- scope 常显与进线/出线/跨站/切 scope 留痕:对应 presence 事件落库断言;
  chat 上下文经 clientView 携带同一事实;
- 双桥 e2e:首页 → 工作线 →(注视 flow)→ 在 meta 中编辑此定义(保 scope)
  → 查看活实例 → 回 workstation;
- 不回归:`pnpm check`、`CI=true pnpm e2e invariants` 全绿;T16 presentation
  套件、T24 honesty 套件、chat 套件全绿;
- Playwright 截图走查:首屏零机制词汇、三门问题(上次干到哪/什么在等我/
  什么在动)一眼可答;
- 里程碑约束:`pnpm dev:all` 实际启动走查,系统可运行。

## 验收目标纠偏原则(本 Track 全程适用)

**既有验收测试与本 Track 目标相悖时,干掉验收目标——修正/迁移/删除测试,
绝不反向修改 track 目标去保绿。** 闭式精确清单(toEqual 全集)只许表达合同
承诺(存在性、可导航),不许冻结实现快照;凡因本 Track 正确落地而红的旧断言,
按 GR2 一次性迁移,不留双路径,处置记录进 plan 任务 notes。

防偏离要点(继承 T30 经验):**误导性验收前置迁移先于新首页落地**——顺序反了,
reds 会诱导实施者冻结旧首页、留双路径,保绿压过方向。验收断言锁目标(区块
来自声明、零特判、留痕发生、CLI 对拍一致),不钉死具体组件树形状——形状由
D46 定。

**静默缺口警戒(红灯之外的偏离形态):** 门禁照绿 ≠ 目标达成。例:三区块若由
前端私有 fetch 组装、组合机器被旁路,测试照样全绿但目标已偏——因此验收方向
设"无前端私有数据源 + CLI 读同一合同逐项对拍"哨兵,外加代码扫描 + review 查
特判;偏离判定以"核心目标"节三要点为裁判。

## 误导性验收排查(2026-08-26 复核修正,行号以当前基线为准)

本 Track 重写首页与导航,以下既有锚点按 GR2 一次性迁移;严禁"为新首页写
一套、为旧测试留一套"。反面样本:`home-body.tsx:19-20` 注释承认首页锚点为
human/s1 e2e 故意保留——e2e 正在约束首页设计,本 Track 切断这个压力。

- 首页锚点(钉死旧首页区块,必迁):
  - `e2e/human.spec.ts:52-53`("文章(共 2 篇)")、`:56`(flow 入口点击)、
    `:84`("文章(共 3 篇)")、`:116`(文章成员链接)、`:149-150`("评论队列
    (待处理 3)" + comments 链接);
  - `e2e/dual-executor.spec.ts:157`(flow 入口)、`:175`("文章(共 4 篇)")、
    `:207`(成员链接);
  - `e2e/s1.spec.ts:391-419`(收件箱计数走查:"收件箱(待确认 N)" + 回首页
    断言);
  - `e2e/smoke.spec.ts:8-9`(首页 title/heading——壳保留标题即可小改);
  - `apps/web/src/app/home.test.tsx` 全文件 384 行钉死旧首页六区块——整文件
    重写;"纯导航页零可提交元素"口径(:306-324)迁移为 surface 宿主的
    action gate 口径。
- 零件页走查(路由保留,走查基本不动;入口路径/文案变化时同步):
  - `e2e/s3.spec.ts:467-553`(/delegations 整页;其 API 级断言 :554-558 仍
    有效,保留);
  - 复核修正:`e2e/human.spec.ts:160/:169` 与 `e2e/dual-executor.spec.ts:240/:247`
    是 `/entity?rel=comments` 零件页导航,**不是首页锚点**——不随首页迁移。
- 路由/选择器硬编码:
  - `e2e/i3.spec.ts:31-47` PAGES 表(7 页;首页 ready `[data-testid="situation"]`
    随新首页更换);
  - `e2e/invariants.spec.ts:363-372` I3 ready 选择器(同上)。
- chat 启动器(chat 是主入口,首屏保留即不冲突;位置移动时同步迁移):
  `e2e/chat.spec.ts:259-266`、`e2e/t24-presentation-honesty.spec.ts:118-121/:178-181`。
- 已失效引用(2026-08-26 复核):`e2e/human.spec.ts` 全文仅 190 行,上一版
  清单的 `:263` 不存在;`:160/:169` 分类修正如上。
- 注意:i3 fuzz 机制本身(所有可点元素需 data-action/data-nav、零白名单)
  是常驻不变量,不是误导——workstation 每个新控件都必须遵守。
