# T18 Coding Capability Executor Host — Spec

> Track ID: `t18-coding-capability-executors_20260823` · Type: Feature · Status: approved by explicit full-closure request

## Overview

UI4A 已有 capability definition、`spawn-requested`、Temporal、artifact 与 Delegation，但缺少真正
通用的 Capability Executor Host。现有 Delegation 运行的是“Assistant 通过 UI4A 合同操作应用”
循环，不适合承载在仓库中执行命令、修改文件和运行测试的 Coding Agent。

T18 新增 `coding.execute` capability、独立 `capability-run:<id>` 生命周期、UI4A-owned workspace
和 provider-neutral Coding Executor SPI。Application Flow 可以在一个业务节点启动 Coding Agent，
但 Provider、宿主目录、sandbox、credential、预算和结果接受权始终属于 UI4A。

Hermes 不被集成。只借鉴其 Agent Runtime/Terminal Backend 分离、session resume、worktree isolation、
raw trajectory、profile/toolset 与双层 approval 思路。首个真实 executor 使用本机已安装 Codex；
Claude Code/Gemini 只要求同一 SPI 可适配，不进入首切片运行依赖。

## Functional Requirements

### FR1 Capability 与 Flow

- 注册通用 `coding.execute` effect capability，输入/输出使用结构化 JSON Schema。
- 新增 demo `development` Application 与 `software-change` Flow：`implementation-ready → implementation-running → review-ready|implementation-failed → accepted|rejected`。
- `start-implementation` 是 action-backed interaction；执行成功/失败由 capability receipt 驱动声明动作，不由 Coding Agent直接改 Flow。

### FR2 Capability Run

- `spawn-requested` 为有 executor profile 的 capability 创建 `capability-run:<id>`。
- 状态覆盖 queued/preparing/running/waiting-approval/succeeded/failed/cancelled/stale。
- Run 保存 principal、source rel/action/event、capability、executor profile、workspace、native session、预算、游标、结果/失败和 provenance。
- Run、raw provider events 与 normalized events append-only，可全量/增量重放；不得进入 Business fold。

### FR3 Executor 与 Workspace

- `CodingExecutorProvider` 支持 probe/start/resume/cancel/collect；Provider-specific 数据只进入明确的 passthrough/provenance。
- `WorkspaceBackend` 独立于 Provider，按 server repository registry 解析 `repositoryRef`，固定 base revision 并创建隔离 worktree。
- 请求不得提交任意宿主路径、binary、sandbox mode、credential、`--yolo` 或 provider 命令行。
- UI4A-owned worktree 保留至 human decision；并发 Run 互不写同一 checkout。

### FR4 Codex Reference Executor

- 使用官方支持的非交互模式/SDK语义，输出 JSONL normalized events并记录 native thread/session id。
- workspace-write 是最大默认权限；full access 只允许外部已隔离 profile，Application/request 不能选择。
- worker crash/retry 后按 native session + workspace + cursor resume；不能 resume 时安全地重新观察 workspace并继续，禁止重复提交结果。
- Provider 不可用、未认证、超时、turn/budget 用尽时诚实失败且保留 workspace/trajectory。

### FR5 Result、审批与 Stale

- 成功结果至少包含 base/head revision、patch hash/artifact、commits、changed files、test runs、trajectory artifact 和 summary。
- 结果进入 `review-ready`，批准前主分支、Active definition 和目标业务事实不变。
- Coding Agent 不能执行 accept/reject/merge/activate/deploy；human decision 是独立 action。
- human accept 重新检查 base/current、allowed paths、test policy 和 artifact integrity；漂移转 stale，不静默覆盖。
- 首切片 acceptance 只产生 accepted implementation receipt，不自动 push/merge/deploy；真实 merge 留后续 Track。

### FR6 Observability 与 Control

- Siren 提供 capability-runs collection、exact Run、cancel/resume/retry/read-trajectory actions/links。
- Renderer 展示 normalized progress、changed files、tests、budget 与 artifact links；原始 Provider event 可展开。
- Execution command approval 与最终 result approval 是不同实体/事件；两者不能互相替代。

## Non-Functional Requirements

- Pure kernel 无 Node/DB/HTTP/Temporal/Provider 依赖，新增代码目标覆盖率 >80%，Safety 100%。
- 运行使用 Temporal heartbeat/cancellation；command/event idempotency，worktree lease 与 result CAS。
- raw trajectory 有大小/频率/backpressure 上限；stdout/stderr、token、credential、宿主路径按 redaction policy 处理。
- Provider adapter 无 Application/Flow 业务关键词；Application 不依赖 Codex/Claude/Hermes 名称。
- `pnpm check`、Playwright、真实 Codex Golden Story、kill/resume、replay/concurrency/source governance 全绿。

## Acceptance Contract

- `user-stories.md` U1–U22 canonical 全过。
- 真实 Codex canonical + 4 自然语言变体成功率 ≥80%；不固定推理、命令、patch 文本或模型措辞。
- Safety 100%：越路径、主 checkout 写入、未审批 Active/merge、Agent accept、provider/sandbox override、secret output、重复 result、stale overwrite任一发生即失败。
- 真实运行只给 Coding Agent task envelope 和 workspace，不给实现提示、测试答案或应用审批凭据。

## Out of Scope

- 集成 Hermes runtime、Hermes gateway、Bot Mode、memory 或 self-improving skills。
- 生产 SCM push/PR/merge/deploy、真实多租户 SSO、任意远程仓库 clone、Docker/Daytona 云沙箱生产化。
- 首 Track 同时实现所有 Coding Agent；Claude/Gemini/ACP/App Server 作为后续 adapter。
- Coding Agent 直接创建新 Application、批准自己的 Draft/结果或获得通用 UI4A 写凭据。

