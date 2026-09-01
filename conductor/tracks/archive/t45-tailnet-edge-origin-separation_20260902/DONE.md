# T45 DONE — Tailnet 公网 Edge 与认证体验

UI4A 已通过 `aliyun-sz` Caddy 以 `ui4a.styleofwong.cn` 和
`auth.ui4a.styleofwong.cn` 对外提供服务，并经 Tailscale TLS 回源 `home`。

- 公网 origin 与 home 内部 TLS/SNI host 分离；未轮换 CA，未删除数据卷。
- Let's Encrypt 证书、OIDC discovery、Authorization Code + PKCE 浏览器登录通过。
- `mike` 账户可用；账户/改密入口和 POST logout 已部署。
- 未登录 UI 在渲染前跳转登录，API/Siren 保持结构化 401。
- 部署 release 为 `74b3185b89c86898cdb0e803d016cef579cc313b`；八个长期服务 healthy。
- retained volume identity hash 保持不变；公网、account、logout 和服务日志均完成验收。
- 仓库外部署 runbook 已保存在本地 Mac，并同步到 home 运维目录。

完整证据见 [evidence.md](./evidence.md)。
