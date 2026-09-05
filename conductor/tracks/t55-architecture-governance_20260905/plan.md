# T55 架构治理落地(plan)

- 依据:本 track `spec.md`(FR1–FR5,AC-0–AC-6)与 `conductor/workflow.md`(TDD Red→Green→Gate、Phase Checkpoint、编排 agent 代行验收)。
- 顺序原则:决策先行(Phase 0)→ 门禁(1)→ 文档(2)→ chat 重构(3)→ service 重构(4)→ 卫生与收口(5)。Phase 1/2 可与 Phase 0 并行准备,但 checkpoint 按序。
- 每 Task 的测试先行:治理类改动先在对应 `scripts/governance/*.test.mjs`/`.test.ts` 写失败用例;重构类改动先固化特征化基线再动实现。

## Phase 0 开工核查与决策先行 [checkpoint: 9edbdd9]

- [x] Task: 开工前事实复核(spec §7 AC-0)9edbdd9
  - [x] 复验 type 环:`service-confirmation.ts:29`/`service-thread.ts:12` 仍 `import type { ExecOutcome } from './service'`(成立);
  - [x] 复验 `route.ts` POST 起始行(实测 136)与体量(实测 raw 550/POST ≈414/有效 440)、9 个既有测试文件清单(全在位);
  - [x] 复验贴限目录测试占比(definition 实测 65% vs spec ≈72%,chat 实测 76% vs ≈77%;方向性结论不变,漂移记 notes)与 D52 原文(DECISIONS.md ≈885-905,在位);
  - [x] 结论写入 notes:核心断言全部成立;行号/占比漂移为同期演进,不改 spec。
- [x] Task: D75 chat 编排重构裁定入 DECISIONS.md 9edbdd9
  - [x] 四段边界(鉴权身份/请求体/会话编排/SSE)、模块落位(`src/chat` 邻接,route 壳化)、测试迁移策略(新增并存,既有 9 文件断言零删除);
  - [x] 明确 D52 基线条目 `route.ts`:size-baseline 本为空,重构完成后收缩窗口语句自然兑现,无需基线操作。
- [x] Task: D76 service hub 降权裁定入 DECISIONS.md 9edbdd9
  - [x] `ExecOutcome`/`PlanServiceOutcome` 下沉新叶子 `service-outcome.ts`;exec() 六段归位表(挂起物化→service-confirmation/coding-result→新模块/spawn→新模块/T52 refold→service-event-log/路由+回执→新编排入口 service-exec.ts);单原子队列保持声明(不移动原子点);
  - [x] 明确 `EngineRuntime` 接口本 track 不强拆(非测试扇入实测 17,高扇入低收益),仅解环 + 闭包分解。
- [x] Task: D77 t22 位置 D52 修订案裁定入 DECISIONS.md 9edbdd9(批准迁移:对象为 `apps/worker/src/t22-temporal-probe-workflows.ts` 8 行工作流文件 → `scripts/t22/` 同址唯一消费者;同步 workflowsPath 与 t22-probes-source.test.ts 断言)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md;AC-0 证据:DECISIONS diff + 复核 notes;验证:pnpm governance 全绿 + 事实复核命令留痕 git notes @9edbdd9)

## Phase 1 治理盲区修补(FR1 → AC-1)

- [ ] Task: GR2 中文词形(Red)
  - [ ] 新建 `scripts/governance/check-compat.test.mjs`:含「兼容深路径入口」「向后兼容」「旧路径」的临时夹具必须被检出(先失败)。
- [ ] Task: GR2 中文词形(Green)
  - [ ] 扩展 `MARKER_RE`(至少 `兼容|向后兼容|旧路径|遗留`);确认治理目录排除规则不误伤;
  - [ ] 跑只读扫描清单评估存量;逐条改写措辞或 allowlist 登记(reason + pendingRemoval);
  - [ ] `pnpm governance` 全绿;`pnpm vitest run scripts/governance/check-compat.test.mjs` 通过。
- [ ] Task: 相对 import 逃逸检测(FR1.2a,Red→Green)
  - [ ] 失败用例:`scripts/t22/t22-temporal-probe.ts` 的 `../../apps/worker/node_modules/...` 伸手必须被 `check-deps` 检出;
  - [ ] 实现「相对 import 逃逸工作区根」检测;登记或改写该处(优先改为声明依赖或搬移);`pnpm governance` 全绿。
- [ ] Task: fs 读依赖披露登记(FR1.2b)
  - [ ] `exceptions.json` 新增披露段(不执法):t21 readFileSync×4、t16 e2e/kits 依赖,各带 reason + retireWhen;
  - [ ] 登记存在性测试(披露段可被读取且不使 governance 失败)。
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
- [ ] Task: E2E 验证(`CI=true pnpm e2e chat.spec.ts` 全绿;notes 留输出摘要)
- [ ] Task: 度量与门禁(AC-3:`route.ts` 有效行 ≤200 **且 POST handler 体 ≤150**;`pnpm check` 绿;四段各有独立测试文件)
- [ ] Task: Phase Verification & Checkpoint(AC-3 证据:两项行数度量 + 测试输出 + e2e 摘要 + commit)

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
  - [ ] 重跑度量口径(churn 前二、贴限清单、GR 计数)与 v2 基线对比入 notes;**复测命令清单固化于 notes**(若形成常驻脚本,按 GR5 晋升或删除)。
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
| 3 | AC-3 | route.ts ≤200 行 + POST ≤150 + 9 测试全绿 + e2e chat.spec |
| 4 | AC-4 | 零环 + service.ts ≤350 行 + service-tests 全绿 |
| 5 | AC-5/AC-6 | 回收演示 + 复测报告 + 全量门禁 + 归档 |

## Phase R 规划期审查修订(2026-09-05)

- [x] Task: Apply review suggestions 8aa32d8b(Principal review:1H/2M/3L,均针对验收方案自身)
  - spec:AC-1.1 验证命令改为新建 `check-compat.test.mjs` + 可执行 vitest 命令(H);FR1.2 拆为执法(a:相对 import 逃逸检测)+ 披露(b:fs 读依赖登记)并同步 AC-1.2(M);AC-3 e2e 点名 `chat.spec.ts`、AC-6 复测命令清单固化、§4 移交时 DoD 改写规则(L);
  - plan:Phase 3 补 POST ≤150 度量任务与里程碑列(M)、Phase 1 任务与 FR1.2a/b 对齐、Phase 5 命令清单措辞。
