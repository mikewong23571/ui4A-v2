# T45 Tailnet Edge 公网 Origin 与内部 TLS Host 分离

## Overview

T44 只覆盖“宿主 Caddy 与 Compose edge 在同一台机器”的入口形态，因此 public origin host 与
内部 leaf certificate host 相同。T45 增加第二种合法拓扑：公网 Caddy 位于 `aliyun-sz`，经 Tailscale
回源 `home`，public origin 与内部 TLS/SNI host 不相同。

## Functional Requirements

- canonical `service.publicOrigin` 与 OIDC issuer/callback 继续是浏览器和 Token 的公共真相。
- `settings.tls.ui4aHost`/`keycloakHost` 只表示 Compose edge 内部证书与 SNI host，不再强制等于
  public origin host。
- Compose operator generator 从 public settings 导出 public origins，从 TLS settings 导出内部
  `UI4A_HOST`/`KEYCLOAK_HOST`；任何环境覆盖不一致都拒绝。
- TypeScript renderer 接受 public origins 与 internal TLS hosts，Runner delivery 使用内部 host，
  Keycloak `KC_HOSTNAME` 使用公共 origin。
- 默认 mothership/T44 同 host 行为不变，无兼容双路径或 home/aliyun 名称分支。
- `aliyun-sz` Caddy 仅经 `100.64.0.2:443` Tailnet 回源，并校验 home 公共证书/SNI；home 不开放新公网端口。

## Acceptance Criteria

- Red/Green focused tests、`pnpm check` 与 governance 全绿。
- home 原地升级保持 PostgreSQL/Temporal/Keycloak/CA/Runner volumes identity 不变。
- `https://ui4a.styleofwong.cn`、`https://auth.ui4a.styleofwong.cn` TLS 与关键路由 200。
- 真实 Keycloak Authorization Code + PKCE 登录后首页与 Meta 200。
- 八个长期容器 healthy，重启后恢复。

## Out of Scope

- 删除或轮换 home CA；公网暴露 home 端口；绕过 UI4A edge；Cloudflare proxy；HA/Kubernetes。
