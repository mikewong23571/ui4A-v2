# T46 CLI Device Credential 与长期 Agent 访问

## Overview

当前 deployment 已有可信浏览器 OIDC 和 Bearer API，但 `ui4a` CLI 只消费外部 token，既未安装到
本地 Mac，也没有可用的登录、续期和撤销路径。T46 为私人 UI4A deployment 增加 Keycloak 原生
Device Authorization + Offline Access，使外部 Agent 可在用户一次浏览器确认后长期使用 CLI，仍由
UI4A 机械授权、审计和 human-only approval 约束。

## Functional Requirements

- Keycloak 增加 public client `ui4a-cli`：只开启 Device Authorization；关闭 client authentication、
  Standard Flow、Direct Access Grants、Service Account 和 Standard Token Exchange。
- `ui4a-cli` token 固定 audience `ui4a-api`，只允许 `ui4a:read`、`ui4a:write`、`offline_access` 与
  凭证授予的 Applications；永不包含 `ui4a:approve`。
- CLI credential 的 client offline idle 为 90 天、max 为 180 天；access token lifespan 为 24 小时。
  用户日常不需要重新登录，仍可在 Account Console 或 CLI logout 主动撤销。
- API 将已验证的 `azp=ui4a-cli` 识别为 Agent 通道：principal 来自 `sub`，actor 为 `agent`，
  `humanApprovalEligible=false`，provenance 明示 Device Authorization；请求字段不能覆盖身份或授权。
- CLI 增加 `auth login/status/logout`。登录按 discovery/device-code/poll 协议执行；遵守 interval、
  `authorization_pending`、`slow_down`、expiry 和取消语义。
- offline/refresh token 只进入 macOS Keychain；access token 只进内存。config、stdout、stderr、进程参数、
  Git 和部署文档不得出现 token。CLI 自动刷新并轮换 Keychain 中的 refresh/offline token。
- 现有 `--token`/`UI4A_TOKEN` Bearer 消费路径和 local demo 行为保持不变；非 macOS 上未配置外部 token
  时，auth 命令诚实报告 credential store 不可用。
- Compose 与 Kubernetes edge 只增补固定 realm 的 device authorization/verification 必需路由，继续
  禁止 admin、master realm 和宽泛 Keycloak 路径。
- 新环境首次导入直接使用新 realm contract；现有 home realm 通过显式、带 precondition、备份和
  evidence 的一次性加法迁移升级，不在每次启动时在线 reconcile。
- 本地 Mac 安装与已部署 release/API 相容的 CLI，并默认连接
  `https://ui4a.styleofwong.cn` / `https://auth.ui4a.styleofwong.cn/realms/ui4a`。

## Non-Functional Requirements

- 不新增身份协议、数据库或长期 token store；复用 Keycloak 26.7.1、Node native fetch 与 macOS
  Keychain，不增加 npm runtime dependency。
- CLI 仍是 agent-neutral HTTP/Siren/meta reference client，不嵌入 LLM、业务路由或 approval shortcut。
- realm migration、token refresh、logout/revocation 和 edge route 均须可重试、fail closed、无 secret
  输出，并提供正负合同测试。
- deployment release、realm contract version、image digests、CLI version 与实机验收结果进入仓库外
  deployment runbook；Git 只保留通用合同和不含私密值的证据。

## Acceptance Criteria

- Disposable Keycloak 26.7.1 probe 验证 Device Grant、offline token、90/180/24h client attributes、
  claims、refresh rotation 与 revoke；probe realm/user/client 完整删除。
- Red/Green 覆盖 realm contract、production identity、CLI auth state machine/Keychain adapter、edge route
  allowlist、secret redaction 与 destructive negatives；focused coverage >80%。
- `pnpm check`、CLI build/pack、production Web build、Compose contracts 和 governance strict 全绿。
- home realm 在备份后升级且兼容检查通过；八个长期服务 healthy、retained volume identity 不变。
- 本地 `ui4a` 安装成功；真实 Device login 后 `doctor`、apps/flows/entity read 通过，CLI identity 为 Agent、
  无 approve；Keychain 中存在长期凭证而 config/log/history 不含 token。
- logout/revoke 先用 disposable credential 实测；最终交付 credential 保持登录，预计至少 90 天内无需
  重新认证，除非用户主动撤销或安全策略变化。

## Out of Scope

- Password grant、复制浏览器 session、永久静态 API token、CLI human approval、Keycloak experimental
  delegation、Linux/Windows 原生 keyring、DPoP/mTLS、realm 通用在线 reconciliation、多用户自助 client
  注册和 UI4A 业务数据库 token 表。
