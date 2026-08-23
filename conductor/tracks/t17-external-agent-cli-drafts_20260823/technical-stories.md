# T17 Technical Stories

> 技术故事说明为了让 U1–U24 成立，系统必须提供什么可独立验证的机制。每条 DoD 需要确定性证据；真实第三方 Agent 的语义可用性由 U24 单独验收。

## CLI 协议与运行时

### TS1 Versioned CLI Envelope

定义稳定 success/error/page envelope、JSON-only stdout、stderr diagnostics 和退出码；支持 schema/version negotiation。

DoD：snapshot/compatibility tests；auth/network/schema/conflict/pending 均有不同 code；输出无 secret。

### TS2 CLI 配置与身份来源

实现 flag → `UI4A_*` env → user config 的配置优先级和 `doctor`；身份/权限来自服务端凭据，不从业务命令 flag 自报。

DoD：缺配置 doctor 仍 exit 0 并报告 missing；业务命令缺认证非零；token 永不出现在 error/debug JSON。

### TS3 Discovery/Resolve/Read Client

CLI 消费 sitemap、Siren entity、links、catalog 和有界列表，将名字/URL/rel 解析为稳定 ID。

DoD：fixture + live read；分页有界；unknown/ambiguous resolve 结构化失败；未授权结果零泄露。

### TS4 Application Bundle Export

从 active Application/Flow/capability/policy 定义机械导出 canonical、versioned Bundle。

DoD：export→parse→export 等价；不含实例 facts/session/Sidecar/secret；hash 稳定。

### TS5 Business Action/Plan Adapter

CLI 根据实时 Siren action schema 构造 `/api/exec` 和 `/api/exec-plan` 请求，保留 rejection/confirmation 语义。

DoD：direct/suspended/rejected 三结果；extra params 剥离或拒绝；Agent approval 无命令面；action 名无硬编码。

### TS6 Raw Read-only Escape Hatch

实现使用同一 base URL/auth/redaction/envelope 的 GET/HEAD request；限制路径、响应大小和重定向。

DoD：POST/PUT/PATCH/DELETE fail-closed；跨 origin 拒绝；错误不泄露 headers/token。

## Submission Policy 与 Draft Kernel

### TS7 SubmissionPolicy Contract

在 shared 定义 `draft|direct|none`、继承/默认/override 规则和 policy evidence；在 activation invariants 校验策略合法性。

DoD：未声明的外部可写面默认 draft；none 零写 action；direct 缺 schema/guard/authorization 时定义不可激活；请求 override fuzz 100% 拒绝。

### TS8 Draft Entity Schema

定义 envelope、kind、target/baseVersion、owner/policyScope、payload/hash/schemaRef、provenance、validation、status、version 和 retention。

DoD：exact schema/property tests；envelope 有大小/类型预算；禁止 sessionId、hydrated secrets 和自报 approval。

### TS9 Draft Lifecycle State Machine

实现 editing/invalid/ready/pending-approval/accepted/rejected/stale/abandoned/expired 合法转换。

DoD：全转换表；非法转换拒绝留痕；终态不可 mutation；revision/fork 语义明确。

### TS10 Draft Event Fold

定义 draft-created/revised/validated/submitted/staled/abandoned/accepted/rejected 事件与独立 pure fold。

DoD：eventId/commandId 幂等；immutable versions；active pointer；全量/增量 fold 一致；Draft events 不改变 Active Business hash。

### TS11 Draft CAS 与并发

实现 baseVersion optimistic concurrency、payload hash、advisory/transaction serialization 和 retry idempotency。

DoD：同 base 并发冲突恰一成功；非冲突重试不重复；stale race；property tests + PostgreSQL integration。

### TS12 Validation Adapter

Draft validation 复用现有 Application Bundle parser、JSON Schema、definition registries 和 activation invariants，不复制规则到 CLI。

DoD：issue code/path/message/evidence 稳定；同 payload/current contracts 结果确定；invalid payload 可修订但不可 submit。

### TS13 Mechanical Diff

在 active target/base 与 Draft candidate 间产生 canonical structural diff 和 hash。

DoD：新增/删除/修改 App/Flow/node/field/action/guard/effect 全覆盖；diff 不经 LLM；前端/CLI 同一数据。

### TS14 Draft Persistence Projection

使用 append-only events 作为 truth，提供可删除重建的 PostgreSQL Draft lookup/list projection 和 retention index。

DoD：重建一致；owner/policy isolation；bounded list；projection loss 不丢 Draft；无第二真相源。

## Meta 接入与原子激活

### TS15 Siren Draft Resources

投影 `meta/drafts` collection 与 `draft:<id>` Entity；create/revise/validate/diff/submit/abandon 全部是声明 action，经 `/_meta/api/exec` 裁决。

DoD：CLI 无特权 Draft endpoint；实时 actions/guards/schema；none/direct/draft 处境可解释；业务站与 meta 站隔离。

### TS16 Activation Bridge

ready Draft submit 产生 pending activation reference；human approve/reject 与既有 actor-is-human 边界复用。

DoD：Agent approve/reject 100% 拒绝；pending 时 Active Snapshot/sitemap/Recipe 不变；reason/provenance 双向关联。

### TS17 Atomic Candidate Apply

批准时重新授权、重新校验 base/current/dependencies，并原子应用首个 Application/Flow candidate slice。

DoD：无半应用事件状态；sitemap bump；新实例取新版本；在途实例出生版本不变；失败转 stale/pending-invalid 而非部分成功。

### TS18 Draft/Definition/Presentation Invalidation

定义 active definition 变化对 stale Draft、Application Recipe 和 User Sidecar dependency 的影响。

DoD：错误复用为零；受影响项局部 stale；历史不可变；新 version 后可 rebase/regenerate。

## 验收与治理

### TS19 Agent-neutral CLI Packaging

新增 TypeScript CLI workspace、`bin: ui4a`、build/install-local、README 和 agent-neutral command reference；安装后从非 repo cwd 可运行。

DoD：`command -v`/help/doctor/live read smoke；无 cwd/fixture path 泄漏；CLI package 不 import Next/Web app internals。

### TS20 External Agent Eval 与 Source Governance

建立真实第三方 Agent Golden Story harness 和确定性 Safety corpus；扫描 CLI/route/engine 无 LLM、业务关键词、request-side draft bypass、raw write 或 Agent approval。

DoD：U24 canonical + 4 变体 ≥80%；Safety 100%；报告记录 Agent/model、CLI version、commands、Draft/Activation IDs、validation/rejection、event delta 和人工 rubric；scripted Agent 只用于协议机制测试。

## Traceability Summary

| User stories | Technical stories |
|---|---|
| U1–U5, U23 | TS1–TS4, TS6, TS19 |
| U6–U10 | TS2, TS3, TS5, TS7, TS16 |
| U11–U18 | TS8–TS18 |
| U19–U22 | TS7, TS15, TS16, TS18, TS20 |
| U24 | TS1–TS20 end-to-end |
