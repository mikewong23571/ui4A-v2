# T18 Technical Stories

## Contracts 与 Pure Kernel

### TS1 Coding Executor Wire Contract

定义 versioned CodingTask、WorkspaceHandle、RunHandle、normalized/raw events、CodingResult、budget 与 redaction DTO。

DoD：exact schema/compatibility tests；无 Node/Provider 类型泄漏；未知 Provider detail 可保留。

### TS2 Capability Run Aggregate

实现 run lifecycle、commands/events/pure fold、terminal/CAS/idempotency、active cursor 和 restart boundary。

DoD：全转换表；全量/增量一致；非法/重复/stale fail-closed；Business hash 隔离。

### TS3 Executor Registry 与 Policy

实现 provider-neutral SPI、probe descriptor、server profile resolution 和 request override rejection。

DoD：missing/unhealthy/unsupported profile 结构化失败；Application 无 Provider 名；无 fallback。

### TS4 Workspace Policy Kernel

定义 repositoryRef resolution、base revision、allowed paths、workspace lease/branch/result CAS 决策。

DoD：路径穿越/绝对路径/环境变量/fuzz 100% 拒绝；并发 lease 与 stale tests。

## Persistence 与 Runtime

### TS5 Capability Event Persistence

新增独立 capability event domain、raw payload content addressing、Run projection、owner/scope/status indexes 和 rebuild。

DoD：projection 可删重建；raw budget/backpressure；未授权 exact/list 零泄露。

### TS6 Workspace Manager

实现 server registry + Git worktree backend，固定 base、唯一 branch/path、snapshot/diff/cleanup policy。

DoD：主 checkout hash 不变；changed files/patch hash 可复算；两 Run 隔离；无任意 path。

### TS7 Temporal Capability Workflow

实现 prepare → run/resume heartbeat → collect → callback/finalize；支持 cancellation、timeout、retry、kill/resume。

DoD：worker kill 后继续；completed activity 幂等；cancel 杀子进程；无 orphan lease。

### TS8 Artifact 与 Callback Bridge

物化 CodingResult/trajectory artifact，并通过声明 callback action 驱动 Flow on-done/on-error。

DoD：artifact hash/provenance；callback 重授权；失败无半 artifact/半 transition。

## Executor Adapters

### TS9 Subprocess/SDK Transport

实现无 shell 拼接的 argv/env/cwd transport、JSONL decoder、stdout/stderr bounds、process group cancel 和 secret redaction。

DoD：注入 fuzz；大输出/backpressure；signal/exit mapping；环境 allowlist。

### TS10 Codex Reference Adapter

实现 probe/start/resume/cancel/collect，映射 thread/turn/item/file/command events 与结构化 final result。

DoD：fixture + installed CLI/real auth probe；workspace-write；native thread resume；Provider error honesty。

### TS11 Compatibility Adapter Fixtures

用 Claude/Gemini 风格 JSONL fixture 证明 normalized contract 不依赖 Codex event 形状。

DoD：同一 aggregate/result tests；未知 event passthrough；零产品 runtime dependency。

## Siren、Flow 与 UI

### TS12 Capability Definition Extension

扩展 capability definition executor requirements/profile reference、input/output schemas 与 activation invariants。

DoD：executor profile 未注册不可激活；request 不可覆盖；sitemap/meta export 保真。

### TS13 Capability Run Siren Resources

投影 `capability-runs`、`capability-run:<id>`、raw trajectory/artifact links 与 cancel/retry actions。

DoD：实时 actions/guards；bounded list；owner/scope isolation；CLI/Renderer 同合同。

### TS14 Development Application Slice

新增 provider-neutral development Application/Flow 与 software-change instance，声明 start/callback/accept/reject。

DoD：无 Provider 业务词；start 异步；review-ready/failed/rejected/accepted 路径可达。

### TS15 Human Result Decision

实现 human-only accept/reject、base/current/path/test/artifact revalidation 与 stale receipt。

DoD：Agent 100% 拒绝；首切片零 merge/push/deploy；审计链完整。

### TS16 Renderer 与 Control

通用 Entity/Canvas 展示 run progress、tests/files/result/raw event；actions 复用现有 runner。

DoD：action-backed；移动端；raw detail 懒展开；失败/取消/stale 可理解。

## Evaluation 与 Governance

### TS17 Coding Agent Eval Harness

建立 disposable Git fixture、real Codex canonical+4 variants、kill/cancel/stale/concurrency 与 deterministic Safety corpus。

DoD：≥80% quality，Safety 100%；报告含 provider/version/thread/workspace/base/head/commands/tests/events/artifacts。

### TS18 Source/Operational Governance

扫描 kernel/runtime/adapters 无 Hermes、shell interpolation、raw path/provider override、Agent decision bypass、secret persistence；同步运行与恢复文档。

DoD：governance tests；`pnpm check`/E2E/real eval；Principal review 无 High/Critical。

