# T46 实施计划

## Phase A：Disposable Probe 与架构定案 [checkpoint: e079644]

- [x] Task: Keycloak 26.7.1 disposable Device/Offline probe
  - [x] 验证 public device client、discovery endpoints、poll/refresh/revoke 与 token claims
  - [x] 验证 90 天 offline idle、180 天 max、24 小时 access lifespan 的 import/export keys
  - [x] 删除 probe realm/user/client，保存无 secret 证据
- [x] Task: macOS Keychain disposable probe
  - [x] 验证 token 不进入 argv/stdout/stderr 的 add/read/update/delete 调用形态
  - [x] 固定 injectable credential-store adapter 边界，不增加 runtime dependency
- [x] Task: 记录 D63，细化后续计划
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) e079644

## Phase B：Realm、身份与 Edge 合同 Red/Green [checkpoint: e2a5409]

- [x] Task: Red — realm v2 与 CLI Agent identity e2a5409
  - [x] realm client/scopes/lifespans/禁止项合同先失败
  - [x] `azp=ui4a-cli` Agent provenance、no-approve 与负向 claims 先失败
- [x] Task: Green — realm v2 与可信请求身份 e2a5409
  - [x] 更新 realm import/compatibility/deployment config，不恢复 request-owned scope
  - [x] 扩展 production credential policy 与审计 provenance
- [x] Task: Red/Green — Compose/Kubernetes Keycloak device edge e2a5409
  - [x] 固定 GET/POST route allowlist 与 admin/master negative
  - [x] standing Compose/Helm/static projection 同源更新
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) e2a5409

## Phase C：CLI 长期凭证生命周期 Red/Green [checkpoint: 87fb866]

- [x] Task: Red — auth command、device poll 与 credential lifecycle 87fb866
  - [x] `auth login/status/logout` envelope、错误码与无 token 输出
  - [x] pending/slow_down/expiry/cancel/refresh rotation/revoke negatives
- [x] Task: Green — OIDC Device client 与 macOS Keychain store 87fb866
  - [x] discovery、device code、poll、refresh、revoke 实现
  - [x] Keychain 原子替换、权限/平台失败与自动 refresh
- [x] Task: CLI 连接与兼容 87fb866
  - [x] config 增 issuer/clientId，保留 flag/env/config precedence 与外部 Bearer
  - [x] doctor/业务/Draft/audit 命令统一消费 credential provider
- [x] Task: CLI focused coverage、build/pack 与独立 cwd smoke 87fb866
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) 87fb866

## Phase D：Existing Realm 一次性迁移与部署合同

- [ ] Task: Red/Green — versioned additive realm migration
  - [ ] exact v1 precondition、realm export backup、v2 apply、post-check、retry/partial negatives
  - [ ] 新环境 import v2 与既有 home migration 共用同一 canonical client representation
- [ ] Task: runbook、operator evidence 与 recovery instructions
- [ ] Task: focused deployment/auth negatives、Web build、governance、`pnpm check`
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase E：Current Deployment 上线与真实验收

- [ ] Task: 构建 exact SHA linux/amd64 images，更新 home operator digest inventory
- [ ] Task: 备份并迁移 home realm，preflight/up/status，必要的 edge/Caddy reload
- [ ] Task: 安装本地 CLI，写入非 secret endpoint config
- [ ] Task: disposable credential logout/revoke 验收
- [ ] Task: 真实 Device login，doctor/discovery/read/no-approve 与 Keychain 90 天凭证验收
- [ ] Task: 公网、日志、retained volume、重启恢复与 secret absence 验收
- [ ] Task: 更新本地 deployment runbook、同步 home、记录 evidence/DONE 并推送
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
