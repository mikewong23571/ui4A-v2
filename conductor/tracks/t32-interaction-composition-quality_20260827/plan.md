# T32 交互与组合质量修复 — Plan

> 遵循 `conductor/workflow.md` 的任务生命周期、Git notes 与 Phase Checkpoint 协议。
> spec:`./spec.md`(含 14 项发现项登记册 Q1–Q14;锚点全为路径+符号,实施前复核)。
> 每 Task 先 Red 再 Green;每 Phase 结束复跑 `pnpm check` 与
> `CI=true pnpm e2e invariants`。
> 治理纪律:GR3 业务优先不为凑行数拆分;触及 shrink-only 基线目录
> (`packages/engine/src/presentation`)的修复必须净不增长;例外登记由编排 agent
> 统一执行,subagent 只如实报告。
> 冲突面:T31 在途(Q6/Q7 与其 R12 同文件 `runtime-composition.ts`/
> `runtime.ts`)——Phase C 的 T30 侧任务在 T31 闭环后执行,或并行时逐任务核对
> T31 Phase C 进度;Q3/Q4/Q5 与 T31 冲突面无重叠,可先行。
> 前置确认:T28/T30 已归档(修复对象);D45/D47/D48 已落 DECISIONS.md。
> 实施前必读:根 `AGENTS.md`、`apps/web/AGENTS.md`、`conductor/workflow.md`。

## Phase A: 分歧裁决 → DECISIONS(D49) [checkpoint: 129388e]

- [x] Task: 两个判断点落 DECISIONS.md D49 [129388e]
  - Q3:审计下钻 `stepAuditHref` → `/api/events?afterSeq=N` 是否 D47 第 3 问
    既定豁免(事件切片属审计链接)——豁免记录 vs 改为 raw 抽屉镜头;裁决须
    显式核对 D47 原文,不得复辟已否决候选(raw 站点/事件切片混入 raw 抽屉);
  - Q6:单/组合依赖装配形状——单主体依赖统一经 compose 内核产出 vs 注释
    锚定两套 id 方案对应关系;
  - 验收:D49 一条目两小节,各有明确采纳与理由;纯修复项(Q1/Q2/Q4/Q5/
    Q7/Q8/Q9/Q10)确认无需决策,直接进 Phase B/C/D
- [x] Task: spec/plan 回改对齐 D49 [129388e]
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) [129388e]

## Phase B: Medium 测试缺口(Q1/Q2) [checkpoint: 149c7ad]

- [x] Task: Q1 e2e raw exact 断言强化 [bc3f2b7]
  - `e2e/interaction/chat-citations.spec.ts` 的 raw 步骤补 `JSON.parse` 后
    与 `/api/entity` 新鲜授权响应深等断言,并断言不含事件/provenance/
    hydrated facts 键;mutation 抽查:在 drawer 输入前拼装额外字段 → 变红
- [x] Task: Q2 property 套件组合树覆盖 [149c7ad]
  - `apps/web/src/render/property.test.ts` 加声明驱动的多区域组合 fixture
    (或生成器):组合树 binding 零字面量 + deref 与实体快照一致(I2 口径);
    mutation 抽查:注入字面量值 → 变红
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) [149c7ad]

## Phase C: Low 行为修复(D49 已决项 + 纯修复项) [checkpoint: 053359d]

- [x] Task: chat 呈现组(Q3/Q4/Q5;与 T31 无文件冲突,可先行)
  - Q3 按 D49 落地(豁免记录或 raw 镜头化);Q4 删除 `thread.tsx` 徽章文本
    启发式,改结构化 rel 判定并配测试(GR2 单实现);Q5 canvas load 失败
    分支映射固定人话、机制细节进 why 抽屉,补异常分支测试 [41d2a9d/8d9f1aa]
- [x] Task: T30 组(Q6/Q7;T31 闭环后或与其 Phase C 进度核对后执行) [053359d]
  - Q6 按 D49 落地;Q7 `membershipFingerprint` 非空断言改显式守卫,错误点名
    区域与原因,配负向测试
  - GR3 注意:若触及 `packages/engine/src/presentation` 须净不增长
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) [053359d]

## Phase D: 卫生(Q8/Q9/Q10) [checkpoint: ef9392a]

- [x] Task: 卫生组 [ef9392a]
  - Q8 `hrefToRel` 提取共享模块;Q9 `entity-view.tsx` 头注释复述现状;
    Q10 `broker.ts`/`runtime.ts` 过期里程碑注释改写
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) [ef9392a]

## Phase E: 归后续落注 + 验收收尾

- [ ] Task: 归后续落注(Q11/Q12/Q13/Q14)
  - Q11/Q12 登记为候选方向(落注本 spec 即登记,不指定未存在的 track);
    Q13 落注 T31 plan Phase C 任务一行(若 T31 已收尾,落注本 Track notes);
    Q14 在 T31 收尾核销时指向本登记册
- [ ] Task: 全量验收
  - `pnpm check` 全绿(含 governance 零新增基线);`CI=true pnpm e2e
    invariants` 全绿;T16 presentation/T28 interaction(chat-citations)/
    T30 composition 套件全绿;`pnpm dev:all` 实际启动走查
- [ ] Task: Track 收尾
  - `conductor/tracks.md` 状态流转;metadata.json 归档;track 目录按 GR5
    处置(无 bespoke 残留);登记册全部 14 项终态核对

## 验收标准(Track DoD)

1. 登记册 Q1–Q14 全部终态:Q1–Q10 修复或经 D49 记录有意偏离,Q11–Q14 归
   后续落注;
2. Q1/Q2 测试缺口补齐且 mutation 抽查证明能红;组合面进入 I2 常驻覆盖;
3. D49 两个判断点落 DECISIONS.md,实现与之一致;
4. Q4 零文本启发式残留;Q5 主区域零机制标识泄漏;
5. GR2/GD3 纪律:无新旧双路径;`pnpm check` + `CI=true pnpm e2e invariants`
   全绿,系统实际可运行。
