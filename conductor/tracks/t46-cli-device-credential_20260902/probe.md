# T46 Disposable Probe Evidence

## Keycloak 26.7.1

- 在 `home` 以 production 相同 digest 启动独立、loopback-only、H2 dev probe container；生产
  `ui4a` realm、数据库、Caddy 和八个长期服务未修改。
- Discovery 暴露 `device_authorization_endpoint`、`token_endpoint`、`revocation_endpoint`。
- public client 的有效 import/export attributes：
  - `oauth2.device.authorization.grant.enabled = true`
  - `access.token.lifespan = 86400`
  - `client.offline.session.idle.timeout = 7776000`
  - `client.offline.session.max.lifespan = 15552000`
- consent 页面准确显示 `ui4a:read`、`ui4a:write`、Offline Access；Device login 成功。
- 仅请求 `offline_access` scope 不够：用户缺 realm `offline_access` role 时，token endpoint 拒绝
  `Offline tokens not allowed for the user or client`。补齐 role 后成功。
- lightweight access token 默认不保证 `sub`/`aud`；加入 production 同形 subject mapper 和
  `ui4a-api` audience mapper 后，claims 为 `sub` present、`aud=ui4a-api`、
  `azp=ui4a-cli-probe`，scope 含 read/write/offline_access。
- token response：access lifespan `86400` 秒，offline refresh `7776000` 秒；refresh 后 access 与 refresh
  token 均轮换，CLI 必须持久化最新 refresh token。
- revocation endpoint 返回 200；被撤销 offline token 再 refresh 返回 400 `invalid_grant`。
- probe refresh 已撤销，browser auth vault/session 已删除，probe container、realm、user、client 和所有
  临时 token 文件已删除；随后 production 八个长期服务仍 healthy。

## macOS Keychain

- `security add-generic-password ... -w` 把 `-w` 放在最后时从 stdin prompt 读取，不需要 token argv。
- 新建时 prompt 要求输入和确认两次；adapter 必须向 stdin 写入相同 secret 两行。
- disposable probe 完成 add → read → update → read latest → delete → not-found。
- token 未进入 argv、stdout/stderr 或仓库文件；probe Keychain item 已删除。

## Plan Refinement

- realm v2 必须同时交付 client、subject/audience mappers、offline role/default mapping 和三个 timeout。
- CLI credential store 采用 injectable interface；macOS adapter 使用双行 stdin，禁止 `-w <token>`。
- production migration 是显式 v1→v2 one-shot，不进入常驻 startup reconciliation。
