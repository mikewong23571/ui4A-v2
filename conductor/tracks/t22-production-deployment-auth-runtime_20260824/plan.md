# T22 生产形态部署、身份认证与双后端 Agent Runtime — Plan

> 遵循 `conductor/workflow.md` 的 Story TDD、任务提交、Git notes 和 Phase Checkpoint 协议。
> Compose 与 K8s 必须消费同一运行合同并运行同一核心用户故事 corpus。目标发布为
> `v0.1.0-experimental.1`，不宣称 GA、正式 SLA 或当前实验集群具备未经验证的 HA。

## Phase A: 红线、平台探测与架构决策 [checkpoint: f50b8af]

- [x] Task: 建立 U1–U17、Golden Story、负向安全矩阵和 evidence schema f2f1854
- [x] 编写 technical stories 与初始红线验收 corpus
- [x] 固定 Compose/K8s 共用结果断言，不固定 Helm 输出或模型措辞
- [x] 记录身份、事件、Workflow、Agent Run、备份和恢复前后 hash
- [x] Task: 对 mothership 集群执行只读生产前探测 d16f1ca
- [x] 记录节点、污点、资源、Istio Gateway、NodePort、DNS、证书和 namespace
- [x] 确认无 StorageClass，盘点 static/local PV 或 provisioner 方案
- [x] 探测 Nexus 中 Node、PostgreSQL、Temporal、Keycloak 和 Runtime images
- [x] 验证 `ctr --all-platforms`、`IfNotPresent` 和 image export/import
- [x] Task: 运行 disposable 认证探针 246c295
- [x] 验证 Keycloak Authorization Code + PKCE、CLI Bearer 和 Client Credentials
- [x] 验证 RFC 8693 Token Exchange 与 `act` claim
- [x] 比较应用 JWT 验证与 Istio RequestAuthentication 职责
- [x] Task: 运行 disposable Runtime Backend 探针 cb633a6
- [x] 验证 Temporal Worker 创建、观察和取消 K8s Job
- [x] 验证 one-shot Runner 与 host daemon 的统一 task envelope
- [x] 验证 workspace、result、cancel、timeout 和 disconnect recovery
- [x] 决定是否新增 `apps/agent-runner` 及进程模式
- [x] Task: 运行 PostgreSQL 与 Temporal 生产拓扑探针 9a0dc7b
- [x] 验证跨 Web Pod PostgreSQL advisory/transaction lock
- [x] 验证显式 migration Job
- [x] 验证 Temporal namespace、persistence 和 Worker drain
- [x] 选择无 StorageClass 环境的 stateful installation 方式
- [x] Task: 记录绑定架构决定 eea720b
- [x] 在 `DECISIONS.md` 记录真实身份、部署合同、实验非 HA 和恢复边界
- [x] 记录双 Runtime Backend、跨副本裁决和 experimental release 策略
- [x] 新增依赖或工具前更新 `conductor/tech-stack.md`
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) f50b8af

## Phase B: 生产配置、构建和版本基座 [checkpoint: c609262]

- [x] Task: Red TDD——定义生产配置 schema 72d54d1
- [ ] 覆盖 auth/deployment mode、PostgreSQL、Temporal、Keycloak、TLS 和 Runtime
- [ ] 覆盖缺项、非法 URL、空 Secret、危险默认值和 profile override
- [ ] 证明 production 下 demo identity 和 localhost fallback 会失败
- [x] Task: Green——实现统一配置解析和启动预检 7a76547
- [ ] Web、Worker、Runner 复用平台中立配置类型
- [ ] Secret 不进入错误、日志、Siren 或 Meta raw view
- [ ] 为 Compose env 与 Helm values 生成一致映射和示例
- [x] Task: Red TDD——定义 OCI image contract 6e0fc83
- [ ] 验证正式 Worker 入口、non-root、health command 和 writable paths
- [ ] 验证 images 不含 local env、test reports、dev DB 或个人 Codex 配置
- [ ] 验证 Web/Worker/Runner version 与 Git SHA 一致
- [x] Task: Green——实现 production images 988a18c
- [ ] 增加 Web 多阶段 Dockerfile
- [ ] 增加 Worker build/start 产物与多阶段 Dockerfile
- [ ] 根据 Phase A 决定增加 Agent Runner image
- [ ] 固定 Node 24、pnpm 10、Git、Pandoc 和 Codex requirements
- [ ] 增加 OCI labels、SBOM、image smoke 和 vulnerability scan
- [x] Task: 建立 `v0.1.0-experimental.1` 版本合同 bc351b0
- [ ] 增加应用、health、CLI 和 image version reporting
- [ ] 禁止呈现为 GA、production SLA 或 LTS
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) c609262

## Phase C: Keycloak 与可信身份链

- [x] Task: Red TDD——建立 authentication negative corpus ee3d44a
- [ ] 覆盖 missing/expired/wrong issuer/audience/signature Token
- [ ] 覆盖伪造 actor/principal/scope/header 和 agent approval
- [ ] 覆盖 malformed/over-scoped `act` chain 与 JWKS failure
- [x] Task: Green——实现 credential verification 与 request identity ac7e959
- [ ] 验证 issuer、audience、signature、expiry 和 scopes
- [ ] 从 credential 派生 actor、principal、scope 和 delegation chain
- [ ] 移除 production 对 body/query/ordinary header identity 的信任
- [ ] 保留显式 local-only demo adapter 并将可信身份写入 audit
- [ ] Task: Red→Green——浏览器登录生命周期
- [ ] Authorization Code + PKCE、callback、secure session、refresh 和 logout
- [ ] 登录前目标恢复、multi-tab、expiry 和 Keycloak outage
- [ ] Meta 与 business scope 一致
- [ ] Task: Red→Green——CLI 与 Agent 身份
- [ ] CLI Bearer discovery/read/exec
- [ ] Client Credentials、RFC 8693 Token Exchange 和 `act` audit
- [ ] scope 只能收窄，Agent 不能获得 human approval
- [ ] Task: 定义可重复 Keycloak realm bootstrap
- [ ] Realm、clients、redirect URIs、roles、scopes 和 test users
- [ ] Compose/K8s 使用同一 realm contract
- [ ] 重复导入幂等且不覆盖已有用户数据
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase D: 显式迁移、跨副本裁决和健康语义

- [ ] Task: Red TDD——建立 migration contract
- [ ] 覆盖 empty/existing DB、rerun、concurrent run、partial failure 和 incompatible version
- [ ] 验证 runtime role 无 DDL 权限
- [ ] Task: Green——实现 versioned migration command
- [ ] 从 production request path 移出 DDL
- [ ] 增加 migration history 与 advisory lock
- [ ] migration failure 阻止 readiness
- [ ] bootstrap 与 replay integrity 显式执行
- [ ] Task: Red TDD——复现两个 Web replicas 的 stale judgment
- [ ] 覆盖同一 resource、confirmation/draft decision、worker event gap 和 Pod restart
- [ ] 先证明 current in-process queue 不足
- [ ] Task: Green——实现 database-level single atom
- [ ] PostgreSQL transaction/lock 覆盖 refresh → judgment → append → projection
- [ ] 保持 declaration → guard → schema 顺序和 rejection audit
- [ ] 跨 replicas 只有合法结果成功且 replay hash 一致
- [ ] Task: Red→Green——实现 health/readiness
- [ ] `/live` 只表达 process life
- [ ] `/ready` 检查 DB、migration 和 required config
- [ ] 独立报告 Temporal、Keycloak、LLM 和 Runtime dependencies
- [ ] degraded 不进入 Ready；Worker 暴露 readiness/drain
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase E: PostgreSQL、Temporal、持久化与灾备合同

- [ ] Task: Red TDD——定义 stateful deployment 与 restore fixtures
- [ ] 覆盖 PostgreSQL、Temporal、Keycloak、events、payloads 和 workflow history
- [ ] 覆盖 Coding/Writing/Authoring artifacts 与实验 CA
- [ ] Task: 实现 PostgreSQL 17 deployment contract
- [ ] K8s static PV/selected provisioner 与 Compose named volume
- [ ] migration/runtime/backup roles、resources、probes 和 backup Job
- [ ] 不声称未经验证 HA
- [ ] Task: Red→Green——Temporal production config
- [ ] 可配置 address、namespace、task queue、identity 和 connection options
- [ ] Temporal Server 使用 PostgreSQL persistence
- [ ] Worker graceful drain、independent test queue 和 restart recovery
- [ ] Task: 实现 backup/restore commands
- [ ] PostgreSQL consistent backup、Keycloak realm/DB 与 Temporal restore
- [ ] workspace/artifact archive 和 CA/certificate backup
- [ ] 默认隔离恢复而不是破坏 current state
- [ ] Task: Red→Green——恢复一致性
- [ ] 记录恢复前 business hash、identity 和 Run evidence
- [ ] 从 backup 恢复、rebuild projections 并对比结果
- [ ] 记录实际 RPO/RTO
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase F: 双后端 Agent Runtime

- [ ] Task: Red TDD——定义统一 Runtime Backend SPI
- [ ] immutable Run/birth references 与 prepare/execute/collect/verify/finalize
- [ ] heartbeat、lease、cancel、timeout、restart boundary 和 canonical result
- [ ] 拒绝 request backend/image/cwd/provider/model/env override
- [ ] Task: Green——抽离 common Runner process
- [ ] one-shot container mode 与 trusted host daemon mode
- [ ] 与 generic Host lifecycle 和 specialization verifier 分离
- [ ] Secret 仅在 authorized Run 生命周期可见
- [ ] Task: Red→Green——K8s Job Backend
- [ ] per-Run Job/Pod、fixed image/ServiceAccount/resources/network/workspace
- [ ] watch、heartbeat、cancel、TTL、eviction 和 duplicate callback
- [ ] human decision 前保留 Coding workspace
- [ ] Task: Red→Green——Host Runner Backend
- [ ] server-owned registry、identity、heartbeat、lease 和 fixed roots
- [ ] disconnect、cancel、duplicate delivery 与 invalid path
- [ ] 禁止向更宽权限 backend fallback
- [ ] Task: 运行双后端等价 corpus
- [ ] Coding、Writing 和 Agent Definition Authoring canonical tasks
- [ ] 对齐 Agent Run、artifact、verification 和 human decision
- [ ] Provider unavailable 时零 fallback
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase G: Docker Compose all-in-one

- [ ] Task: Red TDD——编写 Compose contract tests
- [ ] 验证 config schema、Secrets、volumes、health、dependency 和 restart
- [ ] 验证 image digest、idempotent restart、data retention 和 confirmed clean
- [ ] Task: Green——实现 all-in-one stack
- [ ] PostgreSQL、Temporal Server/UI、Keycloak 和 migration/bootstrap
- [ ] UI4A Web/Worker、container Runner 和 optional Host Runner profile
- [ ] Task: 实现 Compose internal TLS
- [ ] 首次生成并持久化 experiment root CA
- [ ] 两个 local hosts/leaf certs，重复启动不覆盖
- [ ] client trust 与 OIDC issuer/redirect/logout 验证
- [ ] Task: Red→Green——Compose story acceptance
- [ ] 通过 U1、U3–U9、U13、U14、U16 和 Compose Golden Story
- [ ] 验证 restart、dual backends 和 backup/restore smoke
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase H: K8s、Istio 与 mothership 集成

- [ ] Task: Red TDD——建立 Helm/K8s render contract
- [ ] kubeconform/schema lint namespace、RBAC、ServiceAccount、PV/PVC、probe、resources 和 PDB
- [ ] Secret 不进入 rendered evidence
- [ ] 验证 Istio hosts、TLS、JWT、callback policy 和 `IfNotPresent`
- [ ] Task: Green——实现 generic UI4A Helm chart
- [ ] Web、Worker、Runner、migration/bootstrap Job
- [ ] PostgreSQL、Temporal、Keycloak values
- [ ] static PV/replaceable StorageClass、backup CronJob 和 Istio policies
- [ ] Task: 创建 mothership-specific overlay
- [ ] 默认 `ui4a.mothership.internal` 与 `auth.ui4a.mothership.internal`
- [ ] 适配 existing ingressgateway/NodePort 32067
- [ ] 复用或扩展 existing internal CA，不覆盖已有 certificates
- [ ] 固定 node/PV paths、resources 和 image import strategy
- [ ] Task: 谨慎处理 mothership-setup worktree
- [ ] 实施前记录 existing dirty/untracked state
- [ ] 仅新增 `deploy/ui4a/` 和明确文档链接
- [ ] 不覆盖 Mattermost、Headlamp 或 unrelated K8s files
- [ ] UI4A 与 mothership-setup 分别提交并记录双方 SHA
- [ ] Task: 执行真实集群部署
- [ ] pre-pull 并验证全部 image digests
- [ ] 创建 PV/namespace/Secrets 并部署 state services
- [ ] 执行 migration/bootstrap，部署 Web/Worker/Runner
- [ ] 应用 Istio resources 并验证 Pods、Jobs、PV/PVC、sidecars 和 readiness
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase I: 真实用户故事、故障注入与恢复演练

- [ ] Task: 执行 K8s Golden Story
- [ ] trust CA、human login、business Flow 和 Agent token exchange
- [ ] Agent 提议高风险 action、agent approval 拒绝、human approval 生效
- [ ] K8s/Host 两后端完成 Agent Run
- [ ] Task: 两副本并发与重放
- [ ] scale Web to two replicas 并并发同一 resource
- [ ] 验证一成功一拒绝、restart 后 replay hash 一致
- [ ] Task: Authentication Safety Gate
- [ ] 覆盖 missing/expired/wrong issuer/audience/signature 与 identity forgery
- [ ] 覆盖 agent/service approval 和 over-scoped exchange
- [ ] 100% 正确拒绝并留痕
- [ ] Task: 故障注入
- [ ] LLM、Temporal、Keycloak/JWKS、PostgreSQL 和两 Runtime backends
- [ ] 无伪成功、无越权副作用、readiness 正确
- [ ] Task: 完整 backup/restore drill
- [ ] 生成 named backup、隔离 current state、恢复 state/certs/artifacts
- [ ] rebuild projections，验证 business hash、identity 和 Run evidence
- [ ] 记录实际 RPO/RTO
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase J: Runbook、升级回滚与试验性发布

- [ ] Task: 编写完整 step-by-step runbook
- [ ] 每步包含 command、expected output、failure criterion 和 recovery action
- [ ] 覆盖 Compose、mothership K8s、Host Runner、DNS/CA、auth 和 troubleshooting
- [ ] Task: 验证 upgrade 与 rollback
- [ ] pre-upgrade backup、compatible migration、rollout 和 smoke
- [ ] rollback images/data 并验证 event log 未截断或重写
- [ ] Task: 运行全量质量门
- [ ] focused Vitest、`pnpm check` 和 `CI=true pnpm e2e`
- [ ] Compose/K8s acceptance、auth negatives、runtime matrix 和 restore drill
- [ ] image scan 与 SBOM
- [ ] Task: 产出 `v0.1.0-experimental.1`
- [ ] 固定 image digests，生成 manifest、checksums、SBOM 和 acceptance report
- [ ] 创建 Git tag 与 experimental Release Notes
- [ ] 明示 internal experiment、non-HA、known limits 和 compatibility
- [ ] Task: 同步产品、架构和运行文档
- [ ] 更新 `GOAL.md`、`README.md`、`docs/runtime-operations.md` 和 `DECISIONS.md`
- [ ] 更新 Conductor product/tech-stack/arch brief 与 mothership K8S runbook
- [ ] Task: Track Review、用户故事 evidence 与 DONE
- [ ] Critical/High identity、data consistency 和 recovery issues 为零
- [ ] Compose/K8s semantics 一致且 evidence 关联 commands/events/images/Git SHA
- [ ] 系统保持可运行并形成 `DONE.md` 与 experimental release report
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
