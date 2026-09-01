# T44 DONE — Home Compose 部署

UI4A 已以 exact release `42317d2264a54e1f1e22470da15b754d499e3438` 部署到 `home`。

- 完整 Compose preflight/up/status 通过；Web、Worker、Runner、PostgreSQL、Temporal、Temporal UI、
  Keycloak 与 edge 全部 healthy。
- Tailnet HTTPS、OIDC issuer/callback 与真实浏览器登录闭环通过。
- 同时 restart 后恢复 healthy，retained volume identity 不变。
- operator input、Secret、image digest、运维入口、backup/restore plan 与 known-risk 均已记录。
- 清理未触碰 JoinQuant、Docker 业务数据卷、上传/备份或既有服务；部署后约 148 GiB 可用。

完整证据见 [evidence.md](./evidence.md)。
