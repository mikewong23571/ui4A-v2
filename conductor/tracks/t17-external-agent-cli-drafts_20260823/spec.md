# T17 External Agent CLI 与 Governed Draft Ingress — Spec

> Track ID: `t17-external-agent-cli-drafts_20260823` · Type: Feature · 状态: approved for planning

## Overview

UI4A 已经通过 HTTP、Siren、meta、事件日志和确定性裁决向仓库内参考 Assistant 暴露应用，但第三方 Agent 仍需理解端点、认证、分页、事件形状和多步写入细节。与此同时，外部 Agent 的候选内容如果只保存在本地文件，UI4A 无法为其提供版本、校验、协作、审计、恢复和 human approval；如果直接写入业务 Entity，又失去系统边界治理。

T17 提供两个互补能力：

1. 安装名为 `ui4a` 的 agent-friendly CLI，作为 HTTP/Siren/meta 协议的稳定、可组合参考客户端；
2. 通用 Governed Draft Ingress，使外部候选先进入系统内 Draft lifecycle，再经机械校验、diff、提交和人类批准成为 Active truth。

CLI 不是新的权威协议，不内置 LLM，也不实现 `app improve` 黑盒命令。第三方 Agent 负责理解、推理和编辑；UI4A 继续负责授权、schema、guard、submission policy、CAS、approval、activation、audit 和 replay。

## Product Thesis

```text
Third-party Agent intelligence
        │ ui4a CLI (stable JSON reference client)
        ▼
UI4A HTTP + Siren + meta contracts
        │
        ├─ authorized read / direct business action
        ├─ governed Draft ingress
        └─ high-risk confirmation
                  │
                  ▼
         append-only truth + human authority
```

Draft 不是第四个架构平面，也不是每个业务 Flow 必须新增的 `draft` 节点。它是业务平面和定义平面共用的写入缓冲协议，只在外部输入准备取得事实地位时出现。

## Functional Requirements

### FR1 CLI 身份与可组合输出

- Binary 名为 `ui4a`，从任意工作目录可运行；`ui4a --help` 展示主要资源和安全边界。
- `ui4a --json doctor` 检查 CLI/协议版本、base URL、endpoint 可达性、认证来源和缺失配置，永不打印 token。
- 默认输出面向人；`--json` stdout 只输出稳定 JSON，诊断走 stderr，错误为机器可读 envelope 和非零退出码。
- 配置优先级为显式一次性 flag → `UI4A_*` env → 用户配置；正常使用优先 env/config，flag 只用于显式测试。
- CLI 不允许调用方用 `--actor human`、`--principal admin` 或 `--no-draft` 自行提升权限。生产身份来自服务端验证的凭据；local-demo 自报身份必须显式标记。

### FR2 发现、读取和审计

- 提供 Application/Flow/Entity/action/catalog/draft/activation 的 discover、resolve 和 exact read 命令。
- 支持从当前激活定义导出 versioned Application Bundle，不丢 app membership、schema、guard、effect、policy、definition version 或 provenance。
- 支持 session/entity/definition/draft 的原始事件轨迹读取；列表默认有界并暴露 cursor/afterSeq。
- 提供使用已配置认证、redaction 和错误处理的只读 raw escape hatch；首期只允许 GET/HEAD。

### FR3 第三方 Agent 业务操作

- Agent 从实时 Siren `actions[]` 发现可执行动作，字段来自 action JSON Schema，guard 拒绝作为结构化数据返回。
- 低风险且合同明确为 `direct` 的 action 继续走 declaration → guard → schema → effect。
- 高风险 action 使用既有 confirmation，批准前业务状态不变；第三方 Agent 不得 approve/reject。
- `exec-plan` 仍逐步裁决，不因 CLI 或 Agent 提供计划而获得信任。
- 未授权 Entity 的存在、数量和内容均不通过 discovery、resolve、error 或 audit 泄露。

### FR4 Submission Policy

- 定义 `SubmissionPolicy.mode = draft | direct | none`，策略由 Resource/Entity/Action 定义和 policy scope 决定，而不是请求参数决定。
- 外部 Agent 对可写内容或定义提交时，未显式声明策略默认 `draft`。
- `direct` 仍要求声明 action、schema、guard 和授权；切换为 direct 本身是需审批的定义变化。
- `none` 用于衍生、聚合、审计、sitemap、Siren projection 等不可外部写入 Entity，且不得暴露写 action。
- Presentation Sidecar 使用独立 lifecycle，不进入 Draft；high-risk action 默认使用 confirmation，不机械重复套 Draft。

### FR5 Draft Entity 与生命周期

- Draft envelope 至少包含 id/kind/owner/policyScope/target/baseVersion/payloadHash/schemaRef/provenance/status/validation/version。
- Envelope、授权、大小和 content type 必须先合法；payload 可以暂时无效并以 `invalid` + issues 保存，使 Agent 能在系统内修订。
- Draft 版本 immutable，active pointer 可移动；create/revise 使用 eventId/commandId 幂等和 baseVersion CAS。
- 状态至少覆盖 editing/invalid/ready/pending-approval/accepted/rejected/stale/abandoned/expired。
- 第三方 Agent 可以 create/get/list/revise/validate/diff/submit/watch/abandon，不能 approve。
- Draft 在 accepted 前不进入 Active Business Snapshot、正式 sitemap、业务集合计数或 Application Recipe 预生成。

### FR6 校验、diff、提交和批准

- validation 使用与真实 activation 相同的 parser/schema/invariants/registries，不在 CLI 重写规则。
- diff 是机械 structural diff；LLM 不能生成、删减或润色审批 diff。
- submit 只接受 ready Draft，并产生 pending activation/approval reference。
- human approval 时必须重新授权、重新校验 target/baseVersion/dependencies，并原子应用；漂移则 Draft stale，禁止静默覆盖。
- reject/abandon 保留 payload、版本、reason 和 provenance；垃圾回收只移除可重建 projection 或按 retention 归档，不篡改审计日志。

### FR7 首个纵向切片

首个闭环由真实第三方 Agent 改进现有 `publishing` Application 的一个 Flow：发现合同、导出 Bundle、创建 Draft、经历一次 validation rejection、修订、查看 diff、submit、Agent approve 被拒、人类批准、sitemap 更新、新实例获得新定义、旧实例遵守出生版本、全日志 replay 一致。

协议必须通用，但本 Track 不要求创建全新 Application 的完整 Bundle 激活，也不要求覆盖所有业务 Entity 类型。

## Non-Functional Requirements

- CLI 使用 TypeScript/Node，复用 shared/engine contracts，避免复制语言定义；安装后可从 `/tmp` smoke test。
- 新 pure kernel 目标覆盖率 >80%；Draft/authorization/Safety 条件 100%。
- list/search 默认有界；Draft payload 有大小、类型、数量和 retention 限制。
- CLI 不依赖仓库 cwd，不输出 secrets，不在 JSON stdout 混入日志。
- Business、Draft、Activation、Presentation provenance 不混淆；Draft events 不改变 Active Snapshot hash。
- 第三方 Agent Eval 不断言固定命令轨迹、模型措辞或补丁形状，只验收结果、Safety、来源和恢复能力。

## Acceptance Contract

- `user-stories.md` 的 U1–U24 canonical 全过；涉及自然语言策略的真实第三方 Agent 故事至少 canonical + 4 变体，成功率 ≥80%。
- Safety 故事 100%：未审批写入、Agent approval、request-side bypass、`none` 写入口、stale overwrite、未授权泄露任一发生即失败。
- CLI protocol/unit/fixture、PostgreSQL integration、HTTP contract、Playwright、replay、source governance 和真实 Agent Golden Story 全绿。
- 从非仓库目录运行 `command -v ui4a`、`ui4a --help`、`ui4a --json doctor` 和一次 live read-only command 成功。

## Out of Scope

- CLI 内置 LLM、prompt、自动改进策略或业务关键词路由。
- 产品 Chat 内创建 App。
- 同一 Track 完整闭环新 Application、所有普通 Entity Draft 或跨应用自主编排。
- Agent 自行 approve/reject、绕过 Draft/confirmation 或 raw live writes。
- 生产 Keycloak/SSO、跨租户同步、签名发布、远程插件市场和生产级 Draft GC。

## Source of Truth

- 用户可见结果与 Safety：`user-stories.md`。
- 实施能力与 DoD：`technical-stories.md`。
- 候选架构、边界和待 spike 决定：`architecture.md`。
- spike-informed Story TDD 顺序：`plan.md`。
