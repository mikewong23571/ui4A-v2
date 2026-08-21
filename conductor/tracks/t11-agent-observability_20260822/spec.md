# T11 agent 可观测性与蒸馏留痕 — Spec

> Track ID: `t11-agent-observability_20260822` · Type: Feature · 状态: approved(编排 agent 代行验收)
> 上下文:`DECISIONS.md` D17(chat-turn/SSE)、D20(glm-5.3);`packages/agent/src/llm-driver.ts`(generateText 非流式)、`types.ts`(TrailStep)、`apps/web/src/chat/history.ts`(ChatTurnDetail)、`api/chat/route.ts`(SSE 帧)、`apps/worker/src/delegation.ts`(delegation-step 结构化先例)、`apps/web/src/components/chat-panel.tsx`。

## Overview

三条同源缺口,都在"agent 决策管线"(driver → loop → route → SSE → panel)上:

1. **留痕不对称**:inline chat 的逐步轨迹只存了文本投影(`trailToMessages` 压扁后的 messages),结构化 `TrailStep[]` 被丢弃;delegated 路径的 `delegation-step` 是结构化的。数据飞轮(轨迹挖掘提取 flow)的原料在 inline 路径上缺失。
2. **推理被丢弃**:GLM-5.3 是推理模型(reasoning effort 缺省 max),但 llm-driver 用非流式 `generateText`,reasoning 内容既不展示也不落库;每步决策 8–20s+ 期间用户无反馈。
3. **蒸馏原料缺失**:「聪明模型操作 → 数据 instruct 小模型」需要 (context → reasoning → op) 决策记录,目前什么都不存。

本 track 一次性补齐:结构化 steps 入 chat-turn、`agent-decision` 审计事件、streamText 思考流直出前端。同时偿还 D20 实测债(glm-5.3 的 tool calling 与 reasoning 暴露形态,探针先行)。

## 架构决定

1. **GLM-5.3 探针先行(Phase A)**:脚本实测 glm-5.3 经 `@ai-sdk/openai` chat provider 的 reasoning 暴露形态(reasoning_content / reasoning parts)、tool calling 行为、每步时延;结论决定 thinking 帧格式,并校准 D7/D20 口径(结果记 DECISIONS 注记 + git note)。门控口径同 llm-smoke(`GLM_API_KEY` + `RUN_LLM_E2E`,无 key 跳过不红)。
2. **chat-turn 补结构化 steps**:`ChatTurnDetail` 增 `steps: TrailStep[]`(与 messages 并存——messages 仍是人读投影,steps 是机器可读原料);fold 仍 no-op;history 读端向后兼容(旧事件无 steps 字段不炸)。委托详情 messages 投影口径不变。
3. **`agent-decision` 审计事件**:inline 路径每步决策落一条 `{kind:'agent-decision', rel: chat:<sessionId>, actor/principal/channel 同 chat-turn, detail:{step, driver, prompt, reasoning, op}}`——prompt 存全量(训练提取免回放重建),reasoning 无则为 null;fold no-op 纯留痕,写入失败不阻断响应(同 chat-turn 口径)。**rule driver 同样落**(reasoning=null)——机械层轨迹是蒸馏的正确答案生成器,且 I1 全覆盖时也在产原料。worker 侧:`delegation-step` detail 增 `reasoning` 字段(不新增 kind,幂等恢复载荷同构扩展)。
4. **streamText 改造 + thinking 帧**:llm-driver `generateText` → `streamText`,聚合出最终 tool call 后语义不变(`mapToolCall`/fail-safe/60s abort/B4 错误折算全部保持);`AgentRunOptions` 增 `onReasoning?(text: string)`,chat 路由管道为 SSE `{type:'thinking', text}` 帧(逐步决策前推送);chat-panel 渲染可折叠「思考」区。rule driver / 端点不返回 reasoning → 零 thinking 帧,行为与现状逐帧一致。
5. **不动的口径**:decide 永不抛异常;`tool_choice` 保持 auto(D7);I5 重放同构(新 kind 一律 fold no-op);工具投影两层形状不变(本 track 不碰合同面)。

## Acceptance Criteria

1. `CI=true pnpm check` 全绿;`CI=true pnpm e2e` 全过(既有零回归 + 新增);
2. 探针报告:glm-5.3 的 reasoning 暴露形态 + tool calling + 时延实测结论入库(git note;若与 D7/D20 口径冲突先更 DECISIONS);
3. chat-turn detail 含结构化 steps(写入单测 + history 端点旧形状兼容测试);
4. `agent-decision`:inline llm 与 rule 回合每步一条,detail 五要素齐全(step/driver/prompt/reasoning/op);llm 路径 reasoning 非空(门控实测)或端点不返回时如实 null;I5 重放 hash 一致;
5. thinking 帧:chat-panel 折叠思考区组件测试;e2e rule 路径断言无 thinking 帧且不炸;llm 路径思考区可见(门控实测);
6. `delegation-step` detail 含 reasoning 字段(worker 单测;幂等恢复路径兼容);
7. 回归:B1–B4 / S1–S5 / I1–I6 既有断言零改动通过。

## Out of Scope(非目标)

- 蒸馏训练、轨迹挖掘算法本身(原料备齐即可,算法后补);
- worker delegated 路径的 SSE 实时推流(舰队页轮询现状不变);
- prompt 分层槽位(role/app,L1 上下文)——挂 T10 Phase D;
- render LLM 路径接线、页面级实体缓存——t12;
- 决策理由的「忠实性」校验(reasoning 是模型自述,按审计数据处理,不进裁决)。

## 施工上下文(自包含:subagent 无需再做 discovery)

**模块地图(精确触点)**:

- 决策与轨迹:`packages/agent/src/loop.ts`(runAgent 循环)、`packages/agent/src/types.ts`(TrailStep :64-72;AgentRunResult :128-135;AgentRunOptions :122 附近——`onReasoning` 加在这里)、`packages/agent/src/llm-driver.ts`(llmDecide :210-232,generateText → streamText 改造点;SYSTEM_PROMPT :60-69 不动)。
- SSE:服务端 `apps/web/src/app/api/chat/route.ts`(step/final 帧推送段 :257-300);客户端解析 `apps/web/src/components/chat-panel.tsx:242-245`(`frame.type === 'step'/'final'`——`thinking` 帧分支加在这里)。
- 留痕:`apps/web/src/chat/history.ts`(ChatTurnDetail 加 `steps`);history 端点 `apps/web/src/app/api/chat/history/route.ts`(+ route.test.ts 兼容用例);事件写入 `apps/web/src/db/events.ts`(appendEvent);新 kind `agent-decision` 须加入 `packages/engine/src/fold.ts:55-67` 的 LogEventKind 联合且 fold no-op。worker:`apps/worker/src/delegation.ts:52-55` DelegationStepRecord 增 `reasoning` 字段(幂等恢复载荷同构)。
- GLM 探针:参照 `e2e/llm-smoke.spec.ts` 的门控模式(`GLM_API_KEY=$(cat ~/.secrets/glm_coding_plan_key) RUN_LLM_E2E=1 CI=true pnpm exec playwright test <spec>`);探针实现为门控 spec 或 `scripts/` 脚本,结论进 git note,与 D7/D20 冲突先更 DECISIONS。

**既有断言红线**:`LogEventKind` 扩展必须 fold no-op(I5 重放同构有测试);`decide` 永不抛异常(B4:端点错误折算 fail reason);`tool_choice` 保持 auto(D7:required 在 GLM 端点挂死);chat-turn 写失败不阻断响应(route.ts:283-285 既有口径);rule 路径零 thinking 帧。

**基础设施与命令**:同仓通用(PG 5433 docker;`CI=true pnpm check`;e2e 3100 端口 D5);worker 单测不需要 Temporal(kill 续跑集成测试才需要,本 track 不碰)。**改 apps/web 前必读 `apps/web/AGENTS.md`**。
