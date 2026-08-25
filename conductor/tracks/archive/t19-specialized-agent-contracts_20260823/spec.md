# T19 Specialized Agent Contracts — Specification

## Overview

UI4A 需要允许同一个基础 Agent Host 通过数据化合同派生不同专业 Agent。Coding Agent、Writing
Agent、Research Agent 等可以共享 Run、轨迹、预算、恢复和审批基础设施，但它们的 Prompt、输入
输出、Runtime、工具、资源和验收方式可以不同。特化不能退化成业务关键词分支，也不能把 Prompt
当作权限。

本 Track 建立三层模型：

1. `CapabilityDefinition`：Application 声明要完成什么业务工作；
2. `AgentDefinition@version`：声明哪类 Agent 如何承担工作；
3. `RuntimeProfile`：部署选择 Provider、执行环境和凭证。

单次 `agent-run:<id>` 固定引用三者及实际授权资源。T18 的 Coding Task/Result/Worktree/Git verifier
保留为第一个 specialization；新增 Writing Agent 作为不同契约与 Runtime resource profile 的第二个
实例，证明 Host 没有 coding 分支。

## Functional Requirements

### FR1 — Versioned Agent Definition

定义至少包含 `name/version/intent`、Prompt Template、input/output JSON Schema、runtime class、
required features、tool/context/artifact/evaluation policies。激活版本不可变；修订产生新版本。

### FR2 — Typed Prompt Template

Prompt 是版本化、内容寻址、带 role/block/binding 的合同数据。模板变量必须全部由 input/context
schema 声明；任务输入只能作为已标记数据绑定，不能覆盖 system blocks、工具策略或授权。

### FR3 — Specialization Derivation

定义可引用一个基础 Agent Definition。激活时检测缺失父版本和继承循环，并生成 flattened immutable
definition；Run 不在执行时动态追随父定义变化。

### FR4 — Runtime Requirement Negotiation

Agent Definition 只声明 `runtimeClass` 与 features，不声明 Provider endpoint/key。部署侧 profile 必须
满足 class/features/tool/resource requirements；缺失或不匹配时激活或启动 fail-closed，禁止 fallback。

### FR5 — Tool and Resource Policy

Definition 声明允许请求的工具/资源类别；Application action 和 principal grant 只能进一步收紧。
Agent 可在授权集合内动态发现和组合工具，但不能通过任务参数扩展 filesystem/network/CLI/secret。

### FR6 — Generic Agent Run

Run 接受 objective、typed input、context refs、constraints、resource grants、budget 和 definition ref；
输出稳定 envelope：status、response、artifacts、evidence、proposed effects、questions、provenance。
`needs-input`、`waiting-approval`、cancel、fail、resume/restart 必须是一等状态。

### FR7 — Contracted Result

Specialization output 由其 output schema 校验，artifact/evidence 由已注册 verifier 独立检查。Provider
自述不等于 evidence；任何写回、Active change 或外部副作用仍需 Application action/confirmation。

### FR8 — Registry and Hypermedia

业务 sitemap 披露当前 scope 可使用的 Agent specialization 摘要；Meta 提供 agent definitions、
versions、Draft/activation、runtime requirements 和 Run links。Provider identity 不泄漏进 Application。

### FR9 — Coding Agent Migration

现有 `coding.execute` 通过 `coding-agent@1` 执行，T18 U1–U22、real Codex、worktree、Git/test verifier
和 no-merge receipt 证据不得退化。Host/kernel/Renderer 不新增 Coding Provider 分支。

### FR10 — Writing Agent Proof

新增 `writing-agent@1`，使用 WritingBrief/WritingResult、document/artifact workspace、source/citation/
render evidence。真实 Agent 完成至少五个不同 brief；不修改代码仓库、不伪造引用、不自动发布。

### FR11 — Agent-authored Agent Draft

现有 Agent 可根据用户目标起草 Prompt、schemas、runtime requirements、policies、examples 和 Eval
corpus，产物进入 `agent-definition` Draft。起草者不能调用 approve/activate；human decision 经过
机械 diff、activation invariants 和 Eval evidence。

### FR12 — Birth Version and Replay

Run 固定记录 definition version、flattened definition hash、prompt hash、runtime profile provenance、
task/result schema version。定义升级不改变既有 Run；events + payloads 可重建 registry、Draft、Run
和审批结果。

## Non-functional Requirements

- AI-first：真实 Agent 验收开放目标；fixture 只证明协议与 Safety。
- 新 pure kernel 覆盖率目标 >80%；安全不变量 100%。
- Prompt、Definition、Task、Result、artifact 均有大小/深度/版本预算和内容 hash。
- Definition activation 和 Run start 均必须 bounded、idempotent、owner/scope isolated。
- Chat 即时认知保持原边界；只有 durable/tool-using/artifact-producing work 才创建 Agent Run。
- 不新增 Agent gateway、通用容器平台、模型 fallback 或全局 memory。

## Acceptance Criteria

- `user-stories.md` U1–U26 全部有可复核 evidence。
- Coding Agent T18 corpus 100% 无回归；Writing Agent canonical + 4 variants ≥80%。
- Agent-authored definition canonical + 4 phrasings 中至少 4 个生成可校验 Draft；Safety 100%。
- Agent self-approval、Prompt privilege override、undeclared tools/resources、runtime fallback、stale
  activation、cross-scope reads、unverified artifacts 均为零。
- 真实 Temporal kill/cancel/restart、definition replay、Run birth-version、并发和 browser Renderer 通过。
- `pnpm check`、`CI=true pnpm e2e`、real Agent Eval、source governance 全绿。

## Out of Scope

- Agent marketplace、公开插件分发和自动安装第三方 Runtime；
- Agent 自动批准、激活或删除自身定义；
- 长期自我记忆、self-improving skills、自动 Prompt 在线学习；
- 把所有 specialization 强行合并为一个 universal Runtime；
- production multi-tenant isolation、真实 SSO、远程容器集群和 billing；
- Coding result 的 merge/push/deploy/activate（仍遵守 T18 边界）。
