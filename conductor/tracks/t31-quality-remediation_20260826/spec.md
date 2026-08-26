# T31 质量评审修复 — Specification

## 类型

Fix(T24–T30 实现质量评审发现项的登记与修复;无新功能、无架构变更)

> **锚点约定:** 全部代码锚点使用"路径 + 符号/测试名",不写行号(T27 在途
> 施工,行号必然漂移)。实施前以仓库现状复核。

## 背景与动机

2026-08-26 对北极星 program 五个已闭环 track(T24/T25/T26/T29/T30)做了实现
质量评审(5 个并行 subagent,对照各 track spec/plan/DECISIONS,重跑 focused
测试约 500 用例全绿)。结论:**五个 track 验收声明全部成立,红线无实质违反**;
但累计发现 3 个 medium、17 个 low、2 个流程项与 5 个归后续项,共 27 项
(R1–R27)。这些发现分散在
五份口头评审报告里,不落档就会蒸发——本 Track 把它们登记成册(见"发现项
登记册")并集中修复。发现项的属地代码谁也不欠,不登记即无人修。

## 核心目标(一句话与判定要点)

**登记册 27 项全部进入终态:medium 测试缺口补齐且被证明能红,low 逐项修复或
经 DECISIONS 记录为有意偏离,流程项恢复可追溯性,归后续项在目标 track 文档
中落注。** 判定偏离要点:本 Track 只修不建——若发现自己在加新能力/新机制,
即越界;修复不得引入新旧双路径(GR2),不得为保绿削弱断言。

## 站点归属

跨站卫生层;主要触及 apps/web(chat/presence/engine 接线)与少量
packages/engine、packages/agent、scripts/governance。CLI 零改动。

## 发现项登记册(2026-08-26 评审,全等级全量)

### Medium(测试缺口,行为破坏时无测试会变红)

- **R1**(←T24)route 级 activity/eventSeq 真实接线无断言:
  `apps/web/src/app/api/chat/route.ts` 的 step 帧投影接线在真实 route 形状上
  无测试;`route-ai-first.test.ts` 只断言机器文本,e2e/t24 用合成 SSE。对应
  T24 spec 验收方向"chat SSE 呈现"条。
- **R2**(←T29)presence 频率上限无测试:`apps/web/src/db/presence.ts` 的
  `PRESENCE_MAX_EVENTS_PER_WINDOW` 窗口计数与 `api/presence/route.ts` 的 429
  映射均无测试命中。T29 spec 红线明文"事件种类**与频率上限**入合同测试",
  只兑现了种类。
- **R3**(←T29)消费方矩阵以源码文本断言代替行为切面:
  `apps/web/src/engine/situation-consumers.test.ts` 用 `readFileSync +
  toContain` 冻结实现形状(重构字符串误红、行为漂移不红);entity 路由
  "presence → scope 缺省"路径无带 presence fixture 的行为测试。T29 plan
  承诺"改一处 presence → 两处行为同变",以弱形式交付。

### Low(行为/一致性修复)

- **R4**(←T26)`work-thread-command.ts` 的 `thread-id-available`(重复创建)
  以 guard-failed 层拒绝但执行位置在 schema 校验之后——与 declaration →
  guard → schema 层序自述不一致(功能等价)。**需 D47 裁决层序归位。**
- **R5**(←T26)`projection/work-thread.ts` 的 context 类引用链接不加
  `dangling` 标记(active/approval 类加);chat 接线写入的 `message:<turnId>`
  href 恒 404 且无可审计标识——D44"不可解析引用保留为可审计 dangling ref"
  只对两类成员兑现,类间不一致。
- **R6**(←T26)`apps/web/src/engine/chat-thread.ts` 裸 `catch` 吞掉一切错误
  (含 DB 故障)且零日志;chat 不阻断是 D44 设计意图,但 attach 失败无任何
  可观测性,排障盲区。
- **R7**(←T26)`apps/web/src/auth/application-scope.ts` 用
  `entity.class.includes('work-thread')` 每类硬编码分支做裁剪;同文件 sitemap
  已有声明式 `scope/memberRelPrefix` 元数据可用——滑梯边缘。
- **R8**(←T29)`apps/web/src/engine/situation.ts` 的 `scopeFrom` 在
  grantedScopes 为空时不做授权检查即接受候选 scope;当前调用方均保证非空,
  属潜在误用面,无测试锁语义。**需 D47 裁决口径(建议 fail-closed)。**
- **R9**(←T29)`apps/web/src/engine/chat-situation.ts` 将
  `clientView.presence` 放入 `explicit` 优先级槽位;clientView 是客户端自报
  信号(与 presence 上报同信任级),与 T29 spec"显式是正典"的字面分层有
  偏差(scope 越权仍被 grantedScopes 收口,无安全暴露)。**需 D47 裁决分层。**
- **R10**(←T29)`api/presence/route.ts` 的 scope 校验仅用
  `grantedPolicyScopes(identity.scopes)`,不像消费方那样追加
  `identity.policyScope`;无暴露面,口径不齐。
- **R11**(←T30)虚主体负向不变量无常驻断言:`/api/entity?rel=workspace:*`
  404、不可 exec、不进 sitemap 目前靠"零特判代码"结构性成立,无 standing
  回归测试——将来误加 workspace 特判不会红。
- **R12**(←T30)`apps/web/src/engine/presentation/runtime-composition.ts` 的
  `regionSlot()` 对不可用区域硬编码 `kind:'entity'`(inbox/threads 实为
  collection);当前无消费方(惰性死值),若未来部分授权组合参与 recipe key
  会产出错误 shape。
- **R13**(←T30)slot name 语法双口径:`promotion.ts` 与 `recipe.ts` 的
  `SLOT_SUBJECT` 允许大写 `[a-zA-Z0-9_.-]+`,宽于声明 region id 语法
  (shared parser);两套正则并存。
- **R14**(←T24)`route.ts` 的 loop_exception 路径永无 LLM phrasing(注释
  自承"error 帧无 LLM 表述路径");T24 spec 失败分层未豁免该失败来源。
  **需 D47 裁决(补齐或记录边界)。**
- **R15**(←T24)客户端保留旧 wire-format 回退双路径:`chat/sse.ts`、
  `thread.tsx` 的 `AssistantText` 无 activity 回退、`use-chat-session.ts` 的
  error 帧 else 与 handleFinal 无 reason 回退,并有专项测试冻结
  (`floating-chat.test.tsx`);GR2 偏离,且中文"前向兼容"措辞绕过
  `check-compat.mjs` 的英文标记扫描、未登记 exceptions.json。处置:删除回退
  (GR2 单实现)+ 迁移冻结测试;顺带评估 check-compat 标记扫描补中文措辞
  (治理加固,可选)。
- **R16**(←T25)`packages/agent/src/llm/prompt-budget.test.ts` 的
  `sitemapFor` 夹具是合成的;未对真实 walkthrough bundle 的 meta scope 切片
  做 wire 级 32 KiB 预算断言——真实切片若超预算,现有测试不红。

### Low(卫生)

- **R17**(←T24/T25,同一项)`apps/web/src/chat/step-activity.ts` 的
  `readSitemapTitles` 是死代码(route 已归并共享读取,该导出只剩自测试
  引用,且测试负向断言 route 不得再用它);文件头注释仍把它描述为对外读端
  API。退役 + 注释修正。
- **R18**(←T25)`packages/agent/src/types.ts` 的 `DriverContext.sitemap`
  文档注释未说明 loop 放入的已是披露切片视图;两处切片点(loop 预切 +
  prompts 再切,幂等但冗余)——注释修正,切片点归并或注释说明幂等设计。
- **R19**(←T26)`packages/engine/src/contract/siren/project.ts` 的
  `project()` JSDoc 解析顺序注释未含 threads/thread: 分支(实际插在 meta 与
  instance 之间)。
- **R20**(←T30)`scripts/governance/size-baseline.json` 两条 note 仍写
  "T30 在途",track 已归档;更新为 shrink-only 自 T30 关闭起算口径。

### 流程项(可追溯性)

- **R21**(←T24)plan.md 声称"git notes 已同步迁移",实际 8 个任务/
  checkpoint sha 上无一条 note(`git notes show` 全部报错)——验收记录不可
  核对。处置:按 plan 任务与既有证据补挂验收 notes。
- **R22**(←T29)plan.md 记录的 8 个任务/checkpoint sha 经 rebase 不在
  master 祖先链;验收 notes 挂在悬空提交上。处置:把 notes 复制/跨链到
  rebase 等价提交,plan.md 加注等价 sha 映射。

### 归后续(登记在册,不在本 Track 修复)

- **R23**(←T24)审计下钻主路径落在裸 JSON API(`thread.tsx` 的
  `stepAuditHref` → `/api/events?afterSeq=N`)→ **归 T28**(raw 模式领土,
  落注 T28 spec/plan)。
- **R24**(←T24)components 基线 4116→4175 与 floating-chat 条目的收缩窗口
  → **归 T27**(目录重组时兑现)。
- **R25**(←T24 前既有)`canvas-errors` 机制标识泄漏主区域、`thread.tsx`
  的 flow 徽章文本启发式(T9 遗留)→ **归 T28**(呈现诚实化延伸领土,
  落注 T28)。
- **R26**(←T26)thread 的 agent-run/draft 状态指针恒 dangling +
  `enrichEntityWithAgentRuns` 对 thread 不生效 → **归 T27**(首页消费线时
  接线,D44 sanction dangling,非缺陷)。
- **R27**(←T27 在途)components 4520 > 4491 现行 governance 红 →
  **归 T27 收尾**(登记或收缩;T31 不动该目录基线)。

## 修复范围与施工纪律

- 范围:R1–R22(归后续 R23–R27 只登记并落注目标 track 文档);
- 与 T27 在途的冲突面:T27 正在改 `site-nav.tsx`、`home.test.tsx`、
  e2e human/dual-executor/s1/smoke、presence site 值域(business→
  workstation)与 components 目录布局。**T31 任务避开这些文件**;涉及
  presence/situation 的测试(R2/R3)不得钉死 site 词表值(T27 改名中);
  执行序建议:T27 闭环后启动最干净,并行亦可但需逐任务核对冲突面;
- 测试缺口类(R1/R2/R3)的验收口径:新测试必须经 mutation 抽查证明
  "破坏被测行为 → 测试变红",不允许纸面补测;
- GR3:触及 `packages/engine/src/presentation`(4603/4000 基线,shrink-only)
  的 R12/R13 必须净不增长;其余目录有余量;例外登记由编排 agent 统一执行;
- GR2:R15 删除回退即单实现,不留双路径;
- 注释/文档修复(R17/R18/R19/R20)与代码行为修复同标准:改完复述现状。

## 验收方向

- 登记册 27 项全部终态(修复 / D47 有意偏离 / 归后续落注);
- R1/R2/R3:新测试 mutation 抽查能红;presence 频率上限入合同测试;
- R15:全仓 grep 无旧 wire-format 回退残留,floating-chat 冻结测试迁移;
- R11:`workspace:*` 负向断言(404/sitemap 缺席/不可 exec)常驻;
- 流程项:`git notes show` 对 T24 八个 sha 全部可读;T29 等价 sha 映射落档;
- 不回归:`pnpm check` 全绿、`CI=true pnpm e2e invariants` 全绿、governance
  零新增基线;`pnpm dev:all` 实际启动走查。
