# T22 生产形态部署、身份认证与双后端 Agent Runtime — Plan

> 遵循 `conductor/workflow.md` 的 Story TDD、任务提交、Git notes 和 Phase Checkpoint 协议。
> Compose 与 K8s 必须消费同一运行合同并运行同一核心用户故事 corpus。目标发布为
> `v0.1.0-experimental.1`，不宣称 GA、正式 SLA 或当前实验集群具备未经验证的 HA。
> D35 将发布主路径收敛为全组件单副本、单 Keycloak realm/三 clients、`sub + azp`
> delegation 和 realm import-or-check-and-skip；多副本/HA、`act`、在线 realm reconciliation、
> 自动 rotation 与全面 service-to-service OIDC 均为后续 Track。

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
- [x] 验证 RFC 8693 Token Exchange，并记录 exchange 不产生稳定 `act` 的探针事实
- [x] 比较应用 JWT 验证与 Istio RequestAuthentication 职责
- [x] Task: 运行 disposable Runtime Backend 探针 cb633a6
- [x] 验证 Temporal Worker 创建、观察和取消 K8s Job
- [x] 验证 one-shot Runner 与 host daemon 的统一 task envelope
- [x] 验证 workspace、result、cancel、timeout 和 disconnect recovery
- [x] 决定是否新增 `apps/agent-runner` 及进程模式
- [x] Task: 运行 PostgreSQL 与 Temporal 生产拓扑探针 9a0dc7b
- [x] 验证 PostgreSQL advisory/transaction lock 的未来跨副本可行性（非 v0.1 gate）
- [x] 验证显式 migration Job
- [x] 验证 Temporal namespace、persistence 和 Worker drain
- [x] 选择无 StorageClass 环境的 stateful installation 方式
- [x] Task: 记录绑定架构决定 eea720b
- [x] 在 `DECISIONS.md` 记录真实身份、部署合同、实验非 HA 和恢复边界
- [x] 记录双 Runtime Backend、当时的跨副本方案和 experimental release 策略（后由 D35 收缩）
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

## Phase C: Keycloak 与可信身份链 [checkpoint: 1df38a0]

- [x] Task: Red TDD——建立 authentication negative corpus ee3d44a
- [ ] 覆盖 missing/expired/wrong issuer/audience/signature Token
- [ ] 覆盖伪造 actor/principal/scope/header 和 agent approval
- [ ] 覆盖越权 scope、错误 `sub + azp` delegation 与 JWKS failure；`act` 不属于 v0.1 contract
- [x] Task: Green——实现 credential verification 与 request identity ac7e959
- [ ] 验证 issuer、audience、signature、expiry 和 scopes
- [ ] 从 credential 派生 actor、principal、scope 和 canonical `sub + azp` delegation
- [ ] 移除 production 对 body/query/ordinary header identity 的信任
- [ ] 保留显式 local-only demo adapter 并将可信身份写入 audit
- [x] Task: Red→Green——浏览器登录生命周期 64d8d08
- [ ] Authorization Code + PKCE、callback、单副本 secure session 和 logout
- [ ] 登录前目标恢复、expiry 后重新登录和 Keycloak outage 诚实失败
- [ ] Meta 与 business scope 一致
- [x] Task: Red→Green——CLI 与 Agent 身份 b2a502d
- [ ] CLI 直接使用外部 Bearer Token 完成 discovery/read/exec，不内建登录或 Token 管理
- [ ] Agent Client Credentials、RFC 8693 Token Exchange 和 `sub + azp` audit
- [ ] scope 只能收窄，Agent 不能获得 human approval
- [x] Task: 定义最小 Keycloak realm import-or-check-and-skip b37bf45
- [ ] 单 realm 只包含 `ui4a-web`、`ui4a-agent`、`ui4a-api` 与必要 redirect/audience/scope fixtures
- [ ] Compose/K8s 挂载同一固定 realm 文件并使用同一检查命令
- [ ] realm absent 时首次导入；existing compatible 时检查并跳过；incompatible 时 fail closed
- [ ] 禁止在线 drift repair、通用 reconciliation、细粒度角色同步或自动 Secret rotation
- [x] Task: Red→Green——接通实验版 Agent credential 主路径 ac893ea
- [ ] Browser Chat 单 turn 使用 human Token Exchange，Token 仅存在于 bounded fetch closure
- [ ] Worker Activity 使用 Agent Client Credentials，不把 Token 写入 Temporal history/event/log
- [ ] 仅接通 Golden Story sitemap/entity/exec/exec-plan；其他 route 明确列为未覆盖
- [x] Task: Principal review 修正——收口 Golden 身份与 realm 不变式 1df38a0
- [x] 绑定 policy scope 与目标 Application，防止跨 scope sitemap/read/exec/plan
- [x] Token Exchange 不得扩大 subject scopes，结果必须保持 human `sub` + `ui4a-agent` `azp`
- [x] Bearer 禁止明文 HTTP，OIDC/JWKS 禁止 redirect，单进程 session store 有界
- [x] canonical config、固定 realm/client/scope 与 Secret refs 完全一致
- [x] 对 agent/service human-only approval 保留可审计拒绝证据，补齐 CLI 403 与 session restart 负例
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 1df38a0
- [x] 仅要求 Golden Story、CLI/Agent 合同主路径与负向身份 corpus 通过
- [x] 列出未纳入的 route/callback；不以“全面 route auth 已完成”作为 v0.1 gate

## Phase D: 显式迁移、单副本重放和健康语义 [checkpoint: 4fb024b]

- [x] Task: Red TDD——建立 migration contract 2b73fec
- [x] 覆盖 empty/existing DB、rerun、concurrent run、partial failure 和 incompatible version
- [x] 验证 runtime role 无 DDL 权限
- [x] Task: Green——实现 versioned migration command ae854e9
- [x] 从 production request path 移出 DDL
- [x] 增加 migration history 与 advisory lock
- [x] migration failure 阻止 readiness
- [x] bootstrap 与 replay integrity 显式执行
- [x] Task: Red→Green——验证单 Web 副本命令与重放完整性 d0e6874
- [x] 覆盖同一 resource 的进程内并发、confirmation/draft decision、worker event gap 和 Pod restart
- [x] 保持 declaration → guard → schema、CAS、rejection audit、event order 与 replay hash
- [x] 明确记录多副本 Web/Session 和跨副本 database-level single atom 为 deferred
- [x] Task: Red→Green——实现 health/readiness 4fb024b
- [x] `/live` 只表达 process life
- [x] `/ready` 检查 DB、migration 和 required config
- [x] 独立报告 Temporal、Keycloak、LLM 和 Runtime dependencies
- [x] degraded 不进入 Ready；Worker 暴露 readiness/drain
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 4fb024b

## Phase E: PostgreSQL、Temporal、持久化与灾备合同 [checkpoint: cc8e414]

- [x] Task: Red TDD——定义 stateful deployment 与 restore fixtures 8db59ea
- [x] 覆盖 PostgreSQL、Temporal、Keycloak、events、payloads 和 workflow history
- [x] 覆盖 Coding/Writing/Authoring artifacts 与实验 CA
- [x] Task: 实现 PostgreSQL 17 deployment contract dc6fcdb
- [x] K8s static PV/selected provisioner 与 Compose named volume
- [x] migration/runtime/backup roles、resources、probes 和 backup Job
- [x] 不声称未经验证 HA
- [x] Task: Red→Green——Temporal production config f7aa88d
- [x] 可配置 address、namespace、task queue、identity 和 connection options
- [x] Temporal Server 使用 PostgreSQL persistence
- [ ] Worker graceful drain、independent test queue 和 restart recovery（真实 restart evidence 待 Phase I）
- [x] Task: 实现 backup/restore commands c2b072a
- [x] PostgreSQL consistent backup、Keycloak DB/共享 realm 文件数据与 Temporal 的直接 restore
- [x] workspace/artifact archive 和根 CA/私钥/certificate 直接 backup
- [x] 默认隔离恢复而不是破坏 current state
- [x] Task: Red→Green——恢复一致性 cc8e414
- [x] 记录恢复前 business hash、identity 和 Run evidence
- [x] 从 backup 恢复、rebuild projections 并对比结果
- [ ] 记录实际 RPO/RTO（Phase I 真实 drill）
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) cc8e414

## Phase F: 双后端 Agent Runtime [checkpoint: ae25036]

- [x] Task: Red TDD——定义统一 Runtime Backend SPI f891fa5
- [x] immutable Run/birth references 与 prepare/execute/collect/verify/finalize
- [x] heartbeat、lease、cancel、timeout、restart boundary 和 canonical result
- [x] 拒绝 request backend/image/cwd/provider/model/env override
- [x] Task: Green——抽离 common Runner process dc0b40b
- [x] one-shot container mode 与 trusted host daemon mode
- [x] 与 generic Host lifecycle 和 specialization verifier 分离
- [x] Secret 仅在 authorized Run 生命周期可见
- [x] Task: Red→Green——K8s Job Backend 9f0ee11
- [x] per-Run Job/Pod、fixed image/ServiceAccount/resources/network/workspace
- [x] watch、heartbeat、cancel、TTL、eviction 和 duplicate callback
- [x] human decision 前保留 Coding workspace
- [x] Task: Red→Green——Host Runner Backend 869b5a2
- [x] server-owned registry、identity、heartbeat、lease 和 fixed roots
- [x] disconnect、cancel、duplicate delivery 与 invalid path
- [x] 禁止向更宽权限 backend fallback
- [x] Task: 运行双后端等价 corpus ae25036
- [x] Coding、Writing 和 Agent Definition Authoring canonical tasks
- [x] 对齐 Agent Run、artifact、verification 和 human decision
- [x] Provider unavailable 时零 fallback
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) ae25036

## Phase G: Docker Compose all-in-one

- [x] Task: Red TDD——编写 Compose contract tests 880dcf9
- [x] 验证 config schema、Secrets、volumes、health、dependency 和 restart
- [x] 验证 image digest、idempotent restart、data retention 和 confirmed clean
- [x] Task: Green——实现 all-in-one stack 7e23e03
- [x] PostgreSQL、Temporal Server/UI、单实例 Keycloak 和 migration/realm import-or-check
- [x] UI4A Web/Worker、container Runner 和 optional Host Runner profile
- [x] Task: 实现 Compose internal TLS 0d1f5ed
- [x] 首次生成并持久化 experiment root CA
- [x] 两个 local hosts/leaf certs，重复启动不覆盖
- [x] client trust 与 OIDC issuer/redirect/logout 验证
- [ ] Task: Red→Green——Compose story acceptance
- [ ] 通过 U1、U3–U9、U13、U14、U16 和 Compose Golden Story
- [ ] 验证 restart、dual backends 和 backup/restore smoke
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase H: K8s、Istio 与 mothership 集成

- [ ] Task: Red TDD——建立 Helm/K8s render contract
- [ ] kubeconform/schema lint namespace、RBAC、ServiceAccount、PV/PVC、probe 和 resources
- [ ] Secret 不进入 rendered evidence
- [ ] 验证 Istio hosts、TLS、JWT、callback policy 和 `IfNotPresent`
- [ ] Task: Green——实现 generic UI4A Helm chart
- [ ] 单副本 Web/Worker/Runner、migration 与 realm import-or-check Job
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
- [ ] 执行 migration/realm import-or-check，部署单副本 Web/Worker/Runner
- [ ] 应用 Istio resources 并验证 Pods、Jobs、PV/PVC、sidecars 和 readiness
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase I: 真实用户故事、故障注入与恢复演练

- [ ] Task: 执行 K8s Golden Story
- [ ] trust CA、human login、business Flow 和 Agent token exchange
- [ ] Agent 提议高风险 action、agent approval 拒绝、human approval 生效
- [ ] K8s/Host 两后端完成 Agent Run
- [ ] Task: 单副本并发、重启与重放
- [ ] 在一个 Web 副本内并发同一 resource，验证 guard/CAS/rejection 结果
- [ ] 重启后验证 event order、projection 与 replay hash 一致
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
- [ ] realm 在线升级不在本版本演练；记录直接备份/恢复和重建边界
- [ ] Task: 运行全量质量门
- [ ] focused Vitest、`pnpm check` 和 `CI=true pnpm e2e`
- [ ] 单副本 Compose/K8s acceptance、主路径 auth negatives、runtime matrix 和 restore drill
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
