# T47 双 HTTPS 入口与纯 HTTP Origin

## Overview

当前公网请求经过 `aliyun-sz Caddy -> home Caddy -> Compose TLS edge` 三次代理、两次 HTTPS
回源。代理层把公网 `Host` 覆盖为内部证书 host，导致 `/api/chat` 将请求还原为内部 Origin 并返回
`request_origin_invalid`。本 Track 将两个 HTTPS 入口改为并列入口：各自在入口终止 TLS，再通过
受限网络访问同一个纯 HTTP application gateway。

## Functional Requirements

- `https://ui4a.styleofwong.cn` 与 `https://ui4a.home-linux.tail.styleofwong.com` 是并列 UI 入口；
  `https://auth.ui4a.styleofwong.cn` 与内部 auth host 仍只投影同一个 Keycloak realm 和唯一 public
  issuer。
- `aliyun-sz` Caddy 经 Tailscale HTTP 直达 Home application gateway；Home Caddy 经 HTTP 访问
  同一 gateway，不再串联另一个 HTTPS 入口。
- Compose edge 的外部 UI/Keycloak listener 改为纯 HTTP，继续集中保留 route allowlist；Runner
  delivery、Keycloak admin、PostgreSQL、Temporal 及其他内部 TLS 合同不因本 Track降级。
- HTTP published port 只绑定 Home 的 Tailscale 地址，并在 gateway 层只接受 Home 与
  `aliyun-sz` 的 Tailnet source IP；不得绑定公网或普通 LAN 地址。
- 两个入口必须保留浏览器实际 `Host`，并固定向后端传递 `X-Forwarded-Proto: https`；不得用内部
  backend host 覆盖公网 `Host`。
- canonical deployment settings 显式声明受信浏览器 request origins。Chat、登录回调和 session
  只接受该集合，未知 `Host`/Origin fail closed；canonical public origin、OIDC issuer 与 audience
  保持单一真相。
- Keycloak Web client 接受受信 UI origins 对应的 callback URI；内部入口仍使用公共 Keycloak
  issuer，不创建第二 realm、第二 issuer 或第二套账户。
- Compose operator 从 canonical settings 生成 HTTP port、bind address/source allowlist 和 browser
  origins；禁止用未验证环境变量覆盖 canonical 输入。
- 保留现有 PostgreSQL、Temporal、Keycloak、CA、Runner 与业务数据 volume identity；不轮换 Secret。

## Non-Functional Requirements

- 变更小而显式，不新增 runtime dependency，不复制 Home/Aliyun 专用 Compose 实现。
- route allowlist 保持集中且测试覆盖；公网不得获得 Keycloak admin 或内部 callback 路由。
- 现有 Kubernetes/Istio 生产合同不被 Compose 专用网络变化破坏。
- 部署文档继续位于仓库外，并在验收后同步到 Home、比较 SHA-256。

## Acceptance Criteria

- Red/Green focused tests、`pnpm governance`、相关 typecheck/lint 与 `pnpm check` 全绿。
- 现网拓扑为：`aliyun-sz HTTPS -> HTTP/Tailscale -> Home gateway` 和
  `home HTTPS -> HTTP -> Home gateway`；配置中不存在这两个入口到 UI4A 的 HTTPS 回源。
- Home HTTP origin 从普通 LAN/公网不可达，非 allowlist Tailnet source 被拒。
- 公网无 session `POST /api/chat` 返回结构化 `401 session_not_found`，不再返回
  `400 request_origin_invalid`；带真实 session 的 Chat 请求能到达 LLM。
- 两个 UI HTTPS 入口的 `/live`、未登录页面重定向、OIDC Authorization Code + PKCE 登录、账户入口
  与 logout 均按合同工作；OIDC discovery 的 issuer 始终为公共 issuer。
- 两个 auth HTTPS 入口仅暴露固定 realm 协议/account surface，Keycloak admin 继续不可达。
- 八个长期服务 healthy，重启 edge/Home Caddy/aliyun Caddy 后恢复；release SHA、image digests、
  listener、日志与文档同步形成证据。

## Out of Scope

- Cloudflare proxy、公开 Home HTTP 端口、HA/Kubernetes 拓扑重做、数据库迁移、Secret/CA 轮换。
- 绕过集中 route allowlist 直接公开 Web 或 Keycloak 容器。
