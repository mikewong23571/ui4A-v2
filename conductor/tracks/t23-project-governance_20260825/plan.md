# T23 项目治理 — Plan

> 遵循 `conductor/workflow.md` 的 Story TDD、任务提交、Git notes 和 Phase Checkpoint 协议。
> 本 Track 的"TDD"对象是治理检查本身:先 Red(检查对存量失败并固化 baseline),再
> Green(修复存量至通过),最后 Gate(并入 `pnpm check`)。所有存量修复保持行为不变,
> 每 Phase 结束复跑 `pnpm check` 与 `CI=true pnpm e2e invariants`。

## Phase A: 规则落盘与 Red 基线

- [ ] Task: 建立治理检查骨架与例外登记
  - 创建 `scripts/governance/`:`check-deps.mjs`、`check-compat.mjs`、`check-size.mjs`、
    `exceptions.json`、`size-baseline.json`,纯 Node 无新依赖
  - `exceptions.json` 预置唯一依赖例外:worker 复用 web `src/db` adapter,注明
    原因与退役条件(存储边界收敛为独立包或共享 db 包时移除)
  - 三个检查输出违规清单;此时全部允许失败
- [ ] Task: Red——固化三项基线
  - 运行 check-deps:记录当前依赖方向违规清单(预期很少)入 baseline 语境输出
  - 运行 check-compat:枚举 GR2 存量兼容路径清单
  - 运行 check-size:生成全部超限文件清单写入 `size-baseline.json`(当前约 30+
    个非测试文件 >500 有效行)
  - 提交 baseline;此刻起 baseline 只许缩短
- [ ] Task: 质量风险盘点核对
  - 用检查输出 + `git grep` 复核 spec.md 的三类债务清单,补齐遗漏(如 scripts
    考古层具体文件、6 个 playwright 配置的合并方案)
  - 产出 `risk-inventory.md`(track 内文档),作为 Phase B–D 的修复索引
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase B: 兼容性清理(GR2,Green)

- [ ] Task: 移除 T18 wire 兼容层
  - 删除 `apps/worker/src/capabilities/coding/compatibility.ts` 及其测试/fixture
  - 删除 `packages/engine/src/agent-run/legacy-capability-run.ts` 及引用
  - 清理 web/worker 中 legacy dispatch 分支,保留 canonical Agent Run 唯一路径
- [ ] Task: 清理其余兼容 shim
  - 审查 `apps/web/src/db/migrations.ts` 等兼容 shim,由 T22 显式迁移合同取代者删除
  - check-compat 转绿(仅剩白名单注释语境)
  - 复跑受影响包全部测试 + invariants
- [ ] Task: Phase Verification & Checkpoint

## Phase C: 依赖方向收口(GR1,Green)

- [ ] Task: 修复 check-deps 报告的存量违规(若有)
- [ ] Task: 无法即时修复者登记入 exceptions.json(须含退役条件),其余清零
- [ ] Task: Phase Verification & Checkpoint

## Phase D: 大小治理(GR3,Green)

- [ ] Task: 按 spec FR4 优先级从大到小拆分超限生产源码文件,每次拆分后复跑该模块测试
- [ ] Task: 拆分超限测试文件(>800 有效行)按场景分组
- [ ] Task: 裁决 `scripts/` 考古层(GR5):常驻化或归档;合并 playwright 配置
- [ ] Task: `size-baseline.json` 清空,check-size 全绿
- [ ] Task: Phase Verification & Checkpoint

## Phase E: 门禁化与规则迁移(Gate)

- [ ] Task: 根 `package.json` 增加 `governance` script 并并入 `check`
- [ ] Task: GR1–GR5 迁入 `AGENTS.md`(Architectural Invariants / Conventions 节),
  `conductor/workflow.md` 验收协议增加治理门禁一步
- [ ] Task: 终验——全新 clone 视角跑 `pnpm install && pnpm check` 与 invariants 全绿;
  Track 收口,更新 `conductor/tracks.md` 状态
