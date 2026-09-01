# T44 Home Compose 部署：公共 Origin 可移植性与实机上线

## Overview

将当前 UI4A 以 T22 Docker Compose 单副本形态部署到 `home`。`home` 已有 Docker、Compose、
Tailscale 与 Caddy，`8443` 被既有 Plane 占用，因此 UI4A edge 必须只绑定新的 loopback 端口，
再由现有 Caddy 在 Tailnet `443` 上提供公共 HTTPS。

## Functional Requirements

### FR1 — 完整公共 Origin

Compose operator input 必须显式提供 Web 与 Keycloak 的完整 HTTPS public origin。它们必须与
canonical deployment settings 的 `service.publicOrigin`、OIDC issuer/callback 对齐，不能由 hostname
固定拼接 `:8443`。未提供时保持 T22 既有 mothership 默认值。

### FR2 — 内外端口分离

容器内部 edge TLS listener、Runner delivery 与 Keycloak admin listener 保持现有私网端口；宿主机
published port 可由 operator 选择且默认只绑定 loopback。公共反向代理不得绕过 edge route allowlist。

### FR3 — Compose 单源投影

TypeScript renderer、静态 `compose.yaml`、stack/acceptance contract、operator input validator 和测试必须
表达同一组 origin/host/port 语义，不增加 home 专属分支或第二套 Compose。

### FR4 — Home Release

Web、Worker、Runner 必须从一个 exact Git SHA 构建为 `linux/amd64` OCI 镜像并按 digest 部署；第三方
镜像同样按 digest 固定。所有 Secret 只进入 `0600` 文件，生产 preflight 必须通过。

### FR5 — Tailnet 入口

使用两个独立 host：UI4A 与 Keycloak。现有 Caddy 只向 loopback UI4A edge 转发，并校验 UI4A public
CA；不得使用 path-prefix 部署、`tls_insecure_skip_verify` 或公开 PostgreSQL/Temporal/Runner admin。

## Non-Functional Requirements

- 不新增运行时依赖、数据库、权威状态或 Kubernetes。
- 保持单副本、非 HA、internal experiment 与 known-risk 边界。
- 普通 down 保留全部 UI4A volumes；禁止 prune 和未确认 volume 删除。
- 不修改 Plane、Mattermost、JoinQuant 或其他现有服务数据。
- `pnpm governance:strict` 保持零例外。

## Acceptance Criteria

- focused Compose tests、format、typecheck、lint、governance 通过。
- `home` 上 `pnpm compose:t22 preflight` 与 `up` 成功。
- Web、Worker、Temporal、PostgreSQL、Keycloak、edge、Runner 达到声明的 healthy/ready 状态。
- Tailnet HTTPS 下 `/`、`/applications`、`/meta`、`/.well-known/ui4a.json` 与 OIDC discovery 可访问。
- `/version` 精确返回部署 Git SHA；浏览器登录回调 origin 正确。
- 重启 Compose 长期服务后恢复 Ready，数据卷未更换或删除。
- 记录镜像 digests、入口、验证命令、已知限制和回滚方式。

## Out of Scope

- 公网开放、HA、多副本、Kubernetes、自动 Secret rotation；
- 修改现有 Plane 端口或数据；
- 删除 JoinQuant、Docker volume、项目上传/备份等用户数据；
- 把 UI4A 改造成 path-prefix 应用；
- 把 internal experiment 声称为 GA 或 production-ready。
