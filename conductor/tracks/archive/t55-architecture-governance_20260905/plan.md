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

## Phase 1 治理盲区修补(FR1 → AC-1)[checkpoint: 1f69a8d]

- [x] Task: GR2 中文词形(Red)5e6a0d20
  - [x] 新建 `scripts/governance/check-compat.test.mjs`:含「兼容深路径入口」「向后兼容」「旧路径」「遗留」的注入夹具被检出(先行失败 6 用例)。
- [x] Task: GR2 中文词形(Green)5e6a0d20
  - [x] 扩展 `MARKER_RE`(`兼容|向后兼容|旧路径|遗留` + 英文词形);checkCompat 注入 API;治理目录排除规则未误伤;
  - [x] 只读扫描 33 文件:27 文件措辞等义改写、6 术语文件 allowlist 登记(reason + pendingRemoval: false);
  - [x] `pnpm governance` 全绿;`pnpm vitest run scripts/governance/` 15 用例通过。
- [x] Task: 相对 import 逃逸检测(FR1.2a,Red→Green)316f186f
  - [x] 失败用例:`scripts/t22/t22-temporal-probe.ts` 的 `../../apps/worker/node_modules/...` 伸手被 `check-deps` 检出(另有逃逸根/误报防护/方向回归 3 用例);
  - [x] 实现 relativeEscapeReason(node_modules 段/逃出仓库根);全库实扫仅该 2 行,改写为声明依赖(root devDeps `@temporalio/client+worker` 1.22.0 + 标准说明符);`pnpm governance` 全绿。
- [x] Task: fs 读依赖披露登记(FR1.2b)dae74a92
  - [x] `exceptions.json` 新增披露段 `fsReadDisclosures`(不执法):t21 readFileSync×4(逐文件明细)、t16 e2e/kits 依赖,各带 reason + retireWhen;
  - [x] 登记存在性测试(check-deps.test.mjs:披露可读 + governance 不失败)。
- [x] Task: check-size 测试/非测试分列(Red→Green)1f69a8dc
  - [x] 失败用例:目录报告必须分列(聚合纯函数 + 仓库锚点);
  - [x] 实现 `aggregateDirStats`/`nearLimitDirs`,`pnpm governance` 输出可见;抽查 `engine/src/definition` 非测试 = 1,134(精确)。
- [x] Task: Phase Verification & Checkpoint(AC-1 三元证据:git notes @1f69a8d;`CI=true pnpm check` 546 文件/4112 测试全绿)

## Phase 2 文档真源对齐(FR2 → AC-2)[checkpoint: e3bd20]

- [x] Task: AGENTS.md 系统图补 `apps/agent-runner`(引 D34/D36;「三个可部署应用」→「四个」;部署链路一句带过 Dockerfile → release manifest(deploy/oci/image-contract.json)→ DEPLOYMENT.local.md;标注 experimental 与非合同参与方)e3bd2031
- [x] Task: arch-brief §8.1 修正已迁移路径(`apps/web/src/db/presentation` → `packages/db/src/presentation.ts`)e3bd2031
- [x] Task: 全库叙述一致性 grep(`agent-runner` 在 AGENTS.md 3 处命中;`apps/web/src/db` 在 conductor/refs/GOAL/AGENTS 零命中;GOAL.md 无计数表述无需同步)e3bd2031
- [x] Task: Phase Verification & Checkpoint(AC-2 证据:grep 输出留痕 git notes @e3bd20;commit e3bd2031)

## Phase 3 chat POST 编排重构(FR3 → AC-3;D75 边界)[checkpoint: 269fe4c]

- [x] Task: 特征化基线固化
  - [x] 记录 9 个既有测试文件与通过状态(git status 干净;11 文件/81 测试全绿,留痕 notes)。
- [x] Task: 四段模块(Red)
  - [x] post-identity/turn-context/turn-response 三新模块(请求体段复用既有 request-body)各写失败测试;提取前 3 文件 18 用例全部失败(行为对齐既有语义,不含新功能)。
- [x] Task: 四段提取(Green)
  - [x] POST 内对应段落替换为模块调用;`route.ts` 收缩为编排壳(有效行 47);
  - [x] 既有 9 文件断言零删除、全绿(route.render/t21 源码锚点按 wiring 归属迁移,只增不删);`pnpm check` 绿(549 文件/4132 测试)。
- [x] Task: E2E 验证(`CI=true pnpm e2e chat.spec.ts` 7 passed;notes 留输出摘要)
- [x] Task: 度量与门禁(AC-3:route.ts 有效行 47 ≤200 **且 POST handler 体 41 ≤150**;`pnpm check` 绿;四段各有独立测试文件)
- [x] Task: Phase Verification & Checkpoint(AC-3 证据:两项行数度量 + 测试输出 + e2e 摘要 + commit 269fe4c8;git notes @269fe4c)

## Phase 4 service hub 降权(FR4 → AC-4;D76 边界)[checkpoint: 8fd9ddf]

- [x] Task: ExecOutcome 下沉解环(Red→Green)8fd9ddf
  - [x] Red 基线:madge 环检测输出 8 环(7 个 service 相关),留痕 notes;
  - [x] `ExecOutcome`/`PlanServiceOutcome`/`EngineRuntime`(类型,形状不变)迁至叶子 `service-outcome.ts`,service-confirmation/service-thread/drafts 族/agent-definition-authoring 改指叶子,service.ts 保留 re-export;复跑:service 相关环清零(剩 1 个非 service 既有环,presentation/broker)。
- [x] Task: exec() 闭包分解(Red)8fd9ddf
  - [x] 六段域模块失败测试 15 用例(service-exec/service-confirmation/service-coding-result/service-spawn/service-event-log;语义取自现闭包行为)。
- [x] Task: exec() 闭包分解(Green)8fd9ddf
  - [x] 逐段归位:路由+回执→`service-exec.ts` 编排入口(execCore/execPlanCore);挂起物化→`service-confirmation.ts`;coding-result→新 `service-coding-result.ts`;spawn→新 `service-spawn.ts`;T52 refold→`service-event-log.ts`;`service.ts` 只留装配+入口(有效行 211);
  - [x] `service-tests` 断言零删除全绿(113 passed);单原子队列并发用例点名:service.test.ts:269「串行化:exec 单 atom(裁决器即并发控制)」。
- [x] Task: 度量与门禁(service.ts 211 ≤350;`pnpm check` 554 文件/4147 测试绿;六段不在 service.ts 的 diff 佐证 git show 8fd9ddfa)
- [x] Task: Phase Verification & Checkpoint(AC-4 证据:零环输出 + 211 行数 + 测试摘要 + commit 8fd9ddfa;git notes @8fd9ddf)
- [x] 实施期附记:chat 编排模块迁 `src/chat/post/` 子域(GR3 拆解,依 D53;D75 修订条款落盘 DECISIONS.md)8fd9ddf

## Phase 5 卫生收尾与收口(FR5 → AC-5/AC-6)[checkpoint: 7457088]

- [x] Task: [依 D77] t22 探针工作流迁移至 `scripts/t22/`(8 行文件与唯一消费者同址;workflowsPath 与 t22-probes-source.test.ts 断言同步;scripts/t22 套件 338 测试全绿;D52 修订范围仅此一文件)85ba2470
- [x] Task: `.next*` 构建根收敛(盘点 5 根;3 个无引用残留;常驻脚本 `pnpm next:recover-roots`(白名单 .next/.next-e2e);演示回收:根数 5→2,释放约 1.2GB)85ba2470
- [x] Task: arch-review 文档状态更新与复测报告(「落地状态」表各处置项→commit @142bc997;复测:churn route.ts 60/service.ts 54,贴限 10 目录分列,GR1 0/GR2 13/GR3 0/披露 2,环 8→1;复测命令清单固化于 notes)
- [x] Task: 实施期 GR3 拆解(chat/post 与 engine/exec 子域;D75/D76 修订落盘)8fd9ddfa+7457088e
- [x] Task: GR5 处置与全量门禁(治理测试/回收脚本/披露段全部常驻晋升,无遗留 bespoke;`pnpm check` 554 文件/4147 测试绿 + `CI=true pnpm e2e` 79 passed + `CI=true pnpm e2e invariants` 20 passed)7457088e
- [x] Task: 归档与 registry 打勾(notes 汇总 AC-0–AC-6 三元证据;移入 `tracks/archive/`)

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
