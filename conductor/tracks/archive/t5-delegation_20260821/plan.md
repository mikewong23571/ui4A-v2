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
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)
[checkpoint: 173d4b8] — 验证报告挂 git note(自治验收,编排代行);CI=true pnpm check 全绿(612,+30 用例)+ e2e 22 passed 零回归;手工等效:delegated dispatch → statusUrl 轮询至 completed(真栈),inline/delegated 消息同构对拍(next×3→publish→完成,失败路径亦等价),舰队页无头走查截图确认;验证中发现并修复 delegationId=workflowId 对齐 bug(statusUrl 404,173d4b8)。

## Phase C: S3 全链路 E2E

- [x] Task: S3 E2E(并发同资源一成一拒带原因/kill 续跑/N≥3 并行/舰队页/chat delegated 轮询;回归 22)(c3c5837;链路修复 ee93eb8 多写者水位跳步、b17591a 向导循环化[D11];并发载体以同标题发布对撞实现——评论 approve 对败者是读-判-行竞态,记录于 commit message 与 note)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)
[checkpoint: c3c5837] — 验证报告挂 git note(refs/notes/commits 追加 + refs/notes/verification;自治验收,编排代行);CI=true pnpm check 全绿(613,+1 多写者水位回归)+ CI=true pnpm e2e 25 passed/1 skipped(22 既有 + S3×3 零回归;S3 spec 连跑 3 轮稳定);验证期发现并修复:多写者水位跳步(ee93eb8,worker 直写事件被 web 自身 append 跨过 → 委托缺步 → 读路径 500)、发布向导不可循环(b17591a,D11,spec 验收 4 的域前提);S3-并发载体以同标题发布对撞实现(评论 approve 败者为读-判-行竞态,不可稳定断言,偏差记录于 spec 头注与 commit)。
