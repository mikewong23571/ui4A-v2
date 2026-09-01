# T43 Application Capability 边界：Native Function Adapter 与受治理结果回流

## Overview

本 Track 证明 Capability 是 Application 面向外部执行环境的 Port，而不是功能目录、插件市场或
第二条业务写入路径。首个垂直切片使用 `cve.enrich`：

```text
CVE Entity Action
  → declaration / guard / schema
  → spawn-requested
  → Temporal Activity
  → Native Function Adapter
  → output validation + receipt
  → callback Action
  → Application event
  → Work Thread projection
```

Native Function 运行在 Worker/Temporal 边界，不能直接读取或修改 Application 状态。函数输出只是
外部 claim；只有经过 UI4A 校验并由声明的 callback Action 重新裁决后，才能成为业务事实。

## Product Alignment

- Application 继续拥有事实、Flow、Action、Guard、Policy 和事件真相。
- Capability 只表达 Application 需要跨越什么边界。
- Native Function 是部署侧 Adapter，不成为产品概念。
- 人与 Agent 从同一 Siren Action 发起能力。
- Work Thread 聚合进展与责任点，不复制函数输出或运行状态。
- Workstation 不暴露函数名、handler、Temporal Activity、attempt 等机制信息。
- Application 增加新 Capability 时，不修改 workstation、Assistant 路由或通用 dispatcher。
- 不把临时读取、总结、比较、解释注册成 Capability。

## Functional Requirements

### FR1 — Capability Port

`CapabilityDefinition` 继续表达稳定名称、标题、业务意图、`transform | extract | effect`、
input/output JSON Schema、Application/Flow 适用范围与 executor class/profile requirement。
Bundle 不得包含 handler、模块路径、endpoint、credential、Temporal 参数或部署环境选择。

### FR2 — Native Function Profile

部署侧定义 Native Function Profile，包括 stable profile ref、executor class、server-owned handler
ref、timeout、retry、资源上限、input/output 大小预算、availability 和失败原因。请求、Action
参数和 Assistant 均不能选择或覆盖 handler/profile。

### FR3 — Declarative Input Binding

Flow 的 `spawn` 必须通过声明式 binding 从已通过 Action schema 的参数、当前 source entity 的显式
字段或已授权且显式引用的 artifact/evidence ref 构造输入。禁止把整个 EngineSnapshot、Work
Thread、Sitemap、用户凭证或任意上下文对象交给 Native Function。绑定结果必须再次通过
Capability `inputSchema`。

### FR4 — Durable Function Execution

每个已持久化的 `spawn-requested` 使用确定性 execution identity，通过 Temporal Activity 执行。
必须支持 timeout、bounded retry、duplicate delivery、worker crash recovery、cancellation 的诚实
终态以及 retry 后不重复产生业务效果。不新增 `CapabilityRun` 表、Run 资源或第二套权威状态机。

### FR5 — Contracted Result

Native Function 返回稳定 envelope：`succeeded | failed | cancelled`、typed output、output hash、
attempt/handler/profile receipt、结构化 failure 与可选 evidence refs。Handler 自述成功不等于业务
成功；输出必须经过 Capability `outputSchema`，非法输出按失败处理。

### FR6 — Callback Action

成功和失败只能调用 Flow 已声明的 `on-done`/`on-error` Action。Callback 必须重新读取 source
entity，验证 source spawn、Capability 和 profile birth references，使用受控 system principal，
把参数来源标记为 `effect`，重新经过 declaration → guard → schema，记录 execution receipt 与
callback 结果，且不得绕过 confirmation 或 human-only decision。

### FR7 — CVE Reference Slice

增加一个最小 Security Application 切片：`cves` 集合、`cve:<id>` 实体、
identified/enriching/enriched/enrichment-failed 状态、`enrich-impact` Action、`cve.enrich`
Capability、success/error callback Actions 与一个部署侧 Native Function reference implementation。
Reference function 使用受控测试情报数据证明边界机制，不冒充实时公共漏洞情报服务。

### FR8 — Work Thread and Presentation

CVE 实体可通过现有显式 thread reference 加入 Work Thread，不自动 attach。Workstation 只显示正在
补充情报、已完成及结果摘要、失败及可恢复动作与下一责任点。Native handler、profile、attempt、
raw output 和 Temporal 细节只进入 Meta/raw/audit。

### FR9 — Activation Governance

激活引用 Native Function Capability 的 Flow 前必须验证 Capability 已注册、Profile 存在且 class
匹配、handler ref 唯一且可用、input/output schema 可编译且有界、binding 可解析、
`on-done`/`on-error` Action 存在、callback Action 为内部 capability ingress、Function executor
不伪装成 Agent Definition，且 Agent executor 既有 exact Agent Definition 约束不退化。缺配置必须
在激活或执行 preflight 阶段 fail closed，禁止 fallback。

## Non-Functional Requirements

- Pure contract/invariant/result modules 覆盖率目标大于 80%；授权、幂等、callback、输出污染安全
  路径 100%。
- Native Function 不得访问 Web application code、PostgreSQL、EngineSnapshot 或用户 credential。
- Worker 执行必须有明确 timeout、retry 和 payload budget。
- 不新增运行时依赖；若 spike 证明需要依赖，先更新 `tech-stack.md`。
- 不引入 per-Application UI、业务关键词路由或 capability-name dispatcher。
- `pnpm governance:strict` 保持零例外。
- 真实 LLM 只验证 Agent 选择同一 Action；fixture 不能冒充语义验收。
- 人类、Agent 和 CLI 的合同执行共享同一业务日志。

## Acceptance Criteria

- `user-stories.md` 的 S1–S14 全部有可重复证据。
- 一个真实 Temporal worker crash/retry 场景通过。
- 一个 callback concurrency/stale guard 场景通过。
- 成功、非法输出、异常、超时、取消、缺配置、重复 callback 全覆盖。
- PostgreSQL replay hash 与重放前一致。
- 浏览器桌面和 390px 走查通过。
- CLI 与 renderer/Assistant 读取同源 Siren 合同。
- 新增第二 fixture capability 无通用代码分支。
- `pnpm check`、focused coverage、`CI=true pnpm e2e`、真实 LLM Story Eval 全绿。
- 人工走查确认没有增加函数平台操作负担或无意义确认。

## Out of Scope

- MCP/OpenAPI/Lambda 等远端 Adapter；
- 自动发现、导入或安装外部工具；
- Capability marketplace 或 Capability CRUD 新站点；
- 新的 Capability Run 模型；
- 流式函数输出和长期人工暂停；
- 实时公共 CVE 数据服务；
- 自动创建或自动 attach Work Thread；
- Agent 自动批准结果；
- merge、push、deploy 或 Application activation 副作用；
- 重构现有 Coding/Writing/Authoring specialization；
- 生产多租户、billing、HA。
