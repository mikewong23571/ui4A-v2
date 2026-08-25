# T23 项目治理 — Plan

> 遵循 `conductor/workflow.md` 的 Story TDD、任务提交、Git notes 和 Phase Checkpoint 协议。
> 本 Track 的"TDD"对象是治理检查本身:先 Red(检查对存量失败并固化 baseline),再
> Green(修复存量至通过),最后 Gate(并入 `pnpm check`)。所有存量修复保持行为不变,
> 每 Phase 结束复跑 `pnpm check` 与 `CI=true pnpm e2e invariants`。

## Phase A: 规则落盘与 Red 基线

- [x] Task: 建立治理检查骨架与例外登记 4ad07b9
  - 创建 `scripts/governance/`:`check-deps.mjs`、`check-compat.mjs`、`check-size.mjs`、
    `exceptions.json`、`size-baseline.json`,纯 Node 无新依赖
  - `exceptions.json` 实测登记四条例外:worker→web `src/db` 存储复用、worker→web
    `src/engine` 与 web→worker 测试期耦合、engine 测试读取 web bundle fixture,
    均含原因与退役条件
  - 三个检查输出违规清单;check-compat 对 3 个 GR2 禁用路径保持 Red,check-size
    默认模式吸收基线、strict 模式要求基线为空
- [x] Task: Red——固化三项基线 4ad07b9
  - check-deps:36 处未登记违规全部归因并登记为 4 条例外,方向检查转绿
  - check-compat:66 个文件含 legacy/compat 标记,全部录入 compatAllowlist
    (pendingRemoval: true);3 个禁用路径(`compatibility.ts` 及其测试、
    `legacy-capability-run.ts`)保持 Red 待 Phase B 删除
  - check-size:`--write-baseline` 固化 33 个超限文件 + 12 个超限目录
  - 基线已提交;此刻起只许缩短(check 对新增违规、基线增长、stale 条目均失败)
- [x] Task: 质量风险盘点核对
  - 用检查输出 + `git grep` 复核 spec.md 的三类债务清单,补齐遗漏(如 scripts
    考古层具体文件、6 个 playwright 配置的合并方案)
  - 产出 `risk-inventory.md`(track 内文档),作为 Phase B–D 的修复索引
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase B: 兼容性清理(GR2,Green)

- [x] Task: 移除 T18 wire 兼容层 cf2397e
  - 删除 `apps/worker/src/capabilities/coding/compatibility.ts` 及其测试/fixture
  - 删除 `packages/engine/src/agent-run/legacy-capability-run.ts` 及引用
  - 清理 web/worker 中 legacy dispatch 分支,保留 canonical Agent Run 唯一路径
  - 整链清除:temporal/capability、db/capability-runs、capability-callback 路由、
    worker codingCapabilityWorkflow、engine capability-run aggregate;deploy 合同
    与 s2 sitemap 断言同步;DECISIONS.md 记 D39
- [x] Task: 清理其余兼容 shim 1ae6270, b795d52
  - migrations.ts 无旧结构 shim(盘点纠正);events.ts 旧 domain 列兜底已删
  - 50 条措辞基线复核裁决;chat pre-T15 恢复路径与 Codex legacy:t18 回落删除
  - check-compat 转绿且 pendingRemoval 清零;受影响测试全绿(invariants 留待终验)
- [x] Task: Phase Verification & Checkpoint(编排 agent 复跑:994+135 测试全绿)

## Phase C: 依赖方向收口(GR1,Green)

- [x] Task: 修复 check-deps 报告的存量违规 be15f9f
  - engine 测试读 web bundle:fixture 复制为包内钉版快照
  - web 回放测试 import worker activities:改用 web 内同构 fixture
- [x] Task: 无法即时修复者登记入 exceptions.json(须含退役条件),其余清零 be15f9f
  - 剩余 2 条:worker→web `src/db`(长期存储边界)、worker→web `src/engine`
    (kill 集成测试的引擎真身需求,retireWhen 指向组合根下沉)
- [x] Task: Phase Verification & Checkpoint(编排 agent 复跑 check-deps + 回放测试绿)

## Phase D: 大小治理(GR3,Green)

> 策略优先级:删除 > 下沉 > 拆分 > 提取。12 个超限目录按四种类型分别施治,
> 不按统一"拆文件"处理。

- [ ] Task: 考古堆积型裁决——`scripts/`(15.3k)、`e2e/`(8.3k)
  - t15–t19 已关闭 track 的 eval 脚本/spec/corpus:提升为常驻门禁或随 track 归档删除
  - t22 系列在 T22 关闭前保留,关闭时同规则裁决
  - playwright 配置 6 个合并为 2 个(CI 常驻 + eval 按需),e2e 常驻集只留
    invariants + 核心流程 spec
- [ ] Task: 平铺增长型下沉——`packages/engine/src`、`packages/agent/src`、
  `packages/shared/src`
  - 按既有领域语言把根部平铺文件下沉子目录(如 definition/、execution/、contract/),
    零行为变化,批量改 import
  - 随下沉拆分超限文件:`siren.ts`、`fold.ts`、`agent-run/run.ts`
- [ ] Task: 组合边界型下沉——`apps/web/src/engine`、`apps/web/src/db`
  - 按文件名自带领域簇分组:`engine/agent/`、`engine/capability/` 等;`db/` 同步
  - 先拆 `db/agent-definitions.ts`(1192)再下沉
- [ ] Task: 实现厚型拆分——`apps/worker/src/runtime-backends`、`apps/web/src/auth`、
  `apps/web/src/components`、`deploy/helm/ui4a/render.ts`
  - runtime-backends 分 `kubernetes/`、`host/` 子目录,拆
    `kubernetes-runtime-transport.ts`、`host-runner.ts`
  - chat 组件下沉 `components/chat/`,拆 `chat-panel.tsx`、`canvas-body.tsx`
  - auth 仅超 6%,拆一两个文件达标,不动结构
  - `render.ts`(1647)按部署组件拆分
- [ ] Task: 拆分其余超限测试文件(>800 有效行)按场景分组
- [ ] Task: `size-baseline.json` 清空,check-size 全绿
- [ ] Task: Phase Verification & Checkpoint

## Phase E: 门禁化、历史归档与规则迁移(Gate)

- [ ] Task: 根 `package.json` 增加 `governance` script 并并入 `check`
- [ ] Task: 历史 Track 归档(FR5)
  - T1–T21 移入 `conductor/tracks/archive/`,内容只读不改写
  - `tracks.md` 重组为"活跃 Track + 归档索引"两节,修正全部链接
  - `conductor/index.md` 等活跃文档中被移动路径的引用同步修正
  - 被归档 Track 的专属脚本按 GR5 在同一序列裁决(衔接 Phase D 考古任务)
- [ ] Task: GR1–GR5 迁入 `AGENTS.md`(Architectural Invariants / Conventions 节),
  `conductor/workflow.md` 验收协议增加治理门禁一步;AGENTS.md 的 System Map 与
  模块职责表按本 Track 实际清理结果对齐(如兼容层删除、目录下沉后的新结构)
- [ ] Task: 终验——全新 clone 视角跑 `pnpm install && pnpm check` 与 invariants 全绿;
  Track 收口,更新 `conductor/tracks.md` 状态
