# T44 验收证据

## Phase A

- 基线提交：`afec7e5f8533041fafde620ee794e3492d9436f7`
- `home`：Debian x86_64，Docker 29.7.2，Compose 5.4.0，Tailscale `100.64.0.2`。
- 冲突：Plane 已发布 `0.0.0.0:8443`；home gateway 绑定 loopback/Tailscale `80/443`。
- 清理：精确清理低风险缓存与 `sing-box-windows/src-tauri/target`，释放
  `58,003,226,624` bytes；磁盘从 77%/约 99 GiB 可用改善为 64%/约 153 GiB 可用。
- Disposable Web image：revision `afec7e5f8533041fafde620ee794e3492d9436f7`，大小
  `295,454,933` bytes；`next build` 与 TypeScript 成功。
- 临时运行：`/live`、`/api/health`、`/`、`/meta`、`/applications`、`/version` 返回 200；
  `/ready` 返回 503 且原因是 `migration_required`。
- Spike 资源已删除，端口 `13100` 释放；未修改现有容器、网络、数据卷或项目数据。

## Phase B — Public Origin Contract

- Track 初始化：`29ec08a4`。
- 合同实现：`dfbeee6a`；计划 checkpoint：`7b6508b6`。
- `/applications` Compose/Kubernetes edge 对齐：`42317d22`。
- Red：新增 edge input 后旧 renderer/operator generator 产生 20 个预期失败。
- Green：`pnpm vitest run --project unit scripts/t22/compose` 为 87 passed、3 skipped；
  `pnpm typecheck`、`pnpm lint`（0 error）、`pnpm governance:strict` 通过。
- 全量 `pnpm check`：486 files passed、8 skipped；3682 tests passed、15 skipped。

## Phase C — Home Release

- Release SHA：`42317d2264a54e1f1e22470da15b754d499e3438`，已推送到
  `origin/master`，home checkout 与 image labels 完全一致。
- linux/amd64 immutable images：
  - Web：`127.0.0.1:5000/ui4a/web@sha256:3de34e108d3d1429dbdddff2bbe884a07a286b5ae6ac1418b1aabfae9df0f313`
  - Worker：`127.0.0.1:5000/ui4a/worker@sha256:008297ab367ebf39166942c81373e355f09657a6d4649083d8542e4854081b68`
  - Runner：`127.0.0.1:5000/ui4a/runner@sha256:c4e1530d28471fed42f93171233b4059d583950e013fc1507d08a03e12ef5efe`
- 第三方 inventory：PostgreSQL 17、Temporal 1.31.2、Temporal UI 2.50.1、Keycloak 26.7.1、
  Caddy 2.10.2 全部使用 registry digest。
- Operator root：`/home/mikewong/services/ui4a/operator`；canonical inputs 与 login 文件均为
  `0600`，managed entry 为 `operator/ui4a-compose`。
- `COMPOSE_PREFLIGHT_COMPLETED`：release/operator SHA 相等，关系 `ancestor-or-equal`。
- `COMPOSE_UP_COMPLETED`：PKI reused、PostgreSQL bootstrap、Temporal schemas/namespace、migration、
  realm import/check 全部 exit 0；八个长期服务全部 healthy。
- 入口：
  - `https://ui4a.home-linux.tail.styleofwong.com`
  - `https://auth-ui4a.home-linux.tail.styleofwong.com`
  - home Caddy `443` → loopback `127.0.0.1:10443` → UI4A edge internal `8443`
- Cloudflare 两条 A 记录均指向 Tailnet `100.64.0.2`、proxy disabled；1.1.1.1/8.8.8.8 权威查询可见。
- Outer Caddy 使用 Cloudflare DNS-01 公共证书；回源用 UI4A persisted public CA 与 exact SNI，未使用
  `tls_insecure_skip_verify`。

## Phase D — Acceptance

- HTTPS smoke：`/`、`/applications`、`/meta`、`/api/health`、OIDC discovery 全部 200。
- `/version` 返回 exact release SHA；OIDC issuer、authorization/token endpoints 与 callback origin
  全部使用两个 canonical public hosts。
- Playwright 真实登录：`ui4a-experiment-human` 经 Keycloak Authorization Code + PKCE 登录，随后首页与
  `/meta` 均返回 200；Meta title 为“定义控制台 · UI4A”。凭证未进入日志或 evidence。
- Keycloak 26 固定 realm 不声明 built-in `profile` client scope；home operator settings 因而请求
  `openid + UI4A managed scopes`，并为实验用户补齐非真实 profile 字段以关闭 required action。
- 八个长期容器同时 restart 后全部恢复 healthy；retained volume identity hash 前后均为
  `9c1398f8a9f79a648d3ded6b716d8fcd1fa81c42c48724f61a268bc224b13a99`。
- `COMPOSE_BACKUP_PLAN` 与 `COMPOSE_RESTORE_PLAN` 通过；两者保持 plan-only、verified quiescence 与
  isolated/non-destructive 恢复边界。
- 部署后再次清理 5.105 GB build cache；最终磁盘约 148 GiB 可用、65% 使用率。

## Known Boundary

- 这是 single-replica、non-HA、internal experiment；继承 T22 known vulnerability risk，不代表 GA、
  SLA、LTS 或 production-ready。
- 当前 Mac 的 VPN DNS resolver `10.255.0.2` 保留了新 host 的负缓存；公共 DNS 和 TLS 均已生效，
  Playwright 通过 exact host mapping 完成端到端验收。客户端 DNS 刷新不影响 home 部署状态。
