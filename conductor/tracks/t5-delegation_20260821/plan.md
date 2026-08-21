# T5 委托实体切片 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。

## Phase A: delegation workflow 与委托事件(worker)

- [x] Task: delegationWorkflow + execStep activity(决策/activity 边界确定;fetch 引擎合同;委托事件 delegation-started/step/completed|failed 入日志)(TDD:activity 单测)(97c5a8f;activity 定名 agentStep:决策+执行合一,报告见 git notes)
- [x] Task: delegations 集合投影(engine fold + /api/entity 可查)(TDD)(19fc516)
- [x] Task: 集成测试:kill worker(SIGKILL)→ 重启 → 续跑无缺口(Temporal dev server)(f692e5f)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)
[checkpoint: f62d2f1] — 验证报告挂 git note(自治验收,编排代行);CI=true pnpm check 全绿(582,+29 用例)+ kill 续跑集成通过(真 Temporal+真 worker,序列无缺口)+ CI=true pnpm e2e 22 passed 零回归;手工等效:真 dispatch 委托走完(completed 6 步 4 成功,文章落库,/api/entity?rel=delegations 可查,事件链 started→step×6→completed)。

## Phase B: web 集成与舰队页

- [x] Task: /api/chat mode=delegated(dispatch + statusUrl)+ /api/delegations(列表/详情)(TDD)(f9fd37a;数据源=事件日志为主,读路径零 Temporal 依赖)
- [x] Task: /delegations 舰队页(极简表格 + 首页入口)(组件测试)(1c5cd5b;含悬浮窗委托模式开关小改——工作量小,已做)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: S3 全链路 E2E

- [ ] Task: S3 E2E(并发同资源一成一拒带原因/kill 续跑/N≥3 并行/舰队页/chat delegated 轮询;回归 22)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)
