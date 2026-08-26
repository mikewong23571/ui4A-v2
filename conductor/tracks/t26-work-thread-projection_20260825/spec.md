# T26 工作线投影 — Specification

## 类型

Feature(投影模型;spike → 实施;零新真相)

## 方向依据(北极星)

`conductor/product-vision.md`:

- §四 工作线:用户的工作单位不是应用,是"一件事"——一个目标 + 一包上下文
  (跨 scope 实体)+ 进行中的 flow/run + 待批准项 + 最近事件。纯投影,不是
  新真相;是 scoped context 的真正载体、首页的主角、AI 上下文的边界。
  application 是图书馆不是书桌——线不该挂在单一应用名下。
- §一.3 scoped context is the most important:scope 是默认镜头,线是镜头的
  工作单位。
- §六 规则滑梯:成员资格写成 `if type === …` 即背叛;正解是声明式、可治理
  的数据,引擎只做 fold。本 Track 评审固定项:无每应用/每实体类型特判代码。
- §八.3:复合投影是新物种——"什么在等我/什么在动"是跨域聚合,必须有声明式
  投影位置,不得塞进 service 函数成为隐性第二真相。
- §八 CLI 纪律二:成员资格由事件显式引用聚合,不得仅由 presence 隐式推导——
  否则 CLI/外部 agent 的工作落在线外,人机两世界。

## 背景与动机

今天目标、上下文实体、进行中的 flow/run、待批准项、事件全部以散落投影存在
(chat session、delegations、inbox、agent-runs 各自独立),没有任何对象把
它们聚成"一条线"。conductor 的 track 目录就是这个聚合的人工文件版。T29 已把
thread 作为在场锚点铺到 presence/situation/clientView 全链路,但"线本身"
尚不存在:没有实体、没有成员、没有 fold。本 Track 补上这个投影对象。

## 站点归属

投影层(引擎/DB),本身无站点;消费方是 workstation 站(T27 首页"我的事")
与 assistant 上下文边界(T25 落的 scope 收窄,将来由线承接为边界单位)。

## 依赖

- T29(已完成,`conductor/tracks/archive/t29-presence-situation_20260825/`):
  thread 在场锚点全链路已存在——`presence-thread-changed` 事件
  (domain=`presence`,detail 为 `PresenceChange{kind:'thread', value}`)、
  `presence_current.thread` 列、`Situation.thread`
  (`apps/web/src/engine/situation.ts`)、`situationForChat`
  (`apps/web/src/engine/chat-situation.ts`)、clientView v2
  `ClientViewPresence.thread`(`packages/shared/src/presentation/chat-view.ts`)、
  URL `?thread=` 客户端推导(`apps/web/src/presence/client.ts`)。锚值上限
  256 字符(`MAX_PRESENCE_VALUE_LENGTH`)。presence 只是锚点信号,不是成员
  资格真相。
- T25(收尾中):scope 披露边界已落(D41);本 Track 不改 prompt/披露实现,
  只提供未来承接的对象。
- D41(DECISIONS.md):披露收窄不窄化公开合同——`threads`/`thread:<id>` 进
  业务 sitemap 后即为 CLI/外部 agent 的完整发现面,不做披露层裁剪。

## 现状事实(代码锚点;实施前以仓库现状复核)

- **fold 主循环**:`packages/engine/src/projection/fold/index.ts` `fold()`
  按 `event.kind` switch,**未知 kind 抛错**;snapshot 各表按"恒携带"约定经
  `initial.x ?? {}` 合并(delegations 表为样板,约 line 190)。新投影表 =
  新 case + 新 `apply-*` 模块(参照 `apply-confirmation.ts`)+ initial 合并。
  事件 kind 是**两套 union**:web 侧 `EventKind`(`apps/web/src/db/events.ts`)
  与引擎侧 `LogEventKind`(`packages/engine/src/projection/fold/log-event.ts`),
  新增 kind 两边都要加;`readLog`/`toLogEvent` 只过 core domain。
- **实体投影解析顺序**:`packages/engine/src/contract/siren/project.ts`
  `project()`:artifact: → meta/* → instance → collection → confirmation:<id>
  → delegation:<id> → inbox → delegations → render-spec:*。`thread:<id>` 与
  `threads` 是新分支;class 命名参照 `['collection','inbox']`、
  `['delegation', status]` 模式。
- **sitemap 暴露**:`apps/web/src/engine/service-sitemaps.ts`
  `currentSitemap()` 经 `DeriveSitemapOptions.extraSurfaces` 加入 comments/
  inbox/agent-runs 等;`threads` 集合 surface 同法加入,按 contentVersion 缓存。
- **rel 别名样板**:`apps/web/src/engine/flow-entry.ts`(`flow:<name>` →
  实例 rel 的唯一性解析与集合入口链接);`thread:<id>` 如需入口链接可复用。
- **授权覆盖**:`/api/entity` 对 credentialed 客户端走
  `relCoveredByPolicyScope`(`apps/web/src/auth/application-scope.ts`,rel→app
  映射);新 rel 必须被 scope 覆盖否则 403。工作线跨应用——归属哪个 policy
  scope 是 spike 第 3 问的核心。
- **chat 事件无 thread 字段**:`apps/web/src/chat/history.ts` 的
  `ChatTurnDetail`/`ChatMessageAppendedDetail` 等形状均无 `thread`;唯一结构化
  锚是 `goal{verb/targetRel/resource/fields}` 与 user message 携带的
  clientView(v2,含 presence.thread)。加 thread 锚是形状变更,读者
  (history/trail/decisions/conversation)需同步。
- **agent run 来源链**:`run.source = {rel, action, eventId}`
  (`apps/web/src/db/agent-runs.ts`;`service.ts` `createAndDispatchAgentRun`
  从 sourceRel/sourceAction/sourceSeq 填入);`enrichEntityWithAgentRuns`
  (`apps/web/src/engine/agent/agent-runs.ts`)按 source rel 给任意实体加
  backlink——线的"进行中"聚合可复用同一按源匹配模式。
- **delegation/confirmation 形状**:`DelegationSnapshot.goal{verb,targetRel,
  resource,fields}`、`startRel`、`principal`;`ConfirmationSnapshot.targetRel/
  targetAction/proposedBy/channel/status`。两者都无线索字段,关联只能靠显式
  引用(引用写在哪由 spike 第 1 问决定)。
- **CLI 通道**:`apps/cli/src/commands-business.ts` `actions exec` 把
  `--params`/`--params-file` 原样透传进 `/api/exec` body;但 engine 裁决只接受
  动作 fields schema 声明过的参数——`thread` 参数要落,就必须在锚定动作的字段
  声明里,或走线实体自身的 action(spike 第 1 问的核心抉择)。CLI 源码目前
  零 `thread` 提及。
- **GR3 大小门禁**:`apps/web/src/db` 已 4014/4000 在基线
  (`scripts/governance/size-baseline.json`,T29 授权登记);新代码优先落
  `packages/engine/src/projection/`,web 侧接线保持薄;确需超限由编排 agent
  按 workflow.md 业务优先原则登记例外,subagent 不自行裁剪。
- **I5 重放不变量**:`e2e/invariants.spec.ts` `enumerateEntityRels`
  (约 lines 574–597)硬编码 inbox/delegations/render-specs 等 rel 清单;
  `threads`/`thread:*` 要进 I5 世界需同步扩展。
- **多写者交换性**:worker 是第二写者(delegation-* 事件),fold 消费方必须
  容忍乱序/迟到 seq(`refreshFromLog` 重建分支;论证见
  `apps/web/src/engine/service.ts:316-333`)。

## Phase 0:Spike(必须先回答,产出 DECISIONS 条目)

每问给出:候选、约束、推荐默认、否决项与理由。spike 产出一律落
`DECISIONS.md`(D44),分歧先于代码(GOAL.md 约束)。

1. **成员资格主规则:显式引用写在哪。** 候选:
   - (a) **线实体动作**:`thread:<id>` 自带 `attach`/`detach` action,参数
     为实体 rel 集;成员资格 = 这些 action 事件的 fold。最收敛,CLI 原生可用
     (`actions exec` 直达),不动任何既有动作 schema;
   - (b) **exec/goal 携带 thread 字段**:可锚定动作的 fields 声明可选
     `thread`,exec 事件 detail 显式记录之,fold 按之归聚——注意这是应用
     内容(定义字段)变更,不是引擎分支;
   - (c) **chat turn goal 锚定**:turn detail 记 `thread`,该 turn 后续事件
     继承——警惕:继承即隐式推导,违反 CLI 纪律二的风险最高。
   约束:允许组合,但必须有一条主规则且 CLI 在无 presence 下也能完整表达。
   presence.thread 的定位:只做请求入口默认值(situation 装配现状);
   **落库事件上的 thread 引用必须显式记录,与入口推导来源无关**。
2. **生命周期**:线的创建/暂停/完成/归档由什么事件界定?候选:显式 action
   (create/close/archive,挂在 `threads` 集合或 `thread:<id>`)vs 隐式
   (首次引用即建线)。能否跨 session?(预期:能;key 绑定 principal,
   不绑定 sessionId,同 sidecar 纪律。)线的 id 空间与命名规则。
3. **跨 scope 引用与授权**:上下文包跨应用/跨平面(business/meta)的 rel
   表示法;`thread:<id>` 与 `threads` 的 policy scope 归属——线不属于任一
   应用,`relCoveredByPolicyScope` 现状按 rel→app 映射,需要决定:专门
   scope、principal 维度放行、还是归入某既有 scope;credential 模式下
   `assertRelInPolicyScope` 如何放行;与 sidecar key 的 policyScope 维度
   如何对齐。
4. **与既有对象的关系(收编而非复制)**:chat session、delegation、flow
   实例、confirmation、agent run 如何被"引用进线"而不产生第二真相——线实体
   只存 rel 引用与 fold 出的状态指针,不复制对象内容。命名:work thread
   (产品)与 track(conductor 施工)的映射是否入文档。
5. **在场锚点复用**:线的进入/离开复用 T29 `presence-thread-changed`(已是
   事实);presence 只记锚点,成员资格仍按第 1 问显式引用聚合;
   `Situation.thread` 的消费方接线(T25 承接、T27 常显)不在本 Track。

## 最终形态(实施目标)

1. **`threads` 集合与 `thread:<id>` 实体**:core domain 事件 →
   `packages/engine/src/projection/fold/` 新 `apply-thread.ts` + `fold()` 新
   case + snapshot 新表(恒携带),与 delegations/inbox 同族;重放可重建,
   终态 hash 一致;web 侧只加 `EventKind` 成员与薄接线。
2. **实体内容**(成员与生命周期全部 fold 自事件;状态指针只在同一
   `EngineSnapshot` 内做纯投影组合,零 DB/网络查询与零副本写回):
   - 目标(goal 原文与来源:创建参数/消息引用);
   - 上下文包(显式链接的实体 rel 集,跨 scope 保留 scope 前缀);
   - 进行中(关联 flow 实例/agent run/delegation 的 rel + 从各自主投影解析的状态指针);
   - 待批准(关联 confirmation/draft rel);
   - 事件切片(显式关联的事件 seq 区间或 rel 清单,有界)。
3. **归属规则声明式**:成员资格由事件中的显式 thread 引用聚合;引擎只做
   fold,零 `if type === …` 分支(规则滑梯红线)。
4. **合同暴露**:`threads`/`thread:<id>` 进业务 sitemap(extraSurfaces
   同法),人类与 agent 同读;I5 `enumerateEntityRels` 同步纳入。
5. **CLI 正典**:无 presence 的 CLI/headless 形态能完成建线、挂载、查态、
   审计全流程(显式是正典,同 T29 纪律一)。

## D44 实施形状

- core event kind 固定为 `thread-created`、`thread-reference-attached`、
  `thread-reference-detached`、`thread-status-changed`;detail 统一携带显式
  `threadId`,创建事件另携带 goal/owner,引用事件携带封闭 `category + rel`,
  状态事件携带目标 status。解析器拒绝多余字段、非法 id/rel/category/status、
  空 principal 和超界数组/字符串。
- `ThreadSnapshot` 只含 id/owner/goal/status、四类有序去重 rel 集和有界最近
  event seq;不复制目标实体内容。`project()` 用同一 snapshot 解析可得的当前
  status,不可解析引用仍保留 dangling link。
- 动作固定为 `threads#create` 与 `thread:<id>` 的 `attach`、`detach`、
  `pause`、`resume`、`complete`、`archive`;调用方显式提供 thread id,
  服务端可信 principal 固定 owner。动作经通用声明 → guard → schema helper
  裁决,并沿用 `action-rejected` 留痕。
- `threads`/`thread:*` 对 Application scope 中立,但 HTTP exact/list/exec
  永远按可信 principal 校验 owner;credentialed 响应再按当前 policy scope
  裁掉不可覆盖的成员引用。sitemap 只暴露集合入口,不把每条私有线列成 surface。
- chat 只在当前 presence 指向一条已存在且同 owner 的线时,为当前 user message
  追加一条独立、显式的 `thread-reference-attached(category=context)` core
  事件,detail 记录来源为 presence。后续 turn/exec/run 不继承该关联;CLI 直接
  执行同一个 attach action,不需要 clientView 或 presence。

## Scope 边界(非目标)

- 不做任何 UI(workstation 首页归 T27);
- 不做线的 meta 定义治理(线类型/模板经 meta 定义——后续 track 候选);
- 不引入新事件 domain 之外的写路径(线的创建/更新仍是普通 core 业务事件,
  经裁决或经线实体 action,不走旁路);
- 不改 T25 的披露/prompt 实现(scope 边界由线承接是后续接线);
- 不做外部系统投影(MR/流水线/CVE 情报——应用内容,后续 track)。

## 施工纪律红线

- 纯投影:零新真相;除新增投影表本身,重放 hash 与现状等价;
- 成员规则声明式数据驱动,无每工作类型/每应用特判代码;
- 线的 key 绑定 principal,不绑定 session;
- presence 只做入口默认与锚点,成员资格落库必须显式(CLI 纪律二);
- fold 新 kind 显式 case;web/引擎两套 kind union 同步登记;
- GR3:`apps/web/src/db` 已在基线上沿,新逻辑落 engine 包,web 侧薄接线;
  例外登记由编排 agent 统一执行(业务优先原则)。

## 验收方向

- spike 产出:五问的 DECISIONS 条目与否决项记录;
- fold/重放测试:投影可重建、终态 hash 一致;未知 kind 不静默;
- 合同测试:`threads`/`thread:<id>` 实体的 Siren 形状(class/links/actions/
  guard-results);sitemap 出现 threads surface;credentialed 客户端 scope
  覆盖放行;
- **防 chat 化形状断言(红线测试)**:`thread:<id>` properties 含 goal/上下文
  包/进行中/待批准/事件切片五类,且**不含 messages 字段**;links 指向实体与
  run,不以 chat session 为骨架——线是会话的引用者,不是对话的包装盒;
- **思想实验验收口径(写入 D44)**:删掉整个 chat 子系统,线仍完整存在、
  可被 CLI 操作、可从空库重放——"没有 chat,线还在吗"答案必须为是;
- **CLI 对照:经 CLI(显式 thread 锚,无 presence)完成建线/挂载/查态/审计
  全流程;同一场景人类经 chat + presence 锚各跑一遍(GOAL.md 双执行者口径);**
- I5:`enumerateEntityRels` 纳入 threads 后在线/重放 hash 一致;
- 不回归:`pnpm check`、`CI=true pnpm e2e invariants`、chat 套件全绿。

## 验收目标纠偏原则(本 Track 全程适用)

**既有验收测试与本 Track 目标相悖时,干掉验收目标——修正/迁移/删除测试,
绝不反向修改 track 目标去保绿。** 闭式精确清单(toEqual 全集)只许表达
合同承诺(存在性、可导航),不许冻结实现快照;凡因本 Track 正确落地而红的
旧断言,按 GR2 一次性迁移,不留双路径,处置记录进 plan 任务 notes。

## 误导性验收排查(2026-08-26 全量扫描,行号以当时基线为准)

施工前必须处置的反向施压项(测试绿 = 方向错):

- `e2e/s2-meta.spec.ts:297-310`:surfaces rel 精确 toEqual(12 项)——
  保绿即禁止 threads 进 sitemap,违反 D41 与本 Track 合同暴露目标;
  Phase C 动工前改开放断言(样板:`ui4a.json/route.test.ts:42`、
  `service.meta.test.ts:176` 的 arrayContaining);
- `apps/web/src/app/api/contract.test.ts:204-211`:collection 表面精确
  toEqual(6 项)——同上,且在 always-on Vitest 门禁,更早开火;
- `e2e/invariants.spec.ts:579-597` enumerateEntityRels:硬编码 rel 清单,
  两侧重放自洽永不红——不扩展则 threads 无 I5 覆盖而门禁照绿(静默缺口,
  比红灯危险,必须纳入);
- `e2e/s4.spec.ts:269-287/:359-372/:460-476`:三处精确 6-scope 列表——
  spike 第 3 问若新建 scope 会红,属"正确的红",D44 记录放行方式;
- `e2e/eval/t15-u22-failure.spec.ts` NON_BUSINESS_KINDS 闭集:thread 事件
  本不应在失败 LLM 回合出现,留意即可,无需改动。
