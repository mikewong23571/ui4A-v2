# T47 部署与验收证据

## Release

- Git SHA：`298d0f9e31e83e7104f9cbb248cef0fca88edfbd`
- Build date：`2026-09-02T15:48:24Z`
- Web：`sha256:e4c42a9fc64ffbc33dd79f982f0705e0f91a3264264d99cffb14494f50120efb`
- Worker：`sha256:4fe27f718fcce37471f66418bcefb73dc3c14e39dce6f4aecf7c60af81ddbd15`
- Runner：`sha256:5b091f25f1dc2badafe3b8b4b796d307e199292962cf30f5948df3952276ca2d`

Review Fixes 的 Web 使用 exact SHA production build 重打包；Worker 包含 Keycloak Account
Console migration；Runner 源码未变化，仅覆盖 release metadata/environment。

## Review Fixes：账户与 session 生命周期

- 请求期 `__Host-ui4a_session` cookie 决定生产菜单是否显示“账户与密码”和“退出登录”；不再由
  image build 时的 `UI4A_DEPLOYMENT_PROFILE` 烘焙 UI。
- Compose edge 补齐 Keycloak Account Console 所需的 OPTIONS、3p-cookie 与 login-status iframe
  allowlist；public admin route 仍不开放。
- 原 realm import 只创建 UI4A scopes，导致 built-in `account-console` token 缺少
  `resource_access.account.roles` 与 `preferred_username`，Account REST 因而 403。backup-first migration
  创建并绑定固定 `ui4a:account-console` scope，没有扩大用户或 realm admin 权限。
- 迁移结果：`migration=already-applied`、`accountConsole=updated`、`origins=already-applied`。快照
  `realm-data:/var/lib/ui4a/realm/backups/t47-account-console-20260902T1539Z.json` 为 0600，SHA-256
  `44d424bc6d5477b38572a43fa571caa724eb90a06fe8681ad91776bd4fbf86ed`。
- Web logout 在 revoke 和本地 session 删除后，携带原 ID Token 进入 Keycloak OIDC RP-Initiated
  Logout；浏览器最终停在 Keycloak 登录页，不再因残留 SSO cookie 立即无感回登录态。

## Executable topology

```text
public browser -> HTTPS aliyun-sz Caddy --HTTP/Tailscale--> 100.64.0.2:10443
tailnet browser -> HTTPS home Caddy ------HTTP-----------> 100.64.0.2:10443
                                                        -> Compose HTTP :8080
                                                           -> Web / Keycloak
```

- Both Caddy fragments contain `reverse_proxy http://100.64.0.2:10443`.
- Neither UI4A ingress fragment contains an HTTPS upstream.
- Edge port inventory is `100.64.0.2:10443 -> 8080/tcp`; `8443` is not host-published.
- `192.168.1.7:10443` is not bound; unknown Host and public Keycloak admin return 404.
- Runner delivery TLS `8443/9444` and Keycloak admin TLS `9443` remain container-internal.

## State and identity

- `preflight` and `up` completed for the exact release.
- Eight long-running services are healthy.
- Retained volume name hash remained
  `9c1398f8a9f79a648d3ded6b716d8fcd1fa81c42c48724f61a268bc224b13a99`.
- Keycloak realm remains v2; backup-first Web callback reconciliation returned
  `migration=already-applied`, `origins=updated`.
- Browser-origin backup is 0600 at
  `/var/lib/ui4a/realm/backups/t47-browser-origins-20260902T1314Z.json`, SHA-256
  `4006df062ec106c9d0ae04829305f8f71d033ced40cdea8bf6f387a77433dd0f`.
- Both public and internal Authorization Code + PKCE flows completed in isolated browsers; the
  internal callback returned to `https://ui4a.home-linux.tail.styleofwong.com/` while discovery
  retained the unique public issuer.

## HTTP and product acceptance

- Public/internal root: 307 to login without a session.
- Public/internal `/live`: 200; final release SHA and build date match.
- Public business API without a credential: structured 401.
- Public `POST /api/chat` without a session: `401 session_not_found`, not
  `400 request_origin_invalid`.
- Public OIDC discovery/account: 200/302; public admin route remains 404.
- 登录后的系统菜单显示“账户与密码”和“退出登录”；Account Console 显示 `mike`、Personal info、
  Account security / Signing in 以及 Password `Update`。
- POST logout 经过 Keycloak OIDC logout，回到 UI origin 后重新进入登录页；没有自动 callback。
- Public authenticated Chat returned 200 after the final provider egress change and correctly
  listed one implementation-ready work item.
- Internal authenticated Chat initially exposed and then verified the canonical self-fetch fix:
  contract reads now traverse `service.publicOrigin`; no internal-host fetch failure remains.
- Local CLI `auth status` and `doctor` passed; health/business/meta probes were all 200.

## Verification gates

- `pnpm check`: 497 test files passed, 8 skipped; 3760 tests passed, 15 skipped.
- `pnpm governance:strict`: passed with empty baselines.
- `pnpm format:check`: passed.
- Caddy config adapted with the deployed digest; Home reload and aliyun-sz full validate/reload
  succeeded.
- External runbook local/Home SHA-256 after final synchronization:
  `2bc86aab8ed1db6ab45f79f00a71feea5fdad211f5ce803fd5469fd17fb7f918`.

## Provider egress resolution

`deepseek-v4-flash` correctly maps to the single API-key-based
`openai-compatibility[name=opencode-go]` provider. Direct `aliyun-sz -> ocgo:9453` TCPing measured
40% loss and second-scale connects; unrelated Kimi refresh warnings initially obscured this fact.
Only this provider's `proxy-url` changed from `direct` to `http://127.0.0.1:10808`. The loopback
sing-box mixed proxy selected `vless[hk-entry]`; no other provider or API key changed. After restart:

- direct OpenCode Go completion through the configured egress: HTTP 200, model/choice/usage valid;
- UI4A Web container completion: HTTP 200, model `deepseek-v4-flash`, choice/usage valid;
- isolated-browser PKCE Chat: HTTP 200 and one real implementation-ready work item.

Config backup:
`/var/lib/cliproxyapi/config.yaml.before-opencode-egress-20260902T141034Z.bak`, SHA-256
`10bb852307f53ee981cf2869edd14926162b39245c41fc9623a787d828a20c3d`. Current config SHA-256:
`9b63ba1fdbe713251bec508b913d479da090e18210b0f0313c5d2110ae2f9a09`.
