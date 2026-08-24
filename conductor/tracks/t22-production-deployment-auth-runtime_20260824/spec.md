# T22 生产形态部署、身份认证与双后端 Agent Runtime — Specification

## 类型

Feature

## Overview

将 UI4A 从本地 Demo 运行方式升级为可重复、可审计、可恢复的生产形态，并在以下两种目标上交付
同一运行合同：

1. \`/home/mike/projs/main/mothership-setup/K8S-ISTIO-DEPLOY.md\` 描述的 Kubernetes
   v1.31.14、Istio 1.24.2 内网集群。
2. 单机 Docker Compose all-in-one 环境。

K8s 形态在集群内运行 UI4A Web、Worker、PostgreSQL、Temporal、Keycloak 和容器化 Agent
Runtime。Agent Runtime 同时支持 K8s 隔离 Pod 与受信宿主机 Runner，具体后端只能由服务端
Runtime Profile 选择。

项目引入真实身份认证：人类通过 Keycloak OIDC 登录，CLI 使用 Bearer Token，Agent 使用
RFC 8693 Token Exchange 和 \`act\` 委托链。生产环境不再接受客户端自报的 \`actor\`、
\`principal\` 或授权 scope。

交付物必须包含从零部署、配置、验证、备份恢复、升级、回滚和故障排查的逐步运行手册，并在真实
目标集群与 Docker Compose 上留下用户故事验收证据。Track 完成时产出首个试验性版本
\`v0.1.0-experimental.1\`；它不代表 GA、正式 SLA 或未经验证的高可用承诺。

## Functional Requirements

### FR1 统一生产配置合同

必须定义经过 schema 校验的部署配置，覆盖：

- 部署模式：\`compose\` 或 \`kubernetes\`。
- 认证模式：显式 \`demo\` 或 \`oidc\`；生产配置禁止隐式回退。
- PostgreSQL、Temporal、Keycloak、LLM 和 Agent Runtime。
- UI4A、Keycloak 两个内网域名。
- TLS、数据库连接池、资源预算、超时、Task Queue 和 namespace。
- Coding/Writing/Authoring profile、仓库注册表和 workspace。
- Secret 与普通配置严格分离。

Docker Compose 与 K8s 必须消费同一变量语义，不维护两套含义不同的配置。

### FR2 可重现构建产物

至少提供：

- Web 生产镜像。
- Worker 生产镜像。
- Agent Runner 镜像或明确隔离的 Runtime 镜像。
- 固定 Node/pnpm/系统工具版本的多阶段构建。
- Worker 正式 build/start 入口，不再以 \`tsx ... dev\` 作为生产命令。
- 镜像版本、Git SHA、构建时间和依赖清单。
- 非 root 运行、合理的只读根文件系统和可写目录声明。
- SBOM、依赖漏洞扫描及镜像 smoke test。
- 内网 Nexus 构建、推送或 \`ctr import\` 的可验证流程。

同一 Git revision 的 Compose 与 K8s 部署必须使用相同镜像 digest。

### FR3 显式数据库迁移与启动顺序

必须把当前请求时幂等 DDL 升级为显式、版本化、可重试的迁移流程：

\`\`\`text
PostgreSQL ready
→ migration Job/command
→ bootstrap/replay integrity check
→ Web/Worker ready
\`\`\`

要求：

- 多副本启动不会并发破坏 DDL。
- 迁移失败时 Web/Worker 不进入 ready。
- 数据库账号权限最小化区分 migration 与 runtime。
- 升级前备份，迁移与应用版本有兼容窗口。
- 提供从空库初始化和现有事件日志升级两条路径。
- 事件日志继续是业务真相，不引入第二权威状态库。

### FR4 多副本并发安全

生产 Web 不得只依赖进程内 Promise 队列保证单 atom。

必须：

- 通过 PostgreSQL 事务、锁或等价机制使跨 Pod 裁决保持串行语义。
- 验证两个 Web 副本并发处理同一资源时仍满足声明 → guard → schema 顺序。
- 保持拒绝留痕、事件全序和重放一致性。
- 投影缓存失效或 Pod 重启不得产生陈旧裁决。
- Compose 可以单 Web 运行；K8s 至少验证两个 Web 副本。

### FR5 Keycloak 身份认证

集群内部署 Keycloak，并配置独立持久数据库/schema。必须支持：

- 浏览器 Authorization Code + PKCE。
- UI4A 服务端安全 Session 或等价标准 OIDC 流程。
- CLI Bearer Token。
- 服务账号和机器身份。
- RFC 8693 Token Exchange。
- \`act\` 委托链。
- Token issuer、audience、expiry、signature 和 scope 校验。
- 用户、角色、client、scope 与测试 fixture 的可重复 realm bootstrap。
- 退出登录、过期、撤销和 Keycloak 不可用的诚实失败。

### FR6 身份成为机械事实

HTTP 请求里的 \`actor\`、\`principal\`、policy scope 和委托关系必须由已验证凭证派生。

要求：

- \`actor=human\` 只能来自满足人类登录策略的凭证。
- Agent、service account 和 callback 身份不得批准 human-only action。
- 请求 body、query 或普通 header 不能覆盖凭证身份。
- Principal/scope/\`act\` 链进入事件审计。
- 未认证请求只能访问明确声明的公共端点。
- \`demo\` 自报模式只允许显式本地配置，生产启动时发现该模式必须失败。
- Istio 可做入口 JWT 和网络层拦截，但应用仍负责业务身份与 scope 裁决。

### FR7 Istio 入口与内网 TLS

必须提供两个可配置内网域名：

\`\`\`text
UI4A_HOST
KEYCLOAK_HOST
\`\`\`

通过 Istio Gateway、VirtualService、RequestAuthentication 和 AuthorizationPolicy 暴露。

实验环境 TLS 采用简单持久化方案：

- 首次生成内网根 CA、根私钥及 UI4A/Keycloak 叶证书。
- 固定保存于 mothership 持久目录，重复部署不得覆盖。
- 同步创建或更新 Kubernetes TLS Secret。
- 提供客户端安装根证书的步骤。
- 验证 SAN、issuer、证书链、HTTPS 和 OIDC redirect URI。
- 文档包含备份和恢复证书文件的直接命令。

### FR8 集群内状态服务

K8s 部署必须包含：

- PostgreSQL 17。
- Temporal Server 与持久化。
- Keycloak 与持久化。
- UI4A Web、Worker。
- K8s Agent Runtime。
- 必需的 Service、ConfigMap、Secret、PVC、Job、CronJob 和 Istio 资源。

目标 mothership 集群是两 Worker 的实验集群，不能虚构高可用。交付必须区分：

- 在该集群实际验证的单实例或有限冗余形态。
- 可通过 values 配置扩展的生产副本与存储形态。
- 已验证的备份恢复，而非未经验证的 HA 声称。

### FR9 存储、备份与恢复

必须在部署前探测 StorageClass、节点磁盘和调度条件，再选择明确的持久卷方案。

至少覆盖：

- PostgreSQL 数据及备份。
- Temporal 持久化。
- Keycloak 数据。
- Coding worktree。
- Writing artifacts。
- Agent Authoring runtime evidence。
- 根 CA 与证书。
- 恢复后的事件日志重放和状态 hash 检查。

必须实测：

1. 创建业务、Chat、Draft 和 Agent Run 数据。
2. 生成备份。
3. 删除或隔离当前状态。
4. 从备份恢复。
5. 验证实体、身份配置、运行历史和重放 hash。

### FR10 Temporal 生产适配

Temporal 客户端与 Worker 必须支持部署配置：

- Address。
- Namespace。
- Task Queue。
- TLS/mTLS 或集群内 Istio 通道。
- 连接与启动超时。
- Worker identity。
- graceful drain。
- readiness。
- 独立测试 Task Queue。

不得继续把 namespace 固定为 \`default\`。Temporal 不可用时必须区分：

- Web 仍可提供的只读/人工功能。
- 不可派发的 durable operation。
- 已在途 workflow 的恢复行为。

### FR11 双后端 Agent Runtime

定义统一、服务端拥有的 Runtime Backend 合同。

#### K8s Backend

- 每个 Run 使用隔离 Job/Pod 或等价受控执行单元。
- 明确 ServiceAccount、资源限额、超时、workspace、网络策略和取消。
- Provider 凭证只注入授权 Run。
- Coding workspace 在人类决定前保留。
- Pod 完成、失败、驱逐、Worker 重启后 Run 可恢复或诚实终止。
- 不允许任务请求覆盖 image、command、cwd、Provider、模型、权限或网络策略。

#### Host Runner Backend

- 宿主机运行独立、受认证的 Runner 服务。
- Runner 注册固定 capabilities、workspace roots 和 profile。
- UI4A 只能选择服务端登记的 Runner。
- 心跳、租约、取消、重试、断连和结果回传可审计。
- 请求不能提交任意宿主机路径、命令、环境变量或身份。
- Host Runner 失败不得 fallback 到更宽权限后端。

两个后端必须产生相同的 canonical Agent Run、artifact、verification 和 human decision 语义。

### FR12 Docker Compose all-in-one

提供一条命令可启动：

- PostgreSQL。
- Temporal。
- Keycloak。
- UI4A Web。
- UI4A Worker。
- 容器化 Agent Runtime。
- 可选 Host Runner profile。
- 必需的初始化、迁移和 realm bootstrap。

要求：

- 使用命名 volume。
- 有依赖健康检查。
- 支持 HTTPS 与 OIDC。
- 支持首次启动和重复启动。
- \`docker compose down\` 不删除数据。
- 明确提供带确认的完全清理命令。
- 运行与 K8s 相同的核心用户故事验收脚本。

### FR13 健康、就绪与可观测性

提供独立语义：

- Liveness：进程是否活着。
- Readiness：数据库、迁移、配置和关键运行依赖是否满足。
- Dependency status：Temporal、Keycloak、LLM、Runtime Backend。
- Worker readiness 与 drain 状态。

健康探针不能仅凭 HTTP 200 判断；\`degraded\` 不能进入 ready。

结构化日志必须包含 request/run/workflow/principal correlation，且不得打印 Token、API Key、数据库
密码或完整敏感 Prompt。

### FR14 逐步部署与运维手册

必须交付真实可执行的 runbook，至少包含：

1. 目标集群和节点预检。
2. StorageClass/PV 决策。
3. 内网镜像构建、传输、预拉和 digest 验证。
4. namespace、Istio injection 和基础策略。
5. 根 CA、域名和证书。
6. PostgreSQL。
7. Temporal。
8. Keycloak、realm/client/role bootstrap。
9. 数据库迁移。
10. UI4A Web/Worker。
11. K8s Agent Runtime。
12. Host Runner。
13. DNS/hosts 和客户端根证书。
14. 人类登录、CLI、Agent token exchange。
15. Golden Story。
16. 备份恢复。
17. 升级与回滚。
18. 日志、健康检查和常见故障。
19. 停止、卸载和数据保留。

每一步必须包含命令、预期输出、失败判据和恢复动作。

### FR15 自动化部署验证

提供可重复的验证入口，至少区分：

\`\`\`text
config lint
image test
compose acceptance
k8s preflight
k8s apply
k8s acceptance
backup/restore drill
auth negative tests
runtime backend matrix
\`\`\`

验证脚本不得依赖人工修改数据库或伪造 actor/header。

### FR16 首个试验性版本

Track 完成时必须产出 \`v0.1.0-experimental.1\`：

- 固定 Web、Worker 和 Runner image digest。
- 提供 release manifest、checksums、SBOM、Release Notes 和验收报告。
- 标明 Compose/K8s 验证范围、已知限制、非 HA 边界和升级兼容范围。
- 验证升级与回滚。
- 不标记为 GA、production-ready SLA 或长期支持版本。

## User Stories

完整验收叙事与逐项证据要求见 [user-stories.md](./user-stories.md)。

## Golden Story

\`\`\`text
从空环境部署
→ 安装/信任内网根 CA
→ 人类经 Keycloak 登录 UI4A
→ 完成一个普通业务 Flow
→ Agent 使用 token exchange 获得受限身份
→ Agent 发起需要确认的动作
→ Agent 无法批准
→ 人类批准后动作生效
→ 分别以 K8s Pod 和 Host Runner 完成 Agent Run
→ 重启 Web/Worker 后状态及身份仍可恢复
→ 备份、隔离数据、恢复
→ 实体状态 hash、审计链及 Run evidence 一致
\`\`\`

Golden Story 必须在 K8s 真实集群完成；Compose 至少完成除集群故障注入外的等价路径。

## Non-Functional Requirements

- 不引入第二业务真相源。
- 保持 \`shared ← engine ← agent\` 依赖方向。
- 所有生产 Secret 由部署状态提供，不进入 UI4A Git。
- 实验根 CA 按用户要求采用固定持久目录保存，不引入复杂托管系统。
- K8s 资源使用 namespace 隔离、requests/limits、PDB 和最小 ServiceAccount。
- 生产启动 fail-closed，禁止认证或 Runtime Backend fallback。
- 数据恢复必须实际演练。
- 所有部署 YAML/模板可 lint、可重复渲染。
- 内网镜像流程遵守目标集群 \`ctr --all-platforms\`、本地缓存和 \`IfNotPresent\` 限制。
- 每个阶段结束系统保持可运行。
- 既有 I1–I7 和 T15–T21 验收不得回归。

## Acceptance Gates

- \`pnpm check\`、相关 E2E 和新增安全测试通过。
- Web、Worker、Runner 镜像 build/smoke/scan 通过。
- Docker Compose 从空 volume 部署成功并通过 U1、U3–U9、U13、U14、U16。
- mothership K8s 实际部署成功并通过 U2–U16。
- 两 Web 副本并发测试通过。
- Token negative corpus 100% 拒绝正确。
- Agent Runtime 两后端 canonical corpus 100% 通过。
- 备份恢复 drill 成功，Business Snapshot hash 一致。
- 所有关键 Pod readiness 正确，故障时不误报 ready。
- runbook 由干净环境按步骤复跑，无隐含手工步骤。
- \`v0.1.0-experimental.1\` release artifacts 与 evidence 完整。
- Critical/High 身份、数据一致性和可恢复性问题为零。

## Out of Scope

- 公网 DNS、公共 CA 和互联网暴露。
- 多地域、跨集群容灾。
- 在当前两 Worker 实验集群上声称未经验证的高可用 SLA。
- 用户自助创建 realm/client。
- 请求侧选择 Provider、模型、镜像、cwd 或 Runner。
- Agent 自动 merge、push、deploy、activate 或批准结果。
- 引入第二套业务命令协议。
- 把 Kubernetes 或 Temporal 历史当成业务真相。
- 正式 GA、长期支持或生产 SLA。
