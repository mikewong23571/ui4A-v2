# T22 Acceptance Evidence Contract

## Evidence principles

- 验收记录必须关联 Track、Git SHA、OCI image digest、部署形态、命令、时间和结果。
- Secret、Token、API Key、数据库密码、Cookie、根 CA 私钥和完整敏感 Prompt 不进入 evidence。
- K8s 与 Compose 运行同一核心用户故事 corpus；环境差异必须显式记录。
- 命令退出成功不等于用户故事成功；必须同时检查业务实体、事件、身份、Workflow 与 artifact。
- 所有恢复验证在命名隔离目标执行，禁止以破坏现有环境作为常规测试手段。

## Required evidence sets

### E1 Build provenance

- Web、Worker、Runner image digest。
- Git SHA、Node/pnpm version、OCI labels、SBOM 和 vulnerability scan summary。
- 内网 Nexus push 或 `ctr import` 后的 digest equality。

### E2 Deployment inventory

- Compose service/volume/health 状态。
- K8s nodes、namespace、workloads、Jobs、PVC/PV、Services、Istio resources 和 readiness。
- stateful/UI4A workloads 单副本清单；不得从节点数推导 HA。
- PostgreSQL、Temporal、Keycloak、UI4A 和 Runtime Backend 的版本。

### E3 Identity

- Browser OIDC login/logout/expiry。
- CLI Bearer Token discovery/read/exec。
- Agent Client Credentials、RFC 8693 Token Exchange 与 canonical `sub + azp` delegation；`act`
  不属于 v0.1 验收。
- 无 Token、过期、错误 issuer/audience/signature、伪造 actor/principal/scope 的负向矩阵。
- Agent/service account approval 100% 被拒并留痕。
- 列出通过主路径合同测试的 route/callback 和尚未纳入的入口；禁止将局部证据表述为全面 route
  authentication 或 service-to-service OIDC。

### E4 Runtime matrix

- Coding、Writing、Agent Definition Authoring 分别在 K8s 与 Host Runner 执行。
- birth references、workspace、trajectory、result、verification 和 human decision 对齐。
- cancel、timeout、backend unavailable、Pod eviction/Runner disconnect 的终态与恢复证据。

### E5 Single-replica concurrency and replay

- 一个 Web replica 内并发裁决同一资源。
- 只产生合同允许的成功/拒绝结果，拒绝带原因。
- 事件 seq、投影和重放 Business Snapshot hash 一致。
- 重启后结果一致；多副本 Web/Session 与跨副本 single atom 标记为 deferred。

### E6 Backup and restore

- 命名备份清单、校验和、开始/结束时间与目标路径。
- PostgreSQL、Keycloak、Temporal、artifact/workspace、共享 realm 文件/数据和实验 CA/私钥的直接
  恢复结果。
- 恢复前后关键实体、身份、Run evidence 和 Business Snapshot hash。
- 实测 RPO/RTO；不得宣称未验证的 HA 或灾备指标。

### E7 Runbook replay

- 从干净 Compose 环境逐步复跑。
- 从 mothership 当前集群前置状态逐步复跑。
- 每一步记录预期输出、实际输出、失败判据与恢复动作是否有效。

### E8 Experimental release

- `v0.1.0-experimental.1` tag、release manifest、checksums、image digests 和 release notes。
- 已知限制、非 HA 边界、兼容范围、升级与回滚结果。
- deferred 清单包含多副本、realm 在线升级/漂移修复、细粒度角色同步、自动 Secret rotation、
  `act` 和全面 service-to-service OIDC/全 route 平台化。

## Final gate

Critical/High 身份越权、单副本数据不一致、恢复失败或隐藏手工步骤为零；`pnpm check`、相关 E2E、
单副本 Compose/K8s acceptance、主路径 auth negative corpus、Runtime backend matrix 和恢复演练
全部通过。未验证的 deferred 能力不得进入发布声明。
