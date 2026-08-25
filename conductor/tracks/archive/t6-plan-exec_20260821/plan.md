# T6 plan-exec 切片 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。

## Phase A: 批量裁决器(engine + 合同) `[checkpoint: e4e1c57]`

- [x] Task: executePlan 引擎函数(TDD:全过/中拒截断/中挂停止/空计划;plan-executed 事件;fold 重放一致) `fb2c344`
- [x] Task: /api/exec-plan 端点 + 服务层接线(TDD:响应形状;串行队列内单事务) `9236d7b`
- [x] Task: rule driver 计划生成器 + LLM plan 模式接口(TDD:确定性推导;mock) `e4e1c57`
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) `e4e1c57`

## Phase B: S4 E2E `[checkpoint: 86f6c0f]`

- [x] Task: S4 E2E(六步一次决策/一条 plan-executed/每步可见/exec 调用数=1;拒绝截断;挂起交互;回归 25) `86f6c0f`
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) `86f6c0f`
