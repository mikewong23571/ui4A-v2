# T47 完成报告

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
- 生产 session controls 在请求期读取认证 cookie；账户与退出操作不再受 image build-time env 影响。
- Keycloak Account Console 的固定 scope、iframe/OPTIONS edge contract 和 backup-first migration 已落地；
  用户可进入 Personal info 与 Password Update。
- Web logout 使用标准 OIDC RP-Initiated Logout，同时结束 UI4A 私有 session 与 Keycloak SSO session。

## Acceptance

- Release `298d0f9e31e83e7104f9cbb248cef0fca88edfbd`，8 服务 healthy，volume hash 不变。
- 公网/内部 HTTPS、OIDC、PKCE 登录、匿名 UI/API 分流、account/logout、admin 负例通过。
- 匿名 Chat 是 `401 session_not_found`，不再是 `request_origin_invalid`。
- OpenCode Go completion、Web 容器 DeepSeek completion、真实浏览器 Chat 均为 HTTP 200。
- 登录菜单、Account Console Personal info、Password Update 与完整 OIDC logout 浏览器链路通过。
- `pnpm check`：497 files passed / 8 skipped；3760 tests passed / 15 skipped。
- 仓库外 runbook 本地/Home SHA-256：
  `2bc86aab8ed1db6ab45f79f00a71feea5fdad211f5ce803fd5469fd17fb7f918`。

## Project documentation

D64、Compose standing docs、Track evidence 和外部 deployment runbook 已覆盖架构、认证 UX 与运维变化。
产品定义、技术栈与产品表达未发生需要额外同步的变化。
