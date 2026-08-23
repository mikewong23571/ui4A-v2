# T17 External Agent CLI 与 Governed Draft Ingress — Plan

> 依据 `spec.md`、`user-stories.md`、`technical-stories.md`、`architecture.md` 与 `conductor/workflow.md`。采用 spike-informed Story TDD：CLI/engine 的确定性机制先红后绿；真实第三方 Agent Eval 只验收动态可用性，不替代 Safety。

## Phase A: Red baseline、disposable probes 与架构决定 [checkpoint: f5cf303]

- [x] Task: 建立 U1–U24/TS1–TS20 evidence schema、traceability matrix 和 canonical Golden Story；记录 CLI version/commands、Agent/model、Draft/Activation IDs、validation/diff、Active hash、events、Safety 和 rubric (f5cf303)
- [x] Task: Red baseline——证明当前第三方 Agent 必须拼接 curl/端点、候选制品留在系统外、Application/Flow 写入无通用 Draft、request 可自报 actor/principal、Application Bundle 无候选原子 apply (f5cf303)
- [x] Task: CLI disposable probe——用最小 TypeScript binary 从 `/tmp` 完成 doctor/sitemap/entity/action/audit，比较 JSON envelope、分页、错误码、配置和安装方式；spike 不直接成为生产 CLI (f5cf303)
- [x] Task: Draft storage probe——比较 shared event domain 与独立 append-only table、inline payload 与内容寻址 payload；测 replay、projection rebuild、大小预算、owner/policy lookup 和 Business hash (f5cf303)
- [x] Task: Atomic apply probe——对现有 publishing Flow 候选比较单 apply event 与事务性既有事件组，验证 definition history、birth version、sitemap、replay 和失败原子性 (f5cf303)
- [x] Task: Real external-Agent usability probe——只给真实 Agent `ui4a --help`、目标和 scoped endpoint，观察 discover/export/repair/diff/submit 缺口；不把 spike prompt/trace 写进产品规则 (f5cf303)
- [x] Task: 将结论写入全局 `DECISIONS.md`，冻结 CLI envelope/runtime、Draft event/store、SubmissionPolicy inheritance、atomic apply、auth demo 边界和 companion skill 范围；技术栈偏差先更新 `tech-stack.md` (f5cf303)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) (f5cf303)

## Phase B: Shared SubmissionPolicy、Draft schema 与 pure kernel [checkpoint: 19152ca]

- [x] Task: U19–U21/TS7 Red→Green——`draft|direct|none` shared contract、默认/继承/actor-scope 求值和 activation invariants；request-side override fuzz 100% 拒绝 (19152ca)
- [x] Task: U11/TS8 Red→Green——exact Draft envelope、kind/target/base/payload hash/schema/provenance/validation/status/version/retention 与预算；payload invalid 可入、envelope invalid fail-closed (19152ca)
- [x] Task: U12/U17/U18/TS9 Red→Green——Draft lifecycle 状态机、immutable versions、fork/rebase/abandon/terminal 规则 (19152ca)
- [x] Task: TS10 Red→Green——Draft commands/events/pure fold、eventId/commandId 幂等、active pointer、lookup indexes 和 Business Snapshot isolation (19152ca)
- [x] Task: U12/U18/TS11 Red→Green——baseVersion CAS、payload hash、冲突检测、stale/rebase property tests 和 deterministic retry (19152ca)
- [x] Task: U13/TS12 Red→Green——复用 Application Bundle parser/schema/invariants/registries 的 validation adapter 与稳定 issue shape (19152ca)
- [x] Task: U14/TS13 Red→Green——canonical mechanical diff，覆盖 App/Flow/node/field/action/guard/effect 增删改，零 LLM (19152ca)
- [x] Task: Pure kernel source governance——无 DB/HTTP/React/Temporal/env/业务关键词；公共函数 JSDoc 与覆盖率 >80% (19152ca)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) (19152ca)

## Phase C: Draft persistence、Siren Meta resources 与审批桥

- [ ] Task: TS14 Red→Green——按 Phase A 决定实现 append-only Draft persistence、PostgreSQL projection、owner/policy/status indexes 和 projection rebuild
- [ ] Task: U11/U12/U15/U17/TS15 Red→Green——`meta/drafts` 与 `draft:<id>` Siren 投影；create/revise/validate/diff/submit/abandon 全走声明 action + `/_meta/api/exec`
- [ ] Task: U15/U16/TS16 Red→Green——ready submit → pending activation；Agent approve/reject 100% 拒绝；human decision 与 Draft 双向 provenance
- [ ] Task: U16/U18/TS17 Red→Green——批准时重新授权/校验/CAS，原子应用现有 publishing Flow candidate，失败无半激活并转 stale
- [ ] Task: TS18 Red→Green——definition 变化局部 stale Draft/Recipe/Sidecar，历史不可变，rebase/regeneration receipt 可审计
- [ ] Task: U7/U13/U15 Safety integration——invalid/ready/pending Draft 均不改变 Active Entity、集合计数、sitemap 或 Presentation fastpath
- [ ] Task: Replay/concurrency integration——全量/增量 fold、projection truncate/rebuild、两 writer CAS、重试幂等、Active/Draft hash 一致
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase D: TypeScript `ui4a` CLI 基座、读取与业务操作

- [ ] Task: TS1/TS2/TS19 Red→Green——`apps/cli` workspace、`bin:ui4a`、help、versioned JSON/error envelope、exit codes、config/auth precedence、redaction 和 doctor
- [ ] Task: U2–U5/TS3 Red→Green——apps/flows/entities/catalog/audit discover-resolve-read，bounded limit/cursor/afterSeq 和 unauthorized zero leakage
- [ ] Task: U4/TS4 Red→Green——versioned canonical Bundle export；round-trip/hash/source governance，无 facts/session/Sidecar/secrets
- [ ] Task: U6/U8/U9/U10/TS5 Red→Green——actions list/exec、plans submit、direct/suspended/rejected、schema params、confirmation reference 和 retry
- [ ] Task: TS6 Red→Green——同认证的 `request get|head` raw escape hatch；跨 origin/大响应/redirect/write verbs fail-closed
- [ ] Task: U23 packaging——README、install-local/PATH、从 `/tmp` 运行 command-v/help/doctor/fixture/live read smoke
- [ ] Task: CLI governance——无 LLM/prompt/业务名/自动改进命令；JSON stdout 纯净；所有写命令在 help 中标明 effect/dry-run/approval 后果
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase E: Draft CLI 与现有 Application 改进 Golden Story

- [ ] Task: U11–U18/TS19 Red→Green——drafts create/get/list/revise/validate/diff/submit/watch/abandon 命令和 stable JSON shapes
- [ ] Task: U19 Red→Green——CLI 无 `--no-draft`/actor-human/approve/raw-write；请求注入不能覆盖服务端 SubmissionPolicy
- [ ] Task: U20/U21 Red→Green——同一 CLI 证明 explicit direct action 与 derived `none` Entity；两者均不误建 Draft
- [ ] Task: U22 Red→Green——Sidecar optimization 与业务/定义 Draft 事件、列表、apply 和 replay 完全隔离
- [ ] Task: Golden Story deterministic browser/CLI E2E——export publishing → invalid Draft → repair → validate → diff → submit → Agent approval denied → human approve → sitemap/new-instance/replay
- [ ] Task: CLI interruption/resume——进程退出、另一 cwd/Agent 读取同 Draft/activation，watch cursor 续接且零重复 mutation
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase F: 真实第三方 Agent Eval、安全、文档与全应用闭环

- [ ] Task: U24 real Agent corpus——canonical + 4 自然语言变体，只提供 CLI help/credential/endpoint；质量成功率 ≥80%，不固定模型/命令/补丁/措辞
- [ ] Task: Safety corpus 100%——未审批写入、Agent approval、request-side bypass、none 写入口、stale overwrite、未授权泄露、raw write、secret output 全零
- [ ] Task: Performance/budget——doctor/read 延迟、bounded lists、Draft payload/count/retention、watch backpressure 和 replay time 有明确 demo 门槛
- [ ] Task: Companion skill——CLI 工作后使用 skill-creator 生成可选 Codex skill；文档保持 agent-neutral，skill 只说明命令顺序、安全和示例
- [ ] Task: 回归 `pnpm check`、`CI=true pnpm e2e`、CLI fixture/live smoke、Draft replay/concurrency、source governance 和 real Agent Eval
- [ ] Task: 同步 `GOAL.md`、`DECISIONS.md`、product/guidelines/tech-stack/arch-brief、runtime/audit docs、AGENTS/README 和 DONE 报告
- [ ] Task: Principal review——重点审查 CLI 是否成为第二协议、Draft 是否污染 Active truth、Agent approval/bypass、atomic apply、auth/redaction 和新 App scope creep
- [ ] Task: Final Phase Verification & Checkpoint (Refer to workflow.md)
