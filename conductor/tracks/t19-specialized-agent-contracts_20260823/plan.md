# T19 Specialized Agent Contracts — Plan

## Phase A: Red baseline、spikes 与架构决定

- [ ] Task: 冻结 U1–U26/TS1–TS20 evidence schema、Coding/Writing/Agent-authoring Golden Stories 和 Safety corpus
- [ ] Task: Red baseline——证明 T18 Host/Run/Task/Result 与 coding 名称、Git workspace 和 verifier 耦合
- [ ] Task: AgentDefinition spike——比较独立定义、单层 extends 与 mixin；验证 flatten/birth-version/cycle/diff
- [ ] Task: Prompt contract spike——比较 typed blocks/bindings、Mustache-style 文本和 Provider 原生模板；验证 privilege separation/hash
- [ ] Task: Run migration spike——比较 capability-run 原位演进、agent-run compatibility projection 与新事件族；证明单一真相
- [ ] Task: Writing runtime spike——验证 document workspace、source/citation/render evidence 和真实 Provider structured result
- [ ] Task: 将决定先写入 DECISIONS/tech-stack，明确 Capability→AgentDefinition→RuntimeProfile 三层
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase B: Shared AgentDefinition 与 pure kernels

- [ ] Task: TS1/TS2 Red→Green——AgentDefinition/Prompt/Policy/Task/Result wire contracts、parser、limits、canonical hash
- [ ] Task: TS3 Red→Green——versioned derivation resolver、flatten、缺父/循环/禁止覆盖与 property tests
- [ ] Task: TS4 Red→Green——activation invariants 全量 checks、runtime/tools/verifier/eval/binding validation
- [ ] Task: TS5 Red→Green——generic Agent Run lifecycle、needs-input/grants/result proposal、cursor/restart/idempotency/CAS
- [ ] Task: Pure/source governance——generic modules 零 coding/writing/provider/Node/DB/Temporal；JSDoc 与覆盖率 >80%
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase C: Definition persistence、Meta Draft 与 registry

- [ ] Task: TS6 Red→Green——definition/template/eval append-only events、content-addressed payload、rebuildable registry/version projection
- [ ] Task: TS7 Red→Green——T17 Draft 增 agent-definition kind、validation/diff/submit/human-only atomic activation
- [ ] Task: TS8 Red→Green——Meta exact/list/version/activation Siren 与业务 specialization discovery、跨站/scope isolation
- [ ] Task: Definition concurrency/replay——duplicate/stale/parallel approval、empty projection rebuild、birth hash
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase D: Generic Agent Host 与 Coding specialization migration

- [ ] Task: TS9 Red→Green——typed Prompt compiler、data delimiters、实际 messages/prompt hash provenance
- [ ] Task: TS10/TS11 Red→Green——Runtime registry feature negotiation 与 tool/resource grant intersection、零 fallback/override
- [ ] Task: TS12 Red→Green——generic Temporal workflow、questions/grant signals、kill/cancel/restart/callback idempotency
- [ ] Task: TS13 Red→Green——output schema、artifact/verifier evidence 与 Application proposal bridge
- [ ] Task: TS14 Red→Green——迁移 coding-agent@1；保留 T18 wire/event/API compatibility 或明确 version adapter
- [ ] Task: T18 regression——deterministic corpus、real Codex 5 variants、Safety/no-merge/main checkout 全绿
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase E: Writing specialization vertical slice

- [ ] Task: TS15 Red→Green——WritingBrief/WritingResult、document workspace、source/citation/render verifier
- [ ] Task: 声明并激活 writing-agent@1，Application Capability/Flow 只引用 specialization，不绑定 Provider
- [ ] Task: Renderer——brief form、Run progress/questions、document/citations/render receipt、human accept/reject，移动端/action fuzz
- [ ] Task: Real Writing Agent Eval——canonical + 4 variants ≥80%，引用/代码仓库/自动发布 Safety 100%
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase F: Agent-authored specialization

- [ ] Task: TS16 Red→Green——authoring Agent 产 Prompt/schemas/runtime/policies/examples/Eval corpus 的 Agent Definition Draft
- [ ] Task: TS17 Red→Green——mechanical Safety + real Agent rubric harness，证据固定 definition/prompt/runtime/task/result hashes
- [ ] Task: U23–U25 HTTP/Renderer——五种自然语言描述起草、checks/Eval/diff、人类批准；Agent/system self-approval 100% 拒绝
- [ ] Task: U26 version/replay——registry bump、新旧 Run birth version、parallel activation CAS 和空投影重建
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase G: 全量验收、文档与终审

- [ ] Task: U1–U26 user-story matrix 全量闭环；Coding/Writing/Authoring 三条真实 Golden Story
- [ ] Task: Safety 100%、performance/budget、prompt/template/payload limits、retention 和 failure recovery
- [ ] Task: 回归 `pnpm check`、`CI=true pnpm e2e`、真实 Temporal、real Agent Evals 和 source governance
- [ ] Task: 同步 GOAL/DECISIONS/product/tech/arch/runtime/audit/AGENTS/README/DONE
- [ ] Task: Principal review——三层本体、Prompt 权限、Runtime 泄漏、Host 特化分支、自批、birth/replay 与 scope creep
- [ ] Task: Final Phase Verification & Checkpoint (Refer to workflow.md)
