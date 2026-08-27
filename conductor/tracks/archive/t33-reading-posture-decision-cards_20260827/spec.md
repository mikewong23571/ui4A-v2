# T33 读面姿态与责任点 — Specification

## 类型

Feature(交互层;消费 T27 站点框架 / T28 一等交互 / T30 组合机器;`depends_on` T32,顺序施工)

## 方向依据(北极星)

`conductor/product-vision.md` 与 `GOAL.md`:

- §一.1 AI as assistant:**"AI 让你对工作保有完整认知,同时只做你明确要点头的部分"**——
  读多写少是理念本身,不是观感偏好;助手价值最高的时刻是 scoped Q&A 与责任点协作。
  写的正典是对话:副作用需要**原话授权**(GOAL T15:执行引用 user message id 与逐字
  quote);表单是直操作退路,不该占据阅读面。
- §二 入口论:chat 是助手主入口;指代可解、引用可点已由 T28/D47.2 落地(本 Track 只
  走查复验)。
- §三 workstation 是家、AI 助手前置;**agent 不需要站点,站点全是为人建**——界面作为
  界面失败,站点就失去存在理由;观感即界面职责。
- §五 加法:"实体动作的一等按钮,可见标注人/AI 同权";渐进式披露(每层只披露下一层
  入口与意图)。**一等 = 可见 + 同裁决,不是参数表单摊开。**
- §六 两条滑梯的反面约束:特判滑梯(零 class/rel/action 名分支)、文案滑梯(机械层
  零友好文案模板;人话归合同数据与 LLM)。
- DECISIONS **D47.4**:"actions、Siren links 与 collection members 始终保留"——本
  Track **不推翻**该决定,只细化呈现姿态;D47.1 的组级固定通用文案
  ("填写{action.title}参数"式框架 + 合同数据插值)是既有合法模式。

## 背景与动机(2026-08-27 走查,锚点已逐环节核实)

用户初体验反馈:"读多写少"被违背——首页表单占据屏幕大部分;理论上不关注表单怎么填,
填写应在 chat 里完成;理念在 UI 上的体现不足,观感是界面的独特职责。

违规链四环(全部代码核实):

1. **intent 裁剪只裁字段,不裁动作。** 首页 presentation 请求带 `intent:'read'`,
   `GENERIC_INTENT_POLICY` 只约束字段角色;`generic.ts` 中 actions 区域无条件追加
   (`if (entity.actions.length > 0) regions.push({role:'actions',…})`)。
2. **带参数动作默认摊开。** `action-runner.tsx` 初始态
   `hasFields ? 'form' : 'closed'`;该组件注释自认"打开/取消是零业务事件的
   presentation interaction"(纯表现层)。
3. **空集合零成员。** `threads` 空集合下 repeat 渲染零成员,展开的 create 表单成为
   区域唯一视觉质量。
4. **合同数据英文。** `work-thread.ts` 定义 title 全英文('Create work thread'/
   'Thread id'/'Goal'/'Goal source'),触发键模板拼出"填写Create work thread参数"。

同时读面缺失责任点一等与活性可感:

- `projectConfirmation` 的 pending 实体自带 approve/reject 动作与 guard-results
  (`project.ts`),但"在等我"区域只渲染计数 + 链接,批准要导航离开——**该做成的写
  (决策卡)藏在导航后面,不该前置的写(建线表单)摊在首页上**。
- "上次停在哪"数据在 thread 投影(statusPointer/recent-events)、"在动"进度数据在
  委托属性(steps/successes),均未被说成人话。
- 写的正典(chat,原话授权,T15 仪式已存在)缩在角落 FAB——写/读通道的视觉权重安反。

## 核心目标(一句话与判定要点)

**把 workstation 读面矫正为"读多写少":阅读面上写退位为收起的一行动作(复杂写的
正典留在 chat 原话授权),责任点(批准/拒绝)升为成员决策卡一击可达,区块与字段用
任务语言呈现;ASCII 用户故事五画面为方向锚。** 三要点缺一即偏:

1. **姿态不是移除。** D47.4"actions 始终保留"与 T28"每个声明 action 有一等控件"
   不回退;出现 read 意图下不渲染动作、或绕过 action gate 的便捷提交,即背叛。
2. **写通道不新增。** 决策卡与收起动作全部经既有 action gate(fresh read →
   declaration → guard → schema → exec);chat 写与 UI 写过同一裁决器。
3. **零特判/零模板。** 决策卡、进度轨、"上次停在哪"均由合同数据驱动(成员已声明
   动作 / `presentation.fields` 角色声明 / 投影字段);出现 `if class/rel/action`
   分支或渲染器侧文案映射/i18n 模板,即背叛(特判滑梯 + 文案滑梯)。

## 站点归属

workstation 站为主(首页三区域、canvas read surface、实体页共用单一姿态默认);
meta 站与 raw 抽屉不动;CLI 零改动(agent 消费合同,不消费像素)。

## 依赖(锚点 2026-08-27 复核;实施前以仓库现状再复核)

- **T32(进行中)**:`depends_on`,其 Phase E 收尾后开工;两者同属交互面,顺序执行
  避免同文件冲突与验收互相牵连。
- **T27(已归档)**:站点框架、`workspace:my-work` 组合宿主
  (`apps/web/src/components/canvas/presentation-surface-host.tsx`)、my-work 三区域
  声明(`apps/web/src/engine/presentation/compositions.ts`:waiting-for-me←inbox、
  in-motion←delegations、work-lines←threads)。
- **T28/D47(已归档)**:contract-driven ActionRunner/动作组、citation chips、
  `GENERIC_INTENT_POLICY v1`(`packages/engine/src/presentation/surface/intent.ts`);
  D47.4 是本 Track 的继承约束(细化不推翻)。
- **T26(已归档)**:thread 投影五类属性(id/owner/goal/status + context/active(带
  statusPointer)/approval/recent-events)——"上次停在哪"的数据源。
- **T30/D45(已归档)**:组合虚主体退化到同一台 Surface 机器;区域 intent 经
  `planRegion` 进入 generic 规划。

## 现状事实(代码锚点;2026-08-27 走查核实)

- `apps/web/src/components/action-runner.tsx`:`interaction` 初始态
  `hasFields ? 'form' : 'closed'`;触发键模板"填写{action.title}参数";RJSF label
  取 schema.title(字段定义的人话标题)回退机器名——**中文化的正道在合同数据**。
- `packages/engine/src/presentation/surface/generic.ts`:actions 区域无条件追加;
  intent 预算经 `selectGenericFieldCandidates` 只裁字段角色。
- `packages/engine/src/presentation/surface/intent.ts`:READ/OVERVIEW/REVIEW/TRACK/
  FOLLOW 预算;D47.4 明文 actions/links/members 始终保留。
- `packages/engine/src/projection/work-thread.ts`:动作/字段定义 title 英文;
  `fields: [{path:'properties.title', title:'标题', role:'identity'}]` 证明角色
  声明机制在位。
- `packages/engine/src/contract/siren/project.ts`:`projectConfirmation` pending 自带
  `[CONFIRMATION_APPROVE_ACTION, CONFIRMATION_REJECT_ACTION]` + guard-results;
  `collectionIdentity('在等我'/'在动')` 证明集合人话标题的正道在投影;
  `projectDelegation` properties 含 steps/successes(无动作)。
- `apps/web/src/engine/presentation/situation.ts`:`semanticHintsOf` 读
  `properties.presentation.fields` 的 `{path, role}`——字段语义通道。
- 走查证据(当前源码 dev 实例,2026-08-27):首页 DOM 快照——在等我/在动/我的工作线
  三区域渲染 identity + 计数 + 成员链接 + 动作组;"我的工作线"区域出现
  `[expanded]` 的"填写Create work thread参数"表单(Thread id*/Goal*/Goal source*);
  "在等我"为裸计数 0,无决策卡。

## 理想态用户故事(方向锚)

以下 ASCII 五画面与通道分工图是本 Track 的**验收方向锚**:画面 1/2/4 的读面形态是
硬验收的对照来源;画面 3(chat 写)与 5(共同注视)为既有能力走查复验;画面 1 的
助手栏形态与画面 4 的"自动活过来"(事件驱动刷新)为**出 scope 的方向**(见"Scope
边界"),当前验收口径是事件落库后刷新或导航即见投影变化。

### 画面 1 · 回家(读面:零表单,读多写少)

```
 UI4A            我的事 · 共同注视 · 定义管理 · 系统 ▾
──────────────────────────────────────────────────────────────────────
 ◉ workstation │ scope: cve战役 │ 工作线: cve-0827 │ 注视: —
   (你在哪、在看什么, 永远在场; 进入即声明, 声明即留痕)
──────────────────────────────────────────────────────────────────────

 我事                                             ↻    为什么 ▾

 在等我 · 2
 ..................................................................
   CVE-2026-13357 修复方案 · coding agent 提案
     diff 12 文件 · 测试绿 · 基线 9f2c…a1           [批准] [拒绝]
   「第一篇」评论 #3 · 疑似垃圾
     置信度高 · 来源 61.x.x                         [通过] [驳回]
 ..........................................................................................
 在动 · 3
   cve-0827 情报收集   ████████░░  8/11 仓库 · agent 运行中 · 12分
   cve-0801 修复验证   ██░░░░░░░░  2/9     · 等待重试

 我的工作线 · 2
   ▸ cve-0827  昨晚 23:41 停在「webflux 影响面确认」         [进线]
   ▸ cve-0801  今晨 09:12 停在「评审被拒: 缺回归用例」       [进线]

   ＋ 新工作线                 (一行; 表单不存在, 写的事在下面说)
──────────────────────────────────────────────────────────────────────
 助手 · 与你同看此页                                (前置, 非角落FAB)
   早上好。昨晚 3 个仓库跑完, 2 个结果等你点头;
   cve-0801 评审被拒, 理由是缺回归用例。先处理哪个?
   > _
```

### 画面 2 · 责任点(UI 里唯一的写 = 一次点头)

```
    你点 [批准]
       │
       ▼   与 assistant 过同一道门 (人/AI 同权)
    declaration → guard → schema → human-only 确认
       │
       ▼   事件 #1198  confirmation-decided · actor=human · 回执 #a92f
 在等我 · 1                        ← 卡片退场, 计数即变
 在动 · 4                          ← 修复因你的点头继续流动
```

### 画面 3 · 复杂的写(在 chat 里说人话;既有能力,走查复验)

```
 你   再建一条线，盯一下 spring 那批 CVE，优先 webflux
 助手  收到。将执行 threads#create (合同动作), 起草如下:
       引用原话: 「盯一下 spring 那批 CVE，优先 webflux」
         id          cve-spring            (建议值, 可改)
         goal        盯 spring 批次 CVE, 优先 webflux
         goalSource  chat 消息 #m41 · 逐字引用
       [ 执行 ]      [ 改参数 ]      [ 算了 ]
 你从不打开表单; 原话作为授权证据随事件落库 (T15 既有仪式)。
```

### 画面 4 · 执行后(投影活过来)

```
 事件日志 (append-only, 唯一真相)
    #1201  threads#created    actor=human · 授权=原话「盯一下…」
    #1202  agent-run#started  cve-spring 情报收集 · coding executor
       │
       ▼   首页/画布只是这份日志的投影, 事件到达即更新
 我的工作线 · 3
   ▸ cve-spring  刚刚       停在「线已建立」               [进线]
 在动 · 5
   cve-spring 收集   ░░ 0/4 仓库 · 刚开始
```

### 画面 5 · 共同注视(引用落面;既有能力,走查复验)

```
 你   (在线里) 还剩多少没处理完?
 助手  4 个仓库完成 1 个: spring-core ✓;
       [cve-spring · 汇总]      ← 结构化 FactRef chip, 非文本猜链
         │ 点击 → /canvas?focus=thread:cve-spring&thread=cve-spring
    ↳ 高亮环 + aria-current; URL 是唯一真相
```

### 通道分工图

```
       读面 (workstation / canvas)           写通道 (chat)
   ┌─────────────────────────────    ┌─────────────────────────────
   │ 投影 · 一眼可答 · 观感即职责    │ 说人话 → 助手起草参数
   │ 决策卡 / 进度轨 / 工作线时间线  │ 引用原话 → 你点头 [执行]
   │ 动作收为一行, 表单不进阅读面    │ 原话授权随事件落库
   └──────────────┬──────────────    └────────────┬────────────────
                  └──────────┐      ┌──────────────┘
                             ▼      ▼
                declaration → guard → schema → exec
                  (human 与 assistant 过同一道门)
                             │
                             ▼
                责任点 · UI 里唯一的一等写
             批准 / 拒绝 / 确认 = 一次点击, 零参数
```

### 今天 → 理想对照

```
   今天                              理想
   首页英文表单摊开半屏        →    一行「＋ 新工作线」, 写进 chat
   助手缩在右下角 FAB          →    前置助手栏, 与你同看此页 (出 scope)
   在等我 = 裸 "0" + rel 链接  →    决策卡 + 一击批准
   「上次停在哪」不可感        →    每条线一句话 + 时间 + [进线]
   在动 = 0                    →    进度轨, 活性可见
```

## 最终形态(实施目标)

1. **写姿态单一默认收起。** ActionRunner 初始态改 `closed`(打开仍是零业务事件的
   表现层交互);全站单一默认,实体页同改(GR2 不留双路径);动作呈现为一行触发键 +
   "人/AI 同权"图例;打开后 prefill/焦点/两段式确认行为不变。
2. **责任点一等:成员决策卡。** 集合成员携带已声明动作时,成员渲染为决策卡
   (identity + 一行结构化摘要 + 动作行);"在等我"区域批准/拒绝一击、零参数、零
   导航。选择规则纯结构(成员有无已声明动作),零类型分支。
3. **工作线一句话。** "我的工作线"成员呈现"上次停在哪":statusPointer/
   recent-events 经 `presentation.fields` 角色声明进入 surface,任务语言投影;
   框架文字通用固定,数据全部合同插值(D47.1 模式)。
4. **在动进度轨。** 委托成员按 steps/successes 的机械计数呈现进度。
5. **任务语言。** work-thread 定义动作/字段 title 中文化;成员/自身链接标签优先
   合同携带的 title(Siren link title / identity),回退 rel;读面零机器名(英文
   slug、裸 rel)。
6. **D50 落 DECISIONS.md**:① D47.4 姿态细化(actions 始终保留;参数表单单一默认
   收起;无双路径);② 读/写通道分工方向判断(复杂写正典在 chat 原话授权,UI 保留
   责任点一击)。

## Scope 边界(非目标)

- 不做首页助手栏 / AI 前置形态重构(另立 track);
- 不做事件驱动活性推送/自动刷新(验收口径:事件落库后刷新或导航即见变化);
- 不改 chat 写链路与 citation(既有能力,只走查复验);
- 不推翻 D47.4(read 意图下移除动作不在候选内);
- 不做 LLM Presentation 规划接管(仍 generic + 组合机械规划);
- 不动 meta 站、raw 抽屉、why 抽屉;
- 不改 my-work 声明的区域构成(聚合规则归 T30 口径;演进走声明版本升级)。

## 施工纪律红线

- 新控件全部 `data-action`/`data-nav` 注记(I3 零白名单 fuzz 常驻约束);
- 词汇/目录变更走 catalog 版本升级(sidecar 依赖失效走既有机制,不手工失效);
- GR3:触及 `packages/engine/src/presentation`(shrink-only 基线目录)须净不增长;
  例外登记由编排 agent 统一执行,subagent 只如实报告;
- 既有钉死展开表单的验收按 GR2 一次性迁移(多一步"打开"),不留双默认;
- 文案:任务语言只来自合同数据(定义 title/投影 identity/link title)或 LLM;
  渲染器只保留 D47.1 式通用固定框架,零实体类型分支、零 i18n 映射;
- 验收目标纠偏原则(继承 T27):既有验收与本 Track 目标相悖时,修正/迁移/删除测试,
  绝不反向修改 track 目标保绿。

## 验收方向

- **机械断言**:读面(首页三区域、canvas read surface、实体页)零默认展开的参数
  表单;每个声明动作有一行收起控件(`data-action` 注记)且提交经 `/api/exec` 同
  裁决;"在等我"成员决策卡 approve 一击可达(零导航、零参数);work-thread 动作/
  字段 title 为任务语言;成员/自身链接标签优先合同 title;零特判代码扫描 + review;
  D50 存在且显式引用 D47 原文。
- **走查对照**:Playwright 截图走查对照画面要素清单(决策卡含动作行 / 工作线
  "停在「X」· 时间"一句话 / 在动进度呈现 / 写为一行收起)。
- **chat 写复验**(画面 3):经 chat 建线走原话授权(引用 user message id 与逐字
  quote),事件留痕,投影更新。
- **CLI 对拍**:首页三类事实(`inbox`/`threads`/`delegations`)经 CLI 读同一合同
  逐项一致(人机同源证明)。
- **不回归**:`pnpm check`、`CI=true pnpm e2e invariants`、T16/T24/T27/T28 相关
  套件全绿。
- 本地 `pnpm check`/Playwright 只作开发门禁;最终验收从确定 Git SHA 构建 Web/Worker
  immutable OCI images,按 T22 runbook 部署 mothership 现场走查(与 T27/T28 同口径),
  evidence 记录 SHA、image digest、命令、时间与逐项结果。

## 误导性验收排查(2026-08-27 初核;实施前以 grep 复核补全)

- **钉死展开表单的验收(必迁,GR2 一次性)**:`action-runner` 组件单测(默认态/
  prefill 流);`e2e/human.spec.ts`、`e2e/dual-executor.spec.ts`、`e2e/s1.spec.ts`
  (approve/发布向导填表)、`e2e/workstation-home.spec.ts`、chat 套件中直接提交动作
  的步骤——统一加"打开表单"一步,不保留任何"某处默认展开"的旧口径;
- **钉死英文机器名的断言(必迁)**:work-thread title 相关快照/断言随合同数据
  中文化同步;
- **钉死成员渲染为纯链接的断言(必迁)**:带动作成员升级决策卡后,组合区域成员
  形状断言按新口径迁移;闭式 `toEqual` 只表达合同承诺,不冻结组件树形状;
- **不是误导**:I3 fuzz(所有可点元素 `data-action`/`data-nav`)、I2 binding-only
  property 套件、`CI=true pnpm e2e invariants`——这些是常驻不变量,照常全绿。

## 防偏离要点

**静默缺口警戒**:门禁照绿 ≠ 目标达成。若决策卡由前端私有 fetch 组装、动作行绕开
action gate、或"停在「X」"由渲染器按 rel 特判拼出,测试可能照样绿但目标已偏——
验收设"合同数据驱动 + 同一裁决 + 零特判扫描"三哨兵,偏离判定以"核心目标"节
三要点为裁判。反向警戒:为让读面干净而移除动作或硬编码文案映射,是比现状更深的
背叛(D47.4 / 文案滑梯),当场退回。
