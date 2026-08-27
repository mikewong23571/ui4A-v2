# T31 质量评审修复 — Plan

> 遵循 `conductor/workflow.md` 的任务生命周期、Git notes 与 Phase Checkpoint 协议。
> spec:`./spec.md`(含 27 项发现项登记册 R1–R27;锚点全为路径+符号,实施前复核)。
> 每 Task 先 Red 再 Green;每 Phase 结束复跑 `pnpm check` 与
> `CI=true pnpm e2e invariants`。
> 治理纪律:GR3 业务优先不为凑行数拆分;触及 shrink-only 基线目录
> (`packages/engine/src/presentation`)的修复必须净不增长;例外登记由编排 agent
> 统一执行,subagent 只如实报告。
> 冲突面:T27 在途(site-nav/home/e2e 首页锚点/presence site 值域/components
> 布局)——本 Track 任务避开这些文件;presence/situation 测试不钉死 site 词表值。
> 前置确认:T24/T25/T26/T29/T30 均已闭环(修复对象);建议 T27 闭环后启动,
> 并行则逐任务核对冲突面。
> 实施前必读:根 `AGENTS.md`、`apps/web/AGENTS.md`、`conductor/workflow.md`。

## Phase A: 分歧裁决 → DECISIONS(D48) [checkpoint: 5951549]

- [x] Task: 四个判断点落 DECISIONS.md D48 [90743fb]
  - R4:`thread-id-available` 层序归位(前移 guard 层 vs 重归类并修正自述;
    不得破坏 declaration → guard → schema 不变量口径);
  - R8:`scopeFrom` 空 grantedScopes 口径(建议 fail-closed);
  - R9:clientView.presence 的优先级分层(降 presence 同级 vs 记录显式槽位
    的有意如此及理由);
  - R14:loop_exception/error 帧是否纳入 LLM phrasing(补齐 vs 记录 spec
    边界)
  - 验收:D48 一条目四小节,各有明确采纳与理由;纯修复项(R5/R6/R7/R10/
    R11/R12/R13/R15/R16/R17–R20)确认无需决策,直接进 Phase C/D
- [x] Task: spec/plan 回改对齐 D48 [5951549]
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase B: Medium 测试缺口(R1/R2/R3) [checkpoint: 9a11d6a]

- [x] Task: R1 route 级 activity/eventSeq 接线行为测试 [7a4a3e6]
  - 在 route 级测试断言真实 SSE step 帧的 activity/eventSeq 投影(不依赖
    合成 SSE);mutation 抽查:破坏 sitemap 标题接线 → 测试变红
- [x] Task: R2 presence 频率上限合同测试 [bc8d881]
  - 窗口计数达上限 → 429/结构化拒绝;窗口滑动后恢复;有界口径与
    `PRESENCE_MAX_EVENTS_PER_WINDOW` 对拍;mutation 抽查:移除上限 → 变红
- [x] Task: R3 消费方矩阵行为化 [9a11d6a]
  - presence fixture 驱动 chat 路由(site/scope)与 entity 路由(scope 缺省)
    的行为测试;"改一处 presence → 两处行为同变"以行为断言兑现;
    源码文本断言退役或降为辅助;不钉死 site 词表值(T27 改名中)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: Low 行为修复(D48 已决项 + 纯修复项)

- [x] Task: T29 口径组(R8/R9/R10) [fecc9c5]
  - 按 D48 落 scopeFrom 口径、clientView 分层、presence 端点 scope 校验对齐;
    各项配行为测试
- [ ] Task: T26 投影/裁决组(R4/R5/R6/R7)
  - R4 层序按 D48 归位;R5 context 类 dangling 标记统一(message: 引用可
    审计);R6 attach 失败加结构化可观测(chat 不阻断语义不变);R7
    class 硬编码改声明式 scope/memberRelPrefix 推导
  - Red→Green:各项先补锁合同语义的测试再修
- [ ] Task: T30 组合组(R11/R12/R13)
  - R11 常驻负向断言(`/api/entity?rel=workspace:*` 404、sitemap 缺席、
    不可 exec);R12 `regionSlot()` kind 按声明源合同形状推导;R13 slot
    name 语法统一为 shared region id 语法
  - GR3 注意:R12/R13 触及 shrink-only 基线目录,净不增长
- [ ] Task: chat/LLM 组(R14/R15/R16)
  - R14 按 D48 落地;R15 删除客户端旧 wire-format 回退(GR2 单实现),
    迁移 `floating-chat.test.tsx` 冻结测试,评估 check-compat 中文标记;
    R16 补真实 walkthrough bundle 的 meta scope wire 级 32 KiB 预算断言
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: 卫生与流程可追溯性(R17–R22)

- [ ] Task: 卫生组(R17/R18/R19/R20)
  - `readSitemapTitles` 死代码退役 + 头注释修正;`DriverContext.sitemap`
    注释修正与切片点说明;`project()` JSDoc 补 threads 分支;
    size-baseline 两条 note 更新为自 T30 关闭起算
- [ ] Task: 流程组(R21/R22)
  - R21:按 T24 plan 任务与既有证据补挂 8 个 sha 的验收 git notes;
  - R22:把 T29 验收 notes 复制到 rebase 等价提交(等价 sha 已考:
    bd083d5/a3cb212/c612ad1+d7c83ad/6d40417/4f7953f/34d29f6/768263b,
    实施时以 `git log` 复核),T29 plan.md 加注等价映射
  - 验收:`git notes show` 对 T24/T29 全部任务 sha 可读
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase E: 归后续落注 + 验收收尾

- [ ] Task: 归后续落注(R23–R27)
  - R23/R25 落注 T28 spec/plan(raw 模式与呈现领土);R24/R26/R27 落注
    T27 spec/plan(收缩窗口与线消费接线);落注为各文档"承接自 T31
    评审"小节一行,不改目标 track 范围
- [ ] Task: 全量验收
  - `pnpm check` 全绿(含 governance 零新增基线);`CI=true pnpm e2e
    invariants` 全绿;T16/T24/chat 套件全绿;`pnpm dev:all` 实际启动走查
- [ ] Task: Track 收尾
  - `conductor/tracks.md` 状态流转;metadata.json 归档;track 目录按 GR5
    处置(无 bespoke 残留);登记册全部 27 项终态核对

## 验收标准(Track DoD)

1. 登记册 R1–R27 全部终态:R1–R20 修复或经 D48 记录有意偏离,R21/R22 可追溯
   性恢复,R23–R27 在目标 track 文档落注;
2. R1/R2/R3 测试缺口补齐且 mutation 抽查证明能红;
3. D48 四个判断点落 DECISIONS.md,实现与之一致;
4. GR2:R15 回退双路径清除零残留;governance 全绿、零新增基线;
5. `pnpm check` + `CI=true pnpm e2e invariants` 全绿;系统实际可运行。
