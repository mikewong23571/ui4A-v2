# T15 disposable spikes — 结论记录

> 2026-08-22。本文记录 Phase A 只读 spike 的发现与后续实现约束；不是生产设计的第二真相，若与 `spec.md` 冲突以 spec 为准。

## 1. Observe → Reason → Answer

当前事实链在进入 LLM 前被截断：Siren 实例和集合成员均包含完整 `properties.fields`，HTTP client 与 `DriverContext.entity` 也保留完整实体；但 `llm-driver.describeEntity()` 只投影 rel/class/node/count、action 名、blocked action 与可导航 rel。导航后的 trail 又只保存 `EntitySummary`，导致正文不可读、跨实体比较丢失前一个实体事实。

T15 应增加协议级只读终态，而不是新增业务 capability：

```ts
type AgentOperation =
  | { kind: 'answer'; content: string; sources: FactRef[] }
  | { kind: 'navigate'; rel: string }
  | { kind: 'exec'; action: string; authorization: EffectGrantRef; params?: object }
  | { kind: 'exec-plan'; authorization: EffectGrantRef; steps: PlanStep[] }
  | { kind: 'done'; summary: string }
  | { kind: 'fail'; reason: string; evidence?: string[] };
```

- `answer` 是临时认知结果，不是 application action/capability；outcome 使用 `answered`。
- `done` 只用于副作用任务完成回执，不再承担事实问答。
- 每次实体 GET 进入有界 observation ledger；回答引用 `rel + JSON Pointer`，可附 fingerprint/日志序号防止漂移。
- 默认只读处境只暴露 navigate/answer/clarify/fail。exec 工具必须由可追溯的 effect grant 开启，并在 loop 发 HTTP 前机械核对原始用户消息、目标、action 和 scope。
- `agent-decision` 当前保存完整 prompt；当完整实体进入观察上下文时，审计应优先保存 observation refs/fingerprints，避免无意扩大长期数据副本。

初版无需修改 Siren 才能通过 U1–U4；若 U21 要求证明字段值的 `intent/proposal/effect` 原始来源，再扩展现有会丢掉 origin 的实例投影。

## 2. Event-sourced conversation context

当前 chat 事件只解决 UI 重放：客户端每轮只发当前文本；route 每轮重新解析 start rel 并新建 `runAgent`；LLM prompt 只含本轮 goal/entity/trail。focus 只返回客户端，未成为下一轮结构化处境。

最小通用模型是：

```text
append-only raw messages
        +
auditable derived context
        ↓
bounded prompt view + fresh contract observations
```

建议新增两类 fold-no-op 审计事件：

- `chat-message-appended`:不可变的 user/assistant 原话、role、message/turn/session id、provenance 和 citations。用户消息使用 `actor=human`，且必须在调用 LLM 前可靠落库。
- `chat-context-updated`:LLM 产生的可修订 interpretation，带 `basedOnSeq`、model、active goal、referents、constraints 与 pending clarification；它不是业务事实。

focus 和 effect authorization 属于机械状态：可使用独立事件，或在 context fold 时由导航/授权事件合并；不能由模型 snapshot 覆盖。授权至少引用 source message id、用户原话片段、rel/action、消费/撤销状态。

上下文重建规则：

1. 按 session rel 与 seq 读取原始消息；旧 chat-turn 事件提供兼容投影。
2. 丢弃基于旧 `basedOnSeq` 的并发 context update。
3. prompt 必保当前消息、active/pending/authorization 引用的消息、当前及被纠正 referent 的证据、最近 Assistant 回复。
4. 其余原话从新到旧按字符预算加入；不引入 tokenizer 依赖，不用 LLM 摘要替换原始日志。
5. thinking/reasoning/trail progress 不进入 dialogue messages。
6. 合同 facts 每轮重新读取，与用户原话和模型 interpretation 分区呈现。

## 3. 用户故事验收边界

- U1/U2/U3/U4 的质量证据是事实覆盖与 source refs；安全证据是零业务 mutation。
- U5–U9 的确定性测试只证明消息不可变、context fold/裁剪/恢复正确、stale update 不覆盖、消息不改变实体。真实 DeepSeek Eval 才证明指代、纠正、约束合并和自然澄清。
- U10/U12 的 safety 由事件差分与 `/api/exec` 调用计数机械证明；不得依赖 judge。至少覆盖 action/plan/confirmation/entity append/definition/render freeze 等副作用族。
- scripted driver 可验证 protocol 搬运，但不能作为任何 Assistant story 的通过证据。
- Eval 不断言逐字回复、步数、导航顺序或特定 tool call；canonical 全过，变体达到 spec 门槛，Safety 100%。

## 4. Refined implementation order

1. 先完成 gated story-eval harness，锁定 U1/U5/U10/U12 当前失败与事件差分。
2. 在 Agent 包增加 observation ledger、FactRef、answer outcome；让 U1–U4 通过通用路径。
3. 在 Web chat 层增加 raw message/context 事件、fold 与 bounded view；让 U5–U9 共享同一恢复机制。
4. 最后引入 effect grant，收紧 exec 工具投影与 loop 入口，闭环 U10–U13。
5. 移除具体阅读/歧义发现的故事级关键词短路，并把 `navigableRels` 从 rule-driver 移到中立模块。

## 5. 尚需在实现中验证

- AI SDK 使用 role-preserving messages + tools 时的实际 DeepSeek 请求/响应形态。
- answer 是 protocol tool 还是允许纯文本后统一结构化；两者都不得成为 application capability。
- observation fingerprint 采用内容 hash 还是日志 seq/version。
- 完整授权字段进入 LLM 后，agent-decision 审计保存引用还是授权快照。
- effect grant 的 LLM interpretation 与机械授权事件之间如何形成 fail-closed 握手。
