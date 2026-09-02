# T47 完成报告（Review Fixes 重新打开）

> 该报告记录首次关闭时的架构交付；生产浏览器发现 session controls 被 build-time 条件隐藏，
> T47 已重新打开并在原 Track 追加 Review Fixes。最终关闭时更新本报告。

## Outcome

T47 已完成。`aliyun-sz` 和 `home` 是两个并列 HTTPS 入口，均直接回源 Home 的 Tailnet-only
pure HTTP Compose gateway；公网链路不再经过 Home HTTPS gateway，也不再 TLS 套娃。

## Delivered

- Canonical public origin 与严格 `trustedRequestOrigins` 分离，两个 UI origin 共享唯一 Keycloak
  issuer/client/account。
- Browser session/callback 按受信入口选择；Agent contract self-fetch 固定回 canonical public origin。
- Compose UI/realm gateway 改为 HTTP `:8080`，宿主只发布 `100.64.0.2:10443`；Runner/admin TLS
  listener 保持内部。
- Aliyun/Home Caddy 都使用 `reverse_proxy http://100.64.0.2:10443` 并保留实际 Host。
- Keycloak Web callback binding 备份优先、最小 reconcile；数据卷和 realm v2 identity 保持不变。
- DeepSeek 的单一 opencode-go provider 经 `127.0.0.1:10808` sing-box egress 使用
  `vless[hk-entry]`；未修改其他 provider 或 API key。

## Acceptance

- Release `2a0c4c4e3a7448eaee8a7e05725cfdacdbae09f4`，8 服务 healthy，volume hash 不变。
- 公网/内部 HTTPS、OIDC、PKCE 登录、匿名 UI/API 分流、account/logout、admin 负例通过。
- 匿名 Chat 是 `401 session_not_found`，不再是 `request_origin_invalid`。
- OpenCode Go completion、Web 容器 DeepSeek completion、真实浏览器 Chat 均为 HTTP 200。
- `pnpm check`：495 files passed / 8 skipped；3753 tests passed / 15 skipped。
- 仓库外 runbook 本地/Home SHA-256：
  `971160c3c25f4abf5e22ca2dff81ee72954304da8b06e24e6bebf849be9b6405`。

## Project documentation

D64、Compose standing docs、Track evidence 和外部 deployment runbook 已覆盖架构与运维变化。
产品定义、技术栈与产品表达未发生需要额外同步的变化。
