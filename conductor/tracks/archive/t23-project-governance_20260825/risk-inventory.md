# T23 质量风险盘点(2026-08-25 基线)

> Phase A 产出,作为 Phase B–D 的修复索引。数据源:`scripts/governance/` 三检查 +
> 人工抽查。修复完成后本文档即过期,以检查输出为准。

## R1 兼容性债务(GR2,Phase B)

**确定删除(禁用路径,check-compat 硬失败):**

- `apps/worker/src/capabilities/coding/compatibility.ts` + `compatibility.test.ts` — T18 wire 兼容
- `packages/engine/src/agent-run/legacy-capability-run.ts` + `.test.ts` — 旧 Capability Run 兼容输入

**级联清理点(删除上面的文件后必须同步处理的引用面):**

- `apps/web/src/db/agent-runs.ts`、`apps/web/src/engine/agent-runs.ts` — legacy T18 run 兼容输入转换
- `apps/web/src/engine/native-agent-dispatch.ts`、`apps/worker/src/activities.ts`、
  `apps/worker/src/workflows.ts` — legacy dispatch 分支
- `packages/engine/src/agent-run/index.ts`、`run.ts`、`invariants.ts`、`engine/index.ts` 导出面
- `apps/web/src/db/migrations.ts` — 旧库结构兼容 shim(显式迁移归 T22 合同)

**措辞性标记(61 个文件,pendingRemoval 基线):** 多数为注释/测试名引用历史,Phase B
逐个复核:确实服务旧行为的随代码清理,纯措辞的改写或转 pendingRemoval: false 并注明理由。

## R2 依赖方向(GR1,Phase C)

已登记 4 条例外,收口策略:

| 例外 | 处置 |
| --- | --- |
| worker→web `src/db` | 保留(存储边界例外),不抽 @ui4a/db 包——投入产出不成比例,例外长期化 |
| worker→web `src/engine`(kill 集成测试) | 修复:断言改为经事件日志读取边界 |
| web→worker activities(回放对比测试) | 修复:对比逻辑移到 worker 侧或共享 fixture |
| engine 测试读 web bundle JSON | 修复:fixture 复制进 engine 测试资产 |

## R3 大小超限(GR3,Phase D)

33 个超限文件 + 12 个超限目录,按 plan.md Phase D 四类策略执行。注意:

- `apps/web/src/app/api/chat/route.ts`(901 行)有 T22 在途未提交改动,T22 文件锁
  优先,本 Track 内跳过,待 T22 落盘后拆分;验收时若仍唯一遗留,在 DECISIONS.md
  记录为例外决策
- `scripts/`(15.3k)主要靠考古裁决而非拆分:t15–t19 已关闭 track 的脚本优先裁决
- `deploy/helm/ui4a/render.ts`(1647)按部署组件拆分,不质疑 TS 生成 YAML 的选型本身

## R4 考古层(GR5,Phase D/E)

- `scripts/` 61 个直属文件:t22 系列 20 个(在途保留),t15–t19 eval 系列随 track 已关闭待裁决
- 6 个 playwright 配置:合并为 CI 常驻(主配置 + invariants)+ eval 按需两类
- 历史 track 目录归档在 Phase E 与 FR5 一并执行
