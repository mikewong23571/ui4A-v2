# T43 实施计划

基线：Track 初始化提交；实现开始时重新记录 HEAD、工作树、governance 与 focused tests。计划遵循
`intent → initial plan → disposable spike → detailed plan → implementation`，所有正式实现任务执行
Red → Green → Refactor，并按 `conductor/workflow.md` 提交、记录 git notes 与 Phase checkpoint。

## Phase A：用户故事固化与边界探针 [checkpoint: 8eb6e58]

- [x] Task: 固化用户故事与验收矩阵 adba00b
  - [x] 复核 S1–S14 的 human、Assistant、CLI、HTTP、Temporal、DB replay 和 browser 证据
  - [x] 明确同一故事的人类/Agent 双执行者路径
  - [x] 标注 Safety 故事必须 100% 通过
- [x] Task: 建立当前行为 Red 基线 549dda4
  - [x] 为无 `agentDefinition` 的 executable Capability 编写失败测试
  - [x] 固化当前服务层只允许 Agent Run 派发的限制
  - [x] 固化 `spawn` binding、callback、artifact 和 profile registry 当前语义
  - [x] 确认 Red 来自缺少 Function Adapter，而非测试环境错误
- [x] Task: 执行 disposable Native Function spike 93f957c
  - [x] 探测 Worker/Temporal Activity 调用本地 handler 的最小路径
  - [x] 探测 source field/action param 到 Capability input 的声明式 binding
  - [x] 探测 output schema、payload budget 和结构化 failure
  - [x] 探测 worker crash、Activity retry 和确定性 execution identity
  - [x] 探测 callback receipt 与业务 Action 的事务边界
  - [x] 删除 spike 产品代码，保留测试 fixture、结论和失败证据
- [x] Task: 固定详细架构 8eb6e58
  - [x] 新增 `architecture.md`
  - [x] 记录 Capability Port、Native Function Adapter、Temporal 和 callback 的依赖方向
  - [x] 决定 binding wire、execution identity、receipt event 和 callback 原子性
  - [x] 在 `DECISIONS.md` 记录新决定后再进入实现
  - [x] 若需要新增依赖，先更新 `tech-stack.md`；否则明确零新增运行时依赖
  - [x] 根据 spike 结果修订后续 Phase 任务，不允许未经证据扩大范围
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 8eb6e58
  - [x] 复跑 Red 基线和 spike fixture
  - [x] 运行 `pnpm governance`
  - [x] 审查无第二 Run、无平台泄漏、无 Capability 名称分支
  - [x] 记录自治验收证据与 Phase checkpoint

## Phase B：纯合同、绑定与激活门禁 [checkpoint: 89dac9c]

- [x] Task: Red — Native Function deployment contract f6dba38
  - [x] 为 Profile parser 编写合法、缺字段、未知字段、重复 profile 测试
  - [x] 为 handler ref、timeout、retry、network policy 和 payload budget 编写边界测试
  - [x] 覆盖 `network=denied`、cooperative cancellation 与不声称 hard CPU/memory isolation
  - [x] 为 invocation/result/receipt envelope 编写版本与大小限制测试
  - [x] 运行测试并确认预期失败
- [x] Task: Green — 实现部署合同 8b08503
  - [x] 在 `packages/shared/src/deployment/` 增加平台中立的 Native Function Profile 类型
  - [x] 增加严格 parser 和 server-owned profile registry
  - [x] 增加 invocation/result/receipt wire
  - [x] 保持 endpoint、credential、handler 配置不进入 Application Bundle
  - [x] 复跑 targeted tests、typecheck 和 governance
- [x] Task: Red — Capability input binding 16ded47
  - [x] 覆盖 Action 参数来源和 source entity 显式字段来源
  - [x] 覆盖未声明字段、缺字段、跨实体读取和 whole-snapshot 注入拒绝
  - [x] 覆盖最大字段数、深度/节点/bytes 与 wildcard/spread/expression 禁止项
  - [x] 覆盖 binding 后 input schema 二次校验
  - [x] 运行测试并确认预期失败
- [x] Task: Green — 实现纯 binding kernel 4956201
  - [x] 在纯 engine 边界解析声明式 binding
  - [x] 只产生有界、可序列化的 typed input并保留字段来源引用
  - [x] 禁止读取 Work Thread、Sitemap、凭证或任意上下文对象
  - [x] 添加 property tests 验证未声明字段永不进入输入
- [x] Task: Red — Activation invariants 5a6dba6
  - [x] 覆盖 Capability/Profile 缺失与 class 不匹配
  - [x] 覆盖 Function executor 不要求 Agent Definition
  - [x] 覆盖 Agent executor 既有 exact Agent Definition 不退化
  - [x] 覆盖 callback Action 缺失、非 internal、schema 不相容
  - [x] 覆盖 handler 不可用和非法 Bundle 部署字段
  - [x] 运行测试并确认预期失败
- [x] Task: Green — 实现激活门禁 89dac9c
  - [x] 扩展 definition registries 和 invariants
  - [x] 保持检查在 Application activation 前 fail closed
  - [x] Meta checks 投影结构化失败原因
  - [x] 不在 renderer 或服务层重复业务判断
  - [x] 复跑 definition、Draft、activation 回归套件
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 89dac9c
  - [x] 运行 focused unit tests 与 coverage
  - [x] 新 pure modules 覆盖率大于 80%，Safety 路径 100%
  - [x] 运行 typecheck、lint、`pnpm governance`
  - [x] 记录 checkpoint 和验证报告

## Phase C：Web 派发、Temporal 执行与结果回流 [checkpoint: 6fdd581]

- [x] Task: Red — Executor dispatcher b853b90
  - [x] 覆盖 `agent` 继续走现有 Agent dispatch
  - [x] 覆盖 `function` 走新的 Function dispatch
  - [x] 覆盖未知 class、缺 profile 和不可用 handler
  - [x] 断言 preflight 失败时零业务事件、零 Activity 调用
  - [x] 覆盖 prepared invocation 进入 spawn birth detail
  - [x] 覆盖 DB commit 后、workflow start 前 crash 产生可重协调 outbox
  - [x] 断言 dispatcher 不读取 capability name 或 Application name
  - [x] 运行测试并确认预期失败
- [x] Task: Green — 提取通用 dispatch composition c32b500
  - [x] 从 `service.ts` 提取 capability dispatch composition
  - [x] 保留现有 Agent Run 行为不变
  - [x] 增加 Native Function prepare/dispatch port
  - [x] 在 source event append 前完成静态 preflight，append 后按 source seq 派发 Temporal
  - [x] 增加 boot/有界周期 outbox reconciler，幂等启动确定性 workflow ID
  - [x] 避免扩大 `service.ts` 和相关目录体积
- [x] Task: Red — Native Function registry 与 Activity ff1392f
  - [x] 覆盖 handler 注册、唯一解析和无名称特判
  - [x] 覆盖成功、异常、非法输出、超预算、timeout 和 cancellation
  - [x] 覆盖 maximum attempts 和不可重试错误
  - [x] 覆盖 retryable exception、permanent contract failure 与 birth-pinned timeout/retry determinism
  - [x] 覆盖 handler 无 PostgreSQL/Web/EngineSnapshot 依赖
  - [x] 运行测试并确认预期失败
- [x] Task: Green — Worker Native Function Adapter 3e55c30
  - [x] 在 `apps/worker/src/capabilities/function/` 建立最小 registry/adapter
  - [x] handler 只接收 sealed invocation
  - [x] Activity 负责 I/O、校验和结构化结果
  - [x] Workflow 只负责编排，不访问 Node API、数据库或网络
  - [x] 使用确定性 workflow/execution identity，不新增 Capability Run projection
- [x] Task: Red — Finalize 与 callback ingress 1a724d3
  - [x] 覆盖 output schema、receipt/output hash、重复 finalize 和重复 callback
  - [x] 覆盖 stale source、guard/schema rejection
  - [x] 覆盖伪造 source seq、capability hash 和 callback identity
  - [x] 覆盖 mixed-domain single transaction、partial unique index 和同 key 不同 hash collision
  - [x] 覆盖 receipt/callback commit 后、Activity 回包前 crash
  - [x] 覆盖成功 receipt 已保存但业务状态未被非法覆盖
  - [x] 运行测试并确认预期失败
- [x] Task: Green — 实现受治理结果回流 6fdd581
  - [x] 增加部署侧受保护 callback ingress
  - [x] 重新读取 source spawn、Capability birth 和当前实体
  - [x] output 通过 schema 后生成 content hash 和 receipt
  - [x] callback 参数标记 `origin=effect` 并重新执行 declaration → guard → schema
  - [x] receipt 和 callback 结果按已决定的事务协议提交
  - [x] 使用 DB 唯一约束与 advisory lock，不使用 check-then-insert 去重
  - [x] 失败进入声明的 `on-error`，不造业务事实
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 6fdd581
  - [x] 启动真实 PostgreSQL、Temporal、Worker 和 Web
  - [x] 执行成功、异常、非法输出、timeout、cancel 和重复 callback
  - [x] 在 Activity 完成后、finalize 前终止 Worker并验证恢复
  - [x] 验证 orphan spawn 经 reconciler 最终启动且不重复业务效果
  - [x] 运行 DB replay、幂等、coverage、typecheck、lint 和 governance
  - [x] 记录真实 Temporal checkpoint 证据

## Phase D：Security Application 垂直切片 [checkpoint: 4004581]

- [x] Task: Red — Security Application Bundle ae69afe
  - [x] 定义 `cves`、`cve:<id>` 和最小状态机预期
  - [x] 覆盖 `enrich-impact` Action、Capability、callbacks 与状态可达性
  - [x] 覆盖 Application/Sitemap/CLI 发现
  - [x] 断言 Bundle 不含 handler、Temporal 或 credential
  - [x] 运行测试并确认预期失败
- [x] Task: Green — 实现 CVE 参考切片 d244317
  - [x] 增加最小 Security Application 定义和一个 CVE reference entity
  - [x] 增加 `cve.enrich` Capability 与声明式 binding
  - [x] 增加部署侧 reference Native Function handler
  - [x] handler 保持 network-denied、pure/idempotent extract；外部 effect 继续 fail closed
  - [x] 使用受控测试情报，不冒充实时漏洞数据
  - [x] 保持 Application 内容全部由 Bundle 驱动
- [x] Task: Red — Work Thread 与 Presentation e9915bc
  - [x] 覆盖显式 thread attach 后的进行中/成功/失败投影
  - [x] 覆盖未 attach 时不自动扩张成员
  - [x] 覆盖桌面和窄屏无 handler/profile/attempt 泄漏
  - [x] 覆盖 raw/audit 可读取完整 receipt
  - [x] 运行测试并确认预期失败
- [x] Task: Green — 复用通用工作台呈现 e9915bc
  - [x] 通过现有实体状态和事件投影表达能力进展
  - [x] 必要时增加通用 capability status trait，不增加 CVE renderer
  - [x] 普通 UI 只显示任务语言、结果、来源和责任点
  - [x] Meta 显示 Capability contract、profile requirement 和 checks
  - [x] raw/audit 显示执行回执
- [x] Task: Red→Green — 第二 Capability 可扩展性证明 4004581
  - [x] 增加第二个 Native Function fixture
  - [x] 证明只增加定义、profile 和 handler registration
  - [x] 通过静态/测试门禁禁止 capability-name 与 Application-name dispatcher 分支
  - [x] 证明 workstation、Assistant 和通用投影无需修改
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 4004581
  - [x] 执行 renderer、HTTP、CLI 三条真实路径
  - [x] 验证 Security grant 正例、跨 grant 负例、Work Thread 引用和重放
  - [x] 捕获桌面与 390px 证据并目视检查
  - [x] 运行 bundle、service、component、DB 与 E2E focused suites
  - [x] 记录 checkpoint 证据

## Phase E：用户故事验收与 Track 闭环 [checkpoint: f2c52c8]

- [x] Task: S1–S14 自动化验收 8ee8bcf
  - [x] 建立 Story → 测试 → 证据矩阵
  - [x] 人类 renderer 与 CLI/HTTP Agent 路径使用同一 Siren Action
  - [x] 覆盖全部成功、失败、授权、并发、恢复和重放故事
  - [x] Safety 故事达到 100%
- [x] Task: 真实 Assistant 验收 dd4d523
  - [x] 使用配置的真实 LLM 执行“补充这个 CVE 的影响信息”
  - [x] 验证 Assistant 选择 Entity Action，而非直接调用 Native Function
  - [x] 验证失败解释使用业务语言且零副作用
  - [x] 保留真实 provider evidence，不以 fixture 冒充
- [x] Task: 全量质量门 d8a1d3b
  - [x] 运行 `pnpm format:check`
  - [x] 运行 `pnpm check`
  - [x] 运行 `CI=true pnpm e2e`
  - [x] 运行 focused coverage 并核对阈值
  - [x] 运行真实 Temporal crash/retry 与全量 replay
- [x] Task: 产品走查 8ee8bcf
  - [x] 桌面和 390px 完整走查 S1–S14
  - [x] 检查用户是否被迫理解 Native Function 或 Temporal
  - [x] 检查是否增加无意义确认、追状态或页面切换
  - [x] 检查“在等我、在进行、已完成、为什么”是否清晰
  - [x] 将发现项在本 Track 内闭环或明确记录非目标
- [x] Task: Principal Engineering Review a3ebf0d
  - [x] 对照 GOAL、product-vision、DECISIONS 和 AGENTS.md 审查
  - [x] 检查单日志、授权、来源、回调、幂等和依赖方向
  - [x] 检查无每 Application/Capability 特判
  - [x] 将修复作为正式计划任务跟踪并复验

## Review Fixes [checkpoint: f2c52c8]

- [x] Task: Red — 审查发现的边界与恢复回归 d0f70eb
  - [x] 覆盖公开 exec 伪造 internal callback 的拒绝路径
  - [x] 覆盖 outbox 重投已启动 Workflow 时的 invocation hash 对齐
  - [x] 覆盖并发重复 finalize 在裁决前读取已提交 receipt
  - [x] 覆盖非法 output 进入声明的 failure callback
  - [x] 覆盖 Native Function 对外部 effect capability 的 fail-closed 激活
  - [x] 覆盖 Profile payload/limits hash 与实际 binder/hash 上限一致
  - [x] 覆盖 Draft registry、artifact-ref 与跨授权 receipt 审计边界
- [x] Task: Green — 修复并复验审查发现 a3ebf0d
  - [x] internal callback 仅接受部署认证后的 trusted ingress
  - [x] 已启动 Workflow 仅在 memo 中的 invocation hash 一致时视为幂等成功
  - [x] finalize 在 engine 串行队列内二次检查 terminal receipt
  - [x] 激活门拒绝 Native Function `kind=effect`、非法和超预算 schema
  - [x] 删除未使用且可误导为非原子写路径的 persisted-dispatch helper
  - [x] Profile limits 纳入 birth hash，并收紧无法兑现的 payload budget
  - [x] Draft、artifact、审计受众和第二 Adapter 证据闭环
- [x] Task: Review Fixes Verification & Checkpoint f2c52c8
  - [x] 运行 focused tests、coverage、format、typecheck、lint、governance 与全量 tests
  - [x] 复跑真实 Temporal recovery/idempotency 和最终 E2E

- [x] Task: Phase Verification & Track Closure (Refer to workflow.md) f2c52c8
  - [x] 确认 S1–S14 全部有可复跑证据且系统可运行
  - [x] 更新 GOAL/DECISIONS/tech-stack 中实际形成的合同
  - [x] 按 GR5 删除 spike 和 bespoke Track 脚本
  - [x] 归档 Track，并记录未完成的远端 Adapter 后续方向
  - [x] 创建最终 checkpoint 和审计报告
