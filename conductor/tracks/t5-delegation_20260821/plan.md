# T5 委托实体切片 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。

## Phase A: delegation workflow 与委托事件(worker)

- [x] Task: delegationWorkflow + execStep activity(决策/activity 边界确定;fetch 引擎合同;委托事件 delegation-started/step/completed|failed 入日志)(TDD:activity 单测)(97c5a8f;activity 定名 agentStep:决策+执行合一,报告见 git notes)
- [ ] Task: delegations 集合投影(engine fold + /api/entity 可查)(TDD)
- [ ] Task: 集成测试:kill worker(SIGKILL)→ 重启 → 续跑无缺口(Temporal dev server)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase B: web 集成与舰队页

- [ ] Task: /api/chat mode=delegated(dispatch + statusUrl)+ /api/delegations(列表/详情)(TDD)
- [ ] Task: /delegations 舰队页(极简表格 + 首页入口)(组件测试)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: S3 全链路 E2E

- [ ] Task: S3 E2E(并发同资源一成一拒带原因/kill 续跑/N≥3 并行/舰队页/chat delegated 轮询;回归 22)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)
