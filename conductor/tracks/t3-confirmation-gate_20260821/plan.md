# T3 确认门切片 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。

## Phase A: 确认门引擎语义(纯单测)

- [x] Task: 确认裁决步与挂起结果类型(TDD:requires-confirmation+agent → 挂起;human → 直通;策略原因入事件;引擎级 confirmation-requested 事件)(5b4b483)
- [~] Task: confirmation 实体与 approve/reject(TDD:approve 应用原效果+事件链;I4 actor-is-human 拒 agent;reject 带 reason 不生效;重放一致性——confirmation 事件入 fold)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase B: Cedar 风险策略接入

- [ ] Task: @cedar-policy/cedar-wasm 集成与 policy.cedar(TDD:策略文本驱动裁决;变更策略文本改变行为;求值原因留痕)
- [ ] Task: web 服务层接线(确认裁决进 exec 流程;202 挂起响应;日志事件与 detail)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: Temporal worker 与 notify

- [ ] Task: worker 真身(@temporalio/worker;notifyWorkflow + notify activity;taskQueue ui4a;心跳改为 worker 启动日志)(TDD:activity 单测——inbox 事件写入)
- [ ] Task: web→Temporal 接线(exec 挂起后 startWorkflow;事件流增量:web 读路径按 seq 增量 fold worker 追加的事件)(TDD:双写一致性——worker appendEvent 后 web entity 查询可见)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: 收件箱 UI 与 S1 全链路 E2E

- [ ] Task: inbox 集合投影 + 首页入口 + 通用页渲染确认实体(RJSF approve/reject;I3 前置:按钮均背书)
- [ ] Task: S1/I4 E2E(agent archive→挂起→notify→inbox 可见→human approve→生效;agent approve 被拒;reject 路径;B1–B3 回归)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)
