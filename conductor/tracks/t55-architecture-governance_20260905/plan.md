# T55 架构治理落地(plan)

- 依据:本 track `spec.md`(FR1–FR5,AC-0–AC-6)与 `conductor/workflow.md`(TDD Red→Green→Gate、Phase Checkpoint、编排 agent 代行验收)。
- 顺序原则:决策先行(Phase 0)→ 门禁(1)→ 文档(2)→ chat 重构(3)→ service 重构(4)→ 卫生与收口(5)。Phase 1/2 可与 Phase 0 并行准备,但 checkpoint 按序。
- 每 Task 的测试先行:治理类改动先在对应 `scripts/governance/*.test.mjs`/`.test.ts` 写失败用例;重构类改动先固化特征化基线再动实现。

## Phase 0 开工核查与决策先行

- [ ] Task: 开工前事实复核(spec §7 AC-0)
  - [ ] 复验 type 环:`service-confirmation.ts:29`/`service-thread.ts:12` 仍 `import type { ExecOutcome } from './service'`;
  - [ ] 复验 `route.ts` POST 起始行(≈136)与体量(≈415 行)、9 个既有测试文件清单;
  - [ ] 复验贴限目录测试占比(definition≈72%、app/api/chat≈77%)与 D52 原文(DECISIONS.md:885-905);
  - [ ] 结论写入 notes:断言全部成立 / 失配项与 spec 修订。
- [ ] Task: D75 chat 编排重构裁定入 DECISIONS.md
  - [ ] 四段边界(鉴权身份/请求体/会话编排/SSE)、模块落位(`src/chat` vs `app/api/chat` 邻域)、测试迁移策略(新增并存,既有 9 文件断言零删除);
  - [ ] 明确 D52 基线条目 `route.ts` 在重构完成后从 shrink-only 语义自然清空(基线本为空则记录确认)。
- [ ] Task: D76 service hub 降权裁定入 DECISIONS.md
  - [ ] `ExecOutcome`/`PlanServiceOutcome` 叶子模块落点;`exec()` 六类编排段归位表;单原子队列保持声明(不移动原子点);
  - [ ] 明确 `EngineRuntime` 接口本 track 不强拆(扇入 8,低收益),仅解环 + 闭包分解。
- [ ] Task: D77 t22 位置 D52 修订案裁定入 DECISIONS.md(迁移 or 保留,二选一并写明理由)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md;AC-0 证据:DECISIONS diff + 复核 notes)

## Phase 1 治理盲区修补(FR1 → AC-1)

- [ ] Task: GR2 中文词形(Red)
  - [ ] 在 check-compat 的测试中新增用例:含「兼容深路径入口」「向后兼容」「旧路径」的临时夹具必须被检出(先失败)。
- [ ] Task: GR2 中文词形(Green)
  - [ ] 扩展 `MARKER_RE`(至少 `兼容|向后兼容|旧路径|遗留`);确认治理目录排除规则不误伤;
  - [ ] 跑只读扫描清单评估存量;逐条改写措辞或 allowlist 登记(reason + pendingRemoval);
  - [ ] `pnpm governance` 全绿。
- [ ] Task: 读依赖显式登记(Red→Green)
  - [ ] 为 exceptions.json 新登记段写失败测试(三处 FR1.2 点名项必须被要求登记);
  - [ ] 补齐三处登记(reason + retireWhen);`pnpm governance` 全绿。
- [ ] Task: check-size 测试/非测试分列(Red→Green)
  - [ ] 失败用例:目录报告必须分列;
  - [ ] 实现 `effectiveLineCount` 聚合分列并在 `pnpm governance` 输出可见;抽查 `engine/src/definition` 非测试≈1,134。
- [ ] Task: Phase Verification & Checkpoint(AC-1 三元证据:`pnpm governance` 输出 + 测试命令 + commit)

## Phase 2 文档真源对齐(FR2 → AC-2)

- [ ] Task: AGENTS.md 系统图补 `apps/agent-runner`(引 D34/D36;修正「三个可部署应用」;部署链路一句带过 DEPLOYMENT.local.md/release manifest)
- [ ] Task: arch-brief §8.1 修正 `apps/web/src/db/presentation` 等已迁移路径(指向 `packages/db`)
- [ ] Task: 全库叙述一致性 grep(`agent-runner` 命中、`apps/web/src/db` 在 conductor/refs 零残留;GOAL.md 若计数应用则同步)
- [ ] Task: Phase Verification & Checkpoint(AC-2 证据:grep 输出 + commit)

## Phase 3 chat POST 编排重构(FR3 → AC-3;D75 边界)

- [ ] Task: 特征化基线固化
  - [ ] 记录 9 个既有测试文件与通过状态(`git status` 干净时跑全量 chat route 测试留输出摘要)。
- [ ] Task: 四段模块(Red)
  - [ ] 为鉴权身份/请求体/会话编排/SSE 四段新模块各写失败测试(行为对齐既有语义,不含新功能)。
- [ ] Task: 四段提取(Green)
  - [ ] POST 内对应段落替换为模块调用;`route.ts` 收缩为编排壳;
  - [ ] 既有 9 文件断言零删除、全绿;`pnpm check` 绿。
- [ ] Task: E2E 验证(`CI=true pnpm e2e` chat 相关 spec 全绿;notes 点名 spec)
- [ ] Task: Phase Verification & Checkpoint(AC-3 证据:行数度量 + 测试输出 + e2e 摘要 + commit;route.ts 有效行 ≤200)

## Phase 4 service hub 降权(FR4 → AC-4;D76 边界)

- [ ] Task: ExecOutcome 下沉解环(Red→Green)
  - [ ] 失败判据先行:环检测命令(`npx --yes madge --extensions ts --circular apps/web/src/engine`)当前输出含 service 环,记录之;
  - [ ] `ExecOutcome`/`PlanServiceOutcome` 移至叶子模块,双向 import 改指叶;环检测复跑为零环。
- [ ] Task: exec() 闭包分解(Red)
  - [ ] 为六类编排段(confirmation/thread/meta/coding-result/spawn/T52 refold)在目标域模块写失败测试(语义取自现闭包行为)。
- [ ] Task: exec() 闭包分解(Green)
  - [ ] 逐段归位(优先既有 `service-*` 模块,新模块按 D76 归位表);`service.ts` 只留装配+入口;
  - [ ] `service-tests` 断言零删除全绿;单原子队列并发用例点名列出留痕。
- [ ] Task: 度量与门禁(`service.ts` 有效行 ≤350;`pnpm check` 绿;六类分支不在闭包内的 diff 佐证)
- [ ] Task: Phase Verification & Checkpoint(AC-4 证据:零环输出 + 行数 + 测试摘要 + commit)

## Phase 5 卫生收尾与收口(FR5 → AC-5/AC-6)

- [ ] Task: [可选,依 D77] t22 探针迁移至 `scripts/t22/`
  - [ ] 更新 `t22-temporal-probe.ts#workflowsPath` 与 `t22-probes-source.test.ts` 断言;`scripts/t22` 套件全绿;D77 状态回写 DECISIONS。
- [ ] Task: `.next*` 构建根收敛
  - [ ] 统一 e2e/probe 构建根或落地回收脚本;演示回收并留命令;磁盘 `.next*` 根数 ≤2。
- [ ] Task: arch-review 文档状态更新与复测报告
  - [ ] `arch-review-2026-09-05.md` 各处置项标注落地 commit;
  - [ ] 重跑度量口径(churn 前二、贴限清单、GR 计数)与 v2 基线对比入 notes。
- [ ] Task: GR5 处置与全量门禁
  - [ ] 本 track bespoke 脚本/配置晋升或删除;
  - [ ] `pnpm check`(strict 空基线)+ `CI=true pnpm e2e` + `CI=true pnpm e2e invariants` 全绿。
- [ ] Task: 归档与 registry 打勾(notes 汇总 AC-0–AC-6 三元证据;移入 `tracks/archive/`)

## 里程碑与验收映射

| Phase | 出口 AC | 主要证据 |
| --- | --- | --- |
| 0 | AC-0 | DECISIONS D75/D76/D77 + 复核 notes |
| 1 | AC-1 | `pnpm governance` 输出(中文检出/登记/分列) |
| 2 | AC-2 | grep 证据 |
| 3 | AC-3 | route.ts ≤200 行 + 9 测试全绿 + e2e |
| 4 | AC-4 | 零环 + service.ts ≤350 行 + service-tests 全绿 |
| 5 | AC-5/AC-6 | 回收演示 + 复测报告 + 全量门禁 + 归档 |
