# T46 上线证据

## Release 与镜像

- Deployed release：`9b89ffaade5c4dc75e187b8161190bf9e86ca6b4`。
- Build date：`2026-09-01T18:56:35Z`。
- Web：`sha256:cf66195f8f504513be5f40704cb3387fce87b0bccc17799cd1cb128ca8c6e5fb`。
- Worker：`sha256:836ddca7e9dbfe4a321b7934ef1859e04e44f351470b0db6cdffc8f40a613dce`。
- Runner：`sha256:4a5af7d1e5af2e73e884197fb3c0b9fa052bc1567b550a85fc711ebb19a0e219`。
- 三个 OCI revision 均为 release SHA；`COMPOSE_PREFLIGHT_COMPLETED`、
  `COMPOSE_UP_COMPLETED`、`COMPOSE_STATUS_COMPLETED`。
- home 内网 npm/Debian mirrors 当时不可达；实时探测 public registries 200 后，以显式 build args 完成
  同一 Dockerfile 构建。没有把环境 fallback 写入产品代码。

## Realm migration 与备份

- 迁移前 Keycloak database custom dump：0600、`pg_restore --list` 通过，SHA-256
  `692e42f60fedff2a9827cd60c0c6a7c89742ec50072a75f3428450605921175c`。
- pre-v2 realm snapshot：0600，SHA-256
  `28714945906f36a23f8607f4217195597326d5c1a73b8e52242b481ded955e03`。
- 首次 live migration 在创建 client/role 后被内部 admin listener 的 PUT allowlist 拒绝；version/timeouts
  仍为 v1。`9360f642` 只给未发布 `:9443` admin listener 增加 PUT，公网 admin 继续 default-deny。
- partial-v1 retry snapshot：0600，SHA-256
  `d27f71bf3b53c0408088a9b1121de929a2684705b7d5cdbf51568e77316a6923`。
- 幂等 retry 输出 `migrated fromVersion=1 toVersion=2`；后续 realm-bootstrap v2 check 成功。
- 最终 realm：contract v2；offline idle `7776000` 秒、max enabled、max `15552000` 秒。
- `ui4a-cli`：public、Device Grant enabled、Standard/Direct/Service Account disabled、24h access、subject
  mapper、`aud=ui4a-api`，default read/write，optional offline + policy scopes，无 client secret/approve。

## CLI 与真实登录

- Installed binary：`/Users/mike/.local/bin/ui4a`，version `0.1.0-experimental.1`。
- Endpoint config：`/Users/mike/.config/ui4a/config.json`，0600、无 token；base/issuer/client/application
  指向当前 public deployment 和 `development`。
- 真实 Device consent 页面只显示 development/read/write/offline_access；login 返回 access `86400` 秒、
  refresh `7776000` 秒，无 approve。
- 首次真实 refresh 揭示 `security -w` 单 item 约 128 字符截断；旧 item 与 offline consent 已删除。
  `9a8622fd` 改用 Keychain-only generation/chunks，2048 字符真实 round-trip/delete 通过。
- 最终 Keychain manifest：schema 1、UUID generation、8 chunks、refresh 共 737 字符、max chunk 96；
  无 plaintext credential file、argv、stdout/stderr 或仓库 token。
- `auth status` stored=true；`doctor` 的 health/business/meta 均 200，auth source=keychain；`apps list`
  仅 development，`flows list` 为 software-change，`entities get applications` 成功。
- 当前实体动作面只有 `start-implementation`；CLI help/合同没有 approve/reject shortcut，API 单测确认
  `azp=ui4a-cli` 为 Agent、`humanApprovalEligible=false`。

## Deployment acceptance

- 八个长期服务 healthy；Web/Worker/Runner 使用目标 digest。
- `/live` 返回目标 release；OIDC discovery 公开 device/token/revoke endpoints。
- Keycloak + Web restart 后 CLI Keychain refresh 与 doctor 三探针继续成功。
- retained volume identity hash 保持
  `9c1398f8a9f79a648d3ded6b716d8fcd1fa81c42c48724f61a268bc224b13a99`。
- rollout 后 Web/Worker/Edge/Keycloak 最近日志无 error/exception/fatal。
- home Docker build cache `5.112GB` → `0B`；未清理数据卷或已验证 rollback images。
- 本地权威 deployment runbook 与 home mirror SHA-256 均为
  `61a8ee44ec0d71a6d931ca71f404adb7f42b823787e83ce056a84a7fd54c4bb2`；内容无 secret。

## Automated verification

- Phase B focused：176 passed。
- CLI suite：37 passed；新 auth statements 81.81%、functions 84.44%、lines 84.03%。
- migration/Keycloak/Compose/admin-entry/image/runbook focused suites 全绿。
- production Web build、format、workspace typecheck、lint 0 errors、governance strict 全绿。
- 最终 `pnpm check`：494 test files passed、8 skipped；3735 tests passed、15 skipped。
