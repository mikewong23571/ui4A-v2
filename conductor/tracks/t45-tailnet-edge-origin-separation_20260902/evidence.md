# T45 验收证据

## Contract

- Track 初始化：`d04a4963`。
- Public/internal host 分离：`357270ab`；Keycloak admin internal host 修复：`51fc479b`。
- Red：23 个预期失败；Green：149 focused tests passed、3 skipped。
- 全量 `pnpm check`：3683 tests passed、15 skipped；typecheck、lint 0 error、governance strict 通过。

## Home Upgrade

- Release SHA：`51fc479b43cff1d2f224403cef90558b1c183be2`。
- Web：`sha256:5ff0ed8d0718dcc968db7c763e78cb748559228d21f0bf65676b36c7ec9c875f`。
- Worker：`sha256:521f6e81545f39e0225f1ecab888a5d3ed3d3956bac00ea76f682545f69a7576`。
- Runner：`sha256:65dbaf8f0eeb92c5a20dfcbbf545d244428e469de524c124adab7d7f426df363`。
- Public origins：`https://ui4a.styleofwong.cn`、`https://auth.ui4a.styleofwong.cn`。
- Internal TLS hosts 保持 T44 的 home host；PKI 返回 `reused`，未轮换或删除 CA。
- `COMPOSE_PREFLIGHT_COMPLETED`、`COMPOSE_UP_COMPLETED`；八个长期服务 healthy。
- Retained volume identity hash 仍为
  `9c1398f8a9f79a648d3ded6b716d8fcd1fa81c42c48724f61a268bc224b13a99`。

## Aliyun Edge

- `aliyun-sz` Tailnet `100.64.0.8` 经 `100.64.0.2:443` 回源 home，upstream smoke 200。
- Caddy 配置：`/etc/caddy/ui4a.caddy`；未使用 `tls_insecure_skip_verify`，SNI/Host 固定为 home
  internal TLS hosts；home 未开放新公网端口。
- `ui4a.styleofwong.cn` 与 `auth.ui4a.styleofwong.cn` 均签发 Let's Encrypt 证书。
- `/`、`/applications`、`/meta`、`/api/health`、OIDC discovery 均为 200；`/auth/login` 的 issuer、
  callback、PKCE 与 Keycloak form action 全部落在 `.styleofwong.cn`。

## Account

- 新建用户 `mike`，enabled、emailVerified、requiredActions 为空。
- Keycloak password login 验证通过；凭证只保存在 home `0600` 文件
  `/home/mikewong/services/ui4a/operator/private/mike-login.json`，未写入 evidence/log。
- 实际浏览器 Authorization Code + PKCE 登录等待用户确认后闭环 Track。
