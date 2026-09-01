# T43 实施计划

基线：Track 初始化提交；实现开始时重新记录 HEAD、工作树、governance 与 focused tests。计划遵循
`intent → initial plan → disposable spike → detailed plan → implementation`，所有正式实现任务执行
Red → Green → Refactor，并按 `conductor/workflow.md` 提交、记录 git notes 与 Phase checkpoint。

## Phase A：用户故事固化与边界探针

- [x] Task: 固化用户故事与验收矩阵 adba00b
  - [x] 复核 S1–S14 的 human、Assistant、CLI、HTTP、Temporal、DB replay 和 browser 证据
  - [x] 明确同一故事的人类/Agent 双执行者路径
  - [x] 标注 Safety 故事必须 100% 通过
- [ ] Task: 建立当前行为 Red 基线
  - [ ] 为无 `agentDefinition` 的 executable Capability 编写失败测试
  - [ ] 固化当前服务层只允许 Agent Run 派发的限制
  - [ ] 固化 `spawn` binding、callback、artifact 和 profile registry 当前语义
  - [ ] 确认 Red 来自缺少 Function Adapter，而非测试环境错误
- [ ] Task: 执行 disposable Native Function spike
  - [ ] 探测 Worker/Temporal Activity 调用本地 handler 的最小路径
  - [ ] 探测 source field/action param 到 Capability input 的声明式 binding
  - [ ] 探测 output schema、payload budget 和结构化 failure
  - [ ] 探测 worker crash、Activity retry 和确定性 execution identity
  - [ ] 探测 callback receipt 与业务 Action 的事务边界
  - [ ] 删除 spike 产品代码，保留测试 fixture、结论和失败证据
- [ ] Task: 固定详细架构
  - [ ] 新增 `architecture.md`
  - [ ] 记录 Capability Port、Native Function Adapter、Temporal 和 callback 的依赖方向
  - [ ] 决定 binding wire、execution identity、receipt event 和 callback 原子性
  - [ ] 在 `DECISIONS.md` 记录新决定后再进入实现
  - [ ] 若需要新增依赖，先更新 `tech-stack.md`；否则明确零新增运行时依赖
  - [ ] 根据 spike 结果修订后续 Phase 任务，不允许未经证据扩大范围
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
  - [ ] 复跑 Red 基线和 spike fixture
  - [ ] 运行 `pnpm governance`
  - [ ] 审查无第二 Run、无平台泄漏、无 Capability 名称分支
  - [ ] 记录自治验收证据与 Phase checkpoint

## Phase B：纯合同、绑定与激活门禁

- [ ] Task: Red — Native Function deployment contract
  - [ ] 为 Profile parser 编写合法、缺字段、未知字段、重复 profile 测试
  - [ ] 为 handler ref、timeout、retry、network policy 和 payload budget 编写边界测试
  - [ ] 为 invocation/result/receipt envelope 编写版本与大小限制测试
  - [ ] 运行测试并确认预期失败
- [ ] Task: Green — 实现部署合同
  - [ ] 在 `packages/shared/src/deployment/` 增加平台中立的 Native Function Profile 类型
  - [ ] 增加严格 parser 和 server-owned profile registry
  - [ ] 增加 invocation/result/receipt wire
  - [ ] 保持 endpoint、credential、handler 配置不进入 Application Bundle
  - [ ] 复跑 targeted tests、typecheck 和 governance
- [ ] Task: Red — Capability input binding
  - [ ] 覆盖 Action 参数来源和 source entity 显式字段来源
  - [ ] 覆盖未声明字段、缺字段、跨实体读取和 whole-snapshot 注入拒绝
  - [ ] 覆盖 binding 后 input schema 二次校验
  - [ ] 运行测试并确认预期失败
- [ ] Task: Green — 实现纯 binding kernel
  - [ ] 在纯 engine 边界解析声明式 binding
  - [ ] 只产生有界、可序列化的 typed input并保留字段来源引用
  - [ ] 禁止读取 Work Thread、Sitemap、凭证或任意上下文对象
  - [ ] 添加 property tests 验证未声明字段永不进入输入
- [ ] Task: Red — Activation invariants
  - [ ] 覆盖 Capability/Profile 缺失与 class 不匹配
  - [ ] 覆盖 Function executor 不要求 Agent Definition
  - [ ] 覆盖 Agent executor 既有 exact Agent Definition 不退化
  - [ ] 覆盖 callback Action 缺失、非 internal、schema 不相容
  - [ ] 覆盖 handler 不可用和非法 Bundle 部署字段
  - [ ] 运行测试并确认预期失败
- [ ] Task: Green — 实现激活门禁
  - [ ] 扩展 definition registries 和 invariants
  - [ ] 保持检查在 Application activation 前 fail closed
  - [ ] Meta checks 投影结构化失败原因
  - [ ] 不在 renderer 或服务层重复业务判断
  - [ ] 复跑 definition、Draft、activation 回归套件
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
  - [ ] 运行 focused unit tests 与 coverage
  - [ ] 新 pure modules 覆盖率大于 80%，Safety 路径 100%
  - [ ] 运行 typecheck、lint、`pnpm governance`
  - [ ] 记录 checkpoint 和验证报告

## Phase C：Web 派发、Temporal 执行与结果回流

- [ ] Task: Red — Executor dispatcher
  - [ ] 覆盖 `agent` 继续走现有 Agent dispatch
  - [ ] 覆盖 `function` 走新的 Function dispatch
  - [ ] 覆盖未知 class、缺 profile 和不可用 handler
  - [ ] 断言 preflight 失败时零业务事件、零 Activity 调用
  - [ ] 断言 dispatcher 不读取 capability name 或 Application name
  - [ ] 运行测试并确认预期失败
- [ ] Task: Green — 提取通用 dispatch composition
  - [ ] 从 `service.ts` 提取 capability dispatch composition
  - [ ] 保留现有 Agent Run 行为不变
  - [ ] 增加 Native Function prepare/dispatch port
  - [ ] 在 source event append 前完成静态 preflight，append 后按 source seq 派发 Temporal
  - [ ] 避免扩大 `service.ts` 和相关目录体积
- [ ] Task: Red — Native Function registry 与 Activity
  - [ ] 覆盖 handler 注册、唯一解析和无名称特判
  - [ ] 覆盖成功、异常、非法输出、超预算、timeout 和 cancellation
  - [ ] 覆盖 maximum attempts 和不可重试错误
  - [ ] 覆盖 handler 无 PostgreSQL/Web/EngineSnapshot 依赖
  - [ ] 运行测试并确认预期失败
- [ ] Task: Green — Worker Native Function Adapter
  - [ ] 在 `apps/worker/src/capabilities/function/` 建立最小 registry/adapter
  - [ ] handler 只接收 sealed invocation
  - [ ] Activity 负责 I/O、校验和结构化结果
  - [ ] Workflow 只负责编排，不访问 Node API、数据库或网络
  - [ ] 使用确定性 workflow/execution identity，不新增 Capability Run projection
- [ ] Task: Red — Finalize 与 callback ingress
  - [ ] 覆盖 output schema、receipt/output hash、重复 finalize 和重复 callback
  - [ ] 覆盖 stale source、guard/schema rejection
  - [ ] 覆盖伪造 source seq、capability hash 和 callback identity
  - [ ] 覆盖成功 receipt 已保存但业务状态未被非法覆盖
  - [ ] 运行测试并确认预期失败
- [ ] Task: Green — 实现受治理结果回流
  - [ ] 增加部署侧受保护 callback ingress
  - [ ] 重新读取 source spawn、Capability birth 和当前实体
  - [ ] output 通过 schema 后生成 content hash 和 receipt
  - [ ] callback 参数标记 `origin=effect` 并重新执行 declaration → guard → schema
  - [ ] receipt 和 callback 结果按已决定的事务协议提交
  - [ ] 失败进入声明的 `on-error`，不造业务事实
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
  - [ ] 启动真实 PostgreSQL、Temporal、Worker 和 Web
  - [ ] 执行成功、异常、非法输出、timeout、cancel 和重复 callback
  - [ ] 在 Activity 完成后、finalize 前终止 Worker并验证恢复
  - [ ] 运行 DB replay、幂等、coverage、typecheck、lint 和 governance
  - [ ] 记录真实 Temporal checkpoint 证据

## Phase D：Security Application 垂直切片

- [ ] Task: Red — Security Application Bundle
  - [ ] 定义 `cves`、`cve:<id>` 和最小状态机预期
  - [ ] 覆盖 `enrich-impact` Action、Capability、callbacks 与状态可达性
  - [ ] 覆盖 Application/Sitemap/CLI 发现
  - [ ] 断言 Bundle 不含 handler、Temporal 或 credential
  - [ ] 运行测试并确认预期失败
- [ ] Task: Green — 实现 CVE 参考切片
  - [ ] 增加最小 Security Application 定义和一个 CVE reference entity
  - [ ] 增加 `cve.enrich` Capability 与声明式 binding
  - [ ] 增加部署侧 reference Native Function handler
  - [ ] 使用受控测试情报，不冒充实时漏洞数据
  - [ ] 保持 Application 内容全部由 Bundle 驱动
- [ ] Task: Red — Work Thread 与 Presentation
  - [ ] 覆盖显式 thread attach 后的进行中/成功/失败投影
  - [ ] 覆盖未 attach 时不自动扩张成员
  - [ ] 覆盖桌面和窄屏无 handler/profile/attempt 泄漏
  - [ ] 覆盖 raw/audit 可读取完整 receipt
  - [ ] 运行测试并确认预期失败
- [ ] Task: Green — 复用通用工作台呈现
  - [ ] 通过现有实体状态和事件投影表达能力进展
  - [ ] 必要时增加通用 capability status trait，不增加 CVE renderer
  - [ ] 普通 UI 只显示任务语言、结果、来源和责任点
  - [ ] Meta 显示 Capability contract、profile requirement 和 checks
  - [ ] raw/audit 显示执行回执
- [ ] Task: Red→Green — 第二 Capability 可扩展性证明
  - [ ] 增加第二个 Native Function fixture
  - [ ] 证明只增加定义、profile 和 handler registration
  - [ ] 通过静态/测试门禁禁止 capability-name 与 Application-name dispatcher 分支
  - [ ] 证明 workstation、Assistant 和通用投影无需修改
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
  - [ ] 执行 renderer、HTTP、CLI 三条真实路径
  - [ ] 验证 Security grant 正例、跨 grant 负例、Work Thread 引用和重放
  - [ ] 捕获桌面与 390px 证据并目视检查
  - [ ] 运行 bundle、service、component、DB 与 E2E focused suites
  - [ ] 记录 checkpoint 证据

## Phase E：用户故事验收与 Track 闭环

- [ ] Task: S1–S14 自动化验收
  - [ ] 建立 Story → 测试 → 证据矩阵
  - [ ] 人类 renderer 与 CLI/HTTP Agent 路径使用同一 Siren Action
  - [ ] 覆盖全部成功、失败、授权、并发、恢复和重放故事
  - [ ] Safety 故事达到 100%
- [ ] Task: 真实 Assistant 验收
  - [ ] 使用配置的真实 LLM 执行“补充这个 CVE 的影响信息”
  - [ ] 验证 Assistant 选择 Entity Action，而非直接调用 Native Function
  - [ ] 验证失败解释使用业务语言且零副作用
  - [ ] 保留真实 provider evidence，不以 fixture 冒充
- [ ] Task: 全量质量门
  - [ ] 运行 `pnpm format:check`
  - [ ] 运行 `pnpm check`
  - [ ] 运行 `CI=true pnpm e2e`
  - [ ] 运行 focused coverage 并核对阈值
  - [ ] 运行真实 Temporal crash/retry 与全量 replay
- [ ] Task: 产品走查
  - [ ] 桌面和 390px 完整走查 S1–S14
  - [ ] 检查用户是否被迫理解 Native Function 或 Temporal
  - [ ] 检查是否增加无意义确认、追状态或页面切换
  - [ ] 检查“在等我、在进行、已完成、为什么”是否清晰
  - [ ] 将发现项在本 Track 内闭环或明确记录非目标
- [ ] Task: Principal Engineering Review
  - [ ] 对照 GOAL、product-vision、DECISIONS 和 AGENTS.md 审查
  - [ ] 检查单日志、授权、来源、回调、幂等和依赖方向
  - [ ] 检查无每 Application/Capability 特判
  - [ ] 将修复作为正式计划任务跟踪并复验
- [ ] Task: Phase Verification & Track Closure (Refer to workflow.md)
  - [ ] 确认 S1–S14 全部有可复跑证据且系统可运行
  - [ ] 更新 GOAL/DECISIONS/tech-stack 中实际形成的合同
  - [ ] 按 GR5 删除 spike 和 bespoke Track 脚本
  - [ ] 归档 Track，并记录未完成的远端 Adapter 后续方向
  - [ ] 创建最终 checkpoint 和审计报告
