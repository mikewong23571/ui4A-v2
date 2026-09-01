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
- 用户已确认实际浏览器 Authorization Code + PKCE 登录成功。

## Authentication UX Review Fixes

- 实现提交：`74b3185b89c86898cdb0e803d016cef579cc313b`。
- 无 session cookie 的 `/` 与 `/meta?query=x` 在页面渲染前返回 307，并保留编码后的
  `returnTo`；`/.well-known/ui4a.json` 与 `/api/entity?rel=root` 继续返回结构化 401。
- production 顶栏系统区提供“账户与密码”和 POST“退出登录”；local profile 不显示。
- `/auth/account` 返回 302 至
  `https://auth.ui4a.styleofwong.cn/realms/ui4a/account/`，Account Console 返回 200。
- `/auth/logout` 返回 303，清除 `__Host-ui4a_session` 后回到站点根路径。
- focused verification：120 passed、3 skipped；production web build、typecheck、lint、
  governance strict 通过；全量 `pnpm check` 重跑为 3700 passed、15 skipped。

## Authentication UX Deployment

- Release SHA：`74b3185b89c86898cdb0e803d016cef579cc313b`。
- Web：`sha256:ff913711a0e4577a774907f38f2c6865c1b6c6b3fef41194210e7ddcc4496ae4`。
- Worker：`sha256:1b55d6c56bb00c82e798ba1e0945f18c85806457aab6b040db3d8ba5d4f82e00`。
- Runner：`sha256:6cb1f89dee879a736c98d849ea068a5878121ffa14dad9fb3128dc68789b84ba`。
- `COMPOSE_PREFLIGHT_COMPLETED`、`COMPOSE_UP_COMPLETED`；八个长期服务 healthy；最近部署日志无
  error/exception/fatal。
- edge routing 是只读 bind mount；本次新增 account allowlist 后单独重启 edge 使 Caddy 载入新配置，
  其余长期服务无需再次重启。
- Retained volume identity hash 仍为
  `9c1398f8a9f79a648d3ded6b716d8fcd1fa81c42c48724f61a268bc224b13a99`。
- 部署后清理 home Docker build cache：`5.112GB` → `0B`；未清理数据卷。
