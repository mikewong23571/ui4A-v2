# T11 agent 可观测性与蒸馏留痕 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。

## Phase A: GLM-5.3 探针(实测先行,决定帧格式) [checkpoint: de5791f]

- [x] Task: 探针脚本(glm-5.3 经 @ai-sdk/openai chat provider:reasoning 暴露形态 / tool calling / 时延;门控 GLM_API_KEY+RUN_LLM_E2E,无 key 跳过)+ 结论入库(git note;冲突先更 DECISIONS) — de5791f(D22)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) — de5791f

## Phase B: 留痕结构化

- [x] Task: chat-turn detail 增结构化 steps(ChatTurnDetail + route 写入 + history 读端旧形状兼容)(TDD) — 8e6a266
- [x] Task: agent-decision 审计事件(inline llm/rule 每步一条;五要素 detail;fold no-op;写失败不阻断;I5 重放一致)(TDD) — 5166485
- [~] Task: delegation-step detail 增 reasoning 字段(worker;幂等恢复载荷同构)(TDD)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: 思考流(streamText + thinking 帧 + 前端)

- [ ] Task: llm-driver streamText 改造(聚合 tool call 语义不变;fail-safe/60s abort/B4 口径保持;onReasoning 回调)(TDD)
- [ ] Task: SSE thinking 帧(route 管道;rule 路径零帧;客户端断开口径不变)(TDD)
- [ ] Task: chat-panel 可折叠思考区(thinking 帧渲染;与 step 帧交错正确)(组件测试)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: 全量回归与走查

- [ ] Task: 全量回归(`CI=true pnpm check` + `CI=true pnpm e2e` 既有零回归 + 新增)+ 门控 llm 实测(思考区可见、reasoning 落库)+ demo 走查
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)
