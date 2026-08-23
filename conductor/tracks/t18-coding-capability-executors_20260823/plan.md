# T18 Coding Capability Executor Host — Plan

## Phase A: Red baseline、disposable probes 与架构决定

- [ ] Task: 建立 U1–U22/TS1–TS18 evidence schema、Safety corpus 和真实 Codex canonical + 4 variants Golden Story
- [ ] Task: Red baseline——证明 `spawn-requested` 无通用 executor dispatch、Delegation 语义不适用、无 capability-run/workspace/result approval
- [ ] Task: Codex disposable probe——在 `/tmp` fixture repo 比较 SDK 与 `codex exec --json` 的 start/events/result/resume/cancel/错误/认证/权限
- [ ] Task: Workspace probe——比较 UI4A-owned worktree、agent-owned worktree 与容器边界；验证 main checkout hash、并发、base CAS、路径限制和清理
- [ ] Task: Persistence/Temporal probe——比较 capability domain/dedicated table、raw chunk storage、long activity/segmented workflow、heartbeat/cancel/kill-resume
- [ ] Task: 将决定写入 `DECISIONS.md`，先同步技术栈；Hermes 启发与 zero-runtime boundary 明确入决策
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase B: Shared contract 与 pure Capability Run kernel

- [ ] Task: TS1 Red→Green——CodingTask/Workspace/RunHandle/raw+normalized events/result/budget/redaction versioned contract
- [ ] Task: TS2 Red→Green——run lifecycle、commands/events/fold、cursor、terminal、eventId/commandId 幂等与 restart boundary
- [ ] Task: TS3 Red→Green——Executor Registry/Profile resolution、probe compatibility、request override 100% 拒绝和无 fallback
- [ ] Task: TS4 Red→Green——repository/base/allowedPaths/lease/result CAS policy；path traversal/property tests
- [ ] Task: Result decision Red→Green——artifact integrity、changed paths、test policy、human-only、stale/reject/accept receipt
- [ ] Task: Pure kernel/source governance——零 Node/DB/HTTP/Temporal/Provider/Hermes；公共函数 JSDoc 与覆盖率 >80%
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase C: Capability persistence、workspace 与 Temporal runtime

- [ ] Task: TS5 Red→Green——append-only capability persistence、raw/result content addressing、projection/indexes/rebuild/owner-scope isolation
- [ ] Task: TS6 Red→Green——repository registry 与 Git worktree manager；unique branch/lease/snapshot/diff/retention
- [ ] Task: TS7 Red→Green——Temporal capability workflow、heartbeat/cancel/retry/timeout/kill-resume 与 process cleanup
- [ ] Task: TS8 Red→Green——result/trajectory artifact materialization 与声明 callback action bridge；失败零半状态
- [ ] Task: Replay/concurrency/budget integration——projection rebuild、two-run isolation、duplicate callback/result、raw backpressure
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase D: Executor adapters 与真实 Codex

- [ ] Task: TS9 Red→Green——safe subprocess/SDK transport、argv/env/cwd、JSONL、bounds、redaction、process-group cancel
- [ ] Task: TS10 Red→Green——Codex probe/start/resume/cancel/collect adapter 与 normalized event mapping
- [ ] Task: TS11 Red→Green——Claude/Gemini-style fixture adapters 证明 SPI 可替换与 unknown passthrough
- [ ] Task: Provider failure/cancel/restart integration——missing auth/binary、timeout、invalid JSONL、worker kill、native resume/restart receipt
- [ ] Task: Real Codex fixture smoke——真实安装/认证在 disposable repo 完成 edit/test/result，主 repo 零影响
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase E: Capability schema、Siren、Flow 与 Renderer

- [ ] Task: TS12 Red→Green——CapabilityDefinition executor requirements/profile、parser/meta/sitemap/export 与 activation invariant
- [ ] Task: TS13 Red→Green——capability-runs collection/exact/raw/artifact Siren resources 和 start/cancel/retry links/actions
- [ ] Task: TS14 Red→Green——development Application/software-change Flow、coding.execute、异步 start 与 callback success/failure
- [ ] Task: TS15 Red→Green——human accept/reject/stale receipt；Agent decision 100% 拒绝；零 merge/push/deploy
- [ ] Task: TS16 Red→Green——Entity/Canvas progress、files/tests/result/raw trajectory 展示与移动端/action invariants
- [ ] Task: Golden Story deterministic HTTP/Renderer——start → progress → result → Agent accept denied → human decision → replay
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase F: Real Story Eval、安全、文档与闭环

- [ ] Task: U22 real Codex corpus——canonical + 4 variants，只给 task envelope/workspace；质量 ≥80%，不固定命令/patch/措辞
- [ ] Task: Safety 100%——越路径、主 checkout 写入、未审批 Active/merge、Agent accept、override、secret、duplicate result、stale overwrite全零
- [ ] Task: Performance/budget——start/progress、raw backpressure、workspace prepare、cancel、replay 和 retention 有 demo 门槛
- [ ] Task: 回归 `pnpm check`、`CI=true pnpm e2e`、Temporal kill/cancel、worktree concurrency、real Codex Eval 和 source governance
- [ ] Task: 同步 GOAL/DECISIONS/product/tech/arch/runtime/audit/AGENTS/README/DONE；记录 Hermes 仅为设计参考
- [ ] Task: Principal review——Executor/Workspace 分层、Provider 泄漏、sandbox/secret、双审批、resume/idempotency、主 checkout 与 scope creep
- [ ] Task: Final Phase Verification & Checkpoint (Refer to workflow.md)

