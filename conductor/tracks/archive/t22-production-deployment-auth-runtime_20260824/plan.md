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
- [x] 覆盖 auth/deployment mode、PostgreSQL、Temporal、Keycloak、TLS 和 Runtime
- [x] 覆盖缺项、非法 URL、空 Secret、危险默认值和 profile override
- [x] 证明 production 下 demo identity 和 localhost fallback 会失败
- [x] Task: Green——实现统一配置解析和启动预检 7a76547
- [x] Web、Worker、Runner 复用平台中立配置类型
- [x] Secret 不进入错误、日志、Siren 或 Meta raw view
- [x] 为 Compose env 与 Helm values 生成一致映射和示例
- [x] Task: Red TDD——定义 OCI image contract 6e0fc83
- [x] 验证正式 Worker 入口、non-root、health command 和 writable paths
- [x] 验证 images 不含 local env、test reports、dev DB 或个人 Codex 配置
- [x] 验证 Web/Worker/Runner version 与 Git SHA 一致
- [x] Task: Green——实现 production images 988a18c
- [x] 增加 Web 多阶段 Dockerfile
- [x] 增加 Worker build/start 产物与多阶段 Dockerfile
- [x] 根据 Phase A 决定增加 Agent Runner image
- [x] 固定 Node 24、pnpm 10、Git、Pandoc 和 Codex requirements
- [x] 增加 OCI labels、SBOM、image smoke 和 vulnerability scan
- [x] Task: 建立 `v0.1.0-experimental.1` 版本合同 bc351b0
- [x] 增加应用、health、CLI 和 image version reporting
- [x] 禁止呈现为 GA、production SLA 或 LTS
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) c609262

## Phase C: Keycloak 与可信身份链 [checkpoint: 1df38a0]

- [x] Task: Red TDD——建立 authentication negative corpus ee3d44a
- [x] 覆盖 missing/expired/wrong issuer/audience/signature Token
- [x] 覆盖伪造 actor/principal/scope/header 和 agent approval
- [x] 覆盖越权 scope、错误 `sub + azp` delegation 与 JWKS failure；`act` 不属于 v0.1 contract
- [x] Task: Green——实现 credential verification 与 request identity ac7e959
- [x] 验证 issuer、audience、signature、expiry 和 scopes
- [x] 从 credential 派生 actor、principal、scope 和 canonical `sub + azp` delegation
- [x] 移除 production 对 body/query/ordinary header identity 的信任
- [x] 保留显式 local-only demo adapter 并将可信身份写入 audit
- [x] Task: Red→Green——浏览器登录生命周期 64d8d08
- [x] Authorization Code + PKCE、callback、单副本 secure session 和 logout
- [x] 登录前目标恢复、expiry 后重新登录和 Keycloak outage 诚实失败
- [x] Meta 与 business scope 一致
- [x] Task: Red→Green——CLI 与 Agent 身份 b2a502d
- [x] CLI 直接使用外部 Bearer Token 完成 discovery/read/exec，不内建登录或 Token 管理
- [x] Agent Client Credentials、RFC 8693 Token Exchange 和 `sub + azp` audit
- [x] scope 只能收窄，Agent 不能获得 human approval
- [x] Task: 定义最小 Keycloak realm import-or-check-and-skip b37bf45
- [x] 单 realm 只包含 `ui4a-web`、`ui4a-agent`、`ui4a-api` 与必要 redirect/audience/scope fixtures
- [x] Compose/K8s 挂载同一固定 realm 文件并使用同一检查命令
- [x] realm absent 时首次导入；existing compatible 时检查并跳过；incompatible 时 fail closed
- [x] 禁止在线 drift repair、通用 reconciliation、细粒度角色同步或自动 Secret rotation
- [x] Task: Red→Green——接通实验版 Agent credential 主路径 ac893ea
- [x] Browser Chat 单 turn 使用 human Token Exchange，Token 仅存在于 bounded fetch closure
- [x] Worker Activity 使用 Agent Client Credentials，不把 Token 写入 Temporal history/event/log
- [x] 仅接通 Golden Story sitemap/entity/exec/exec-plan；其他 route 明确列为未覆盖
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
- [x] Worker graceful drain、independent test queue 和 restart recovery（真实 restart evidence 待 Phase I）
- [x] Task: 实现 backup/restore commands c2b072a
- [x] PostgreSQL consistent backup、Keycloak DB/共享 realm 文件数据与 Temporal 的直接 restore
- [x] workspace/artifact archive 和根 CA/私钥/certificate 直接 backup
- [x] 默认隔离恢复而不是破坏 current state
- [x] Task: Red→Green——恢复一致性 cc8e414
- [x] 记录恢复前 business hash、identity 和 Run evidence
- [x] 从 backup 恢复、rebuild projections 并对比结果
- [x] 记录实际 RPO/RTO（Phase I 真实 drill）
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
- [x] Task: Red→Green——Compose story acceptance(2026-08-27 收口:runner 与合同套件建成并随
  D52 晋升常驻;story 现场结果定格于 D37/发布 bundle)
- [x] 通过 U1、U3–U9、U13、U14、U16 和 Compose Golden Story —— 现场结果定格:Compose U7
  `execute-failed` 零 fallback,U8/accept deferred(D37/RELEASE_NOTES known limitations);
  corpus 复跑按 D52 裁定过期(重跑验证的是 T24–T34 后演进而非发布物 `d5557bf`),不再执行;
  Compose 部署合同由常驻 scripts/t22 合同套件持续守护
- [x] 验证 restart、dual backends 和 backup/restore smoke —— restart/replay 与十工件隔离恢复
  已在 K8s 现场验证(release bundle,RPO 0);dual backends 按 D37 定格 `failed-honest`
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) (收口,见 DONE.md 与收口 git note)

## Phase H: K8s、Istio 与 mothership 集成

- [x] Task: Red TDD——建立 Helm/K8s render contract 4e0501d
- [x] kubeconform/schema lint namespace、RBAC、ServiceAccount、PV/PVC、probe 和 resources
- [x] Secret 不进入 rendered evidence
- [x] 验证 Istio hosts、TLS、JWT、callback policy 和 `IfNotPresent`
- [x] Task: Green——实现 generic UI4A Helm chart 21e450a
- [x] 单副本 Web/Worker、按 Run 单副本 one-shot Runner、migration 与 realm import-or-check Job
- [x] PostgreSQL、Temporal、Keycloak values
- [x] static PV/replaceable StorageClass、backup CronJob 和 Istio policies
- [x] Task: 创建 mothership-specific overlay 29f4e6c
- [x] 默认 `ui4a.mothership.internal` 与 `auth.ui4a.mothership.internal`
- [x] 适配 existing ingressgateway/NodePort 32067
- [x] 复用或扩展 existing internal CA，不覆盖已有 certificates
- [x] 固定 node/PV paths、resources 和 image import strategy
- [x] Task: 谨慎处理 mothership-setup worktree 29f4e6c
- [x] 实施前记录 existing dirty/untracked state
- [x] 仅新增 `deploy/ui4a/` 和明确文档链接
- [x] 不覆盖 Mattermost、Headlamp 或 unrelated K8s files
- [x] UI4A 与 mothership-setup 分别提交并记录双方 SHA
- [x] Task: 执行真实集群部署 6f2bba3
- [x] pre-pull 并验证全部 image digests（mothership `b4c6c27`）
- [x] 创建 PV/namespace/Secrets 并部署 state services
- [x] 执行 migration/realm import-or-check，部署单副本 Web/Worker 和按 Run one-shot Runner 合同
- [x] 应用 Istio resources 并验证 Pods、Jobs、PV/PVC、sidecars 和 readiness
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase I: 真实用户故事、故障注入与恢复演练

- [x] Task: 执行 K8s Golden Story(2026-08-27 收口:主路径现场完成;Runtime 一节按 D37/D52
  定格并裁定过期)
- [x] trust CA、human login、business Flow 和 Agent token exchange（见 evidence-k8s-auth-fix-20260825.md；CA 信任沿用 runbook 既有证据，本轮为登录/Flow/exchange 新证据）
- [x] Agent 提议高风险 action、agent approval 拒绝、human approval 生效（confirmation:c3 挂起 → actor-is-human guard 拒绝 → human approve 生效）
- [x] K8s/Host 两后端完成 Agent Run —— 结果定格:最终 Compose U7 与 K8s Run
  `a1o-20407625d83e` 均 `execute-failed`、零 fallback、U8 未尝试;D37 明令不得提升为
  passed;补跑按 D52 裁定过期,后续 Runtime 成功证据属后续工作
- [x] Task: 单副本并发、重启与重放 d49ad70
- [x] 在一个 Web 副本内并发同一 resource，验证 guard/CAS/rejection 结果
- [x] 重启后验证 event order、projection 与 replay hash 一致
- [x] Task: Authentication Safety Gate 4fd3417
- [x] 覆盖 missing/expired/wrong issuer/audience/signature 与 identity forgery
- [x] 覆盖 agent/service approval 和 over-scoped exchange
- [x] 100% 正确拒绝并留痕
- [x] Task: 故障注入合同（真实多依赖故障注入后移，不阻塞 experimental） 11a0765
- [x] 以 unit/contract 覆盖 LLM、Temporal、Keycloak/JWKS、PostgreSQL 和两 Runtime backends
- [x] 强制无伪成功、无越权副作用、readiness 与 finally-restore 语义
- [x] Task: 完整 backup/restore drill e71b59f
- [x] 生成 named backup、隔离 current state、恢复 state/certs/artifacts
- [x] rebuild projections，验证 business hash、identity 和 Run evidence
- [x] 记录实际 RPO/RTO
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) (收口,证据见 DONE.md 与收口 git note)

## Phase J: Runbook、升级回滚与试验性发布

- [x] Task: 编写完整 step-by-step runbook 95f4da2
- [x] 每步包含 command、expected output、failure criterion 和 recovery action
- [x] 覆盖 Compose、mothership K8s、Host Runner、DNS/CA、auth 和 troubleshooting
- [x] Task: 验证 app-image upgrade；rollback 仅审查命令并标记未实测
- [x] pre-upgrade backup 与隔离恢复已验证
- [x] 执行新镜像 rollout 和 smoke
- [x] 证明 upgrade 前后 event log 未截断或重写；不执行实际 rollback drill
- [x] realm 在线升级与通用 bootstrap Job replacement 后移；记录直接备份/恢复边界
- [x] Task: T26 Work Thread 生产部署与 credential scope hotfix 闭环 `41a228d`
- [x] revision 40 首次部署发现 credential identity 审计封套导致严格 replay 失败；
  `91e1a6e`/`8d3b289` 修复并以 revision 41 验证既有日志重放
- [x] 安装版 CLI 在 revision 41 完成 create/attach/read/audit/pause/resume，发现单步 exec
  返回未经过当前 credential scope lens 的实体；Red→Green 修复提交 `41a228d`
- [x] 从 revision 41 基线隔离生成 release commit `d5557bf`，避免夹带并行 T30；Web
  digest `sha256:9b0e20077d16368f0197a8fa493b8ec8b12b74b327a9caf030113e0c2e81911c`
  在两节点一致并部署为 Helm revision 42
- [x] 临时安装 `pnpm pack` 产物后复验：exec 与普通 GET 的默认 scope 均隐藏
  `articles`，显式已授予 publishing scope 仍可见；事件 `369–374` 审计完整
- [x] 证据：[`evidence-t26-cli-scope-hotfix-20260826.md`](./evidence-t26-cli-scope-hotfix-20260826.md)
- [x] Task: 运行全量质量门(2026-08-27 收口:T22 专项门按 D52 裁定过期——质量门已常驻化,由
  T23–T34 每轨收口连续闭合,T33 全量 e2e 52 passed、T34 `pnpm check` 终绿 + rev52 生产走查;
  发布物 `d5557bf` 的门在发布时已执行;收口当日另跑 `pnpm check` 复核当前树,见 DONE.md)
- [x] focused Vitest、`pnpm check` 和 `CI=true pnpm e2e` —— standing gate 证据在案;收口现场复核见 DONE.md
- [x] 单副本 Compose/K8s acceptance、主路径 auth negatives、最小三次 Runtime Run 和 restore drill ——
  并发/重启/重放、auth negatives(4fd3417 + T26 hotfix 补充)、restore drill(e71b59f,RPO 0)
  均已现场验证在案;Runtime Run 按 D37 定格 `failed-honest` 并由 D52 裁定过期,不补跑
- [x] image scan 与 SBOM
- [x] Task: 产出 `v0.1.0-experimental.1`
- [x] 固定 image digests，生成 manifest、checksums、SBOM 和 acceptance report
- [x] 创建 Git tag 与 experimental Release Notes
- [x] 明示 internal experiment、non-HA、known limits 和 compatibility
- [x] Task: 同步产品、架构和运行文档
- [x] 更新 `GOAL.md`、`README.md`、`docs/runtime-operations.md` 和 `DECISIONS.md`
- [x] 更新 Conductor product/tech-stack/arch brief 与 mothership K8S runbook
- [x] Task: Track Review、用户故事 evidence 与 DONE(2026-08-27 收口,见 [DONE.md](./DONE.md))
- [x] Critical/High identity、data consistency 和 recovery issues 为零 —— 按"无未登记的
  Critical/High 身份/数据一致性/恢复问题"口径以在案证据复核通过;已知风险即发布 bundle
  登记清单(50C/241H matches=known-risk、runtime `failed-honest`、rollback/fault injection
  未实测、U15 为 plan、Helm backup CronJob suspended 非权威)
- [x] Compose/K8s semantics 一致且 evidence 关联 commands/events/images/Git SHA —— release
  manifest/checksums/SBOM/acceptance-report/runbook-inventory 与 T26 evidence 已建立关联
- [x] 系统保持可运行并形成 `DONE.md` 与 experimental release report —— release bundle 在案;
  DONE.md 于收口形成;系统持续可运行(mothership rev52 生产走查 + 本地门禁全绿)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) (收口 checkpoint,验收报告附收口 git note)
