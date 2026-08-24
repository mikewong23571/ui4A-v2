# T22 User Stories — Production-shaped Deployment, Identity and Agent Runtime

> 验收关注用户和运维结果，不以 Pod Running、Helm success、模型自述或命令退出码单独冒充成功。
> 每个故事必须关联 Git SHA、image digest、部署形态与 [evidence contract](./evidence.md)。

## A. 可重复部署

### U1 Compose 一键部署

作为开发者，我能从空 Docker 环境启动完整 UI4A 栈，安装根证书后登录并完成 Golden Story；
第二次启动保留数据与身份配置。

验收：

- 单一、文档化命令启动 PostgreSQL、Temporal、Keycloak、migration、Web、Worker 和 Runner。
- readiness 全绿后才报告成功；失败指出具体依赖。
- `docker compose down` 后重启，业务实体、用户、Workflow 和 artifacts 仍在。
- 明确的 destructive clean 命令要求二次确认，普通停止不删除 volume。

### U2 K8s 从零部署

作为运维人员，我能按照 runbook 在 mothership 集群部署全部组件，每一步都有明确成功和失败判据。

验收：

- 从当前三节点 K8s v1.31.14/Istio 1.24.2 前置状态开始。
- 处理当前无 StorageClass、CRI 不读取 mirror、Istio `Always` pull 等现场约束。
- 所有 image digest 与 release manifest 一致。
- PostgreSQL、Temporal、Keycloak、migration、Web、Worker、Runner 和 Istio resources 全部 ready。
- runbook 不依赖未记录的手工数据库修改、临时端口转发或个人 shell 状态。

## B. 可信身份

### U3 人类登录

作为人类用户，我通过 Keycloak 登录 UI4A；事件中的 principal 来自已验证 Token，而不是浏览器自报。

验收：

- Authorization Code + PKCE、callback、session refresh 和 logout 成功。
- 登录前目标在 callback 后安全恢复。
- 事件记录可信 principal、actor、scope 和 credential provenance。
- body/query/header 伪造身份不能改变事件身份。

### U4 CLI 认证

作为外部 Agent/CLI 用户，我能取得受限 Token、运行 `ui4a doctor`、发现和读取授权合同。

验收：

- 正确 Token 能访问授权 sitemap/entity/action。
- 无 Token、过期 Token、错误 issuer、audience、signature 或 scope 均被拒绝。
- Token、client secret 和 refresh token 不进入 stdout、日志或 audit detail。

### U5 委托身份

作为用户，我能将受限权限交换给 Agent；事件保留 principal 与 `act` 链，Agent 不能扩大 scope。

验收：

- RFC 8693 Token Exchange 产生有界 delegation。
- 交换 scope 必须是原 principal grants 的子集。
- 嵌套 `act` 链有界且可审计。
- 非法 subject/actor token、越权 scope 和错误 audience 100% 被拒绝。

### U6 审批不委托

作为治理者，我确认 Agent Token、自报 `actor=human`、伪造 principal/header 都无法批准 Draft 或
Confirmation；真实人类登录可以批准。

验收：

- Agent、service account、internal callback 执行 approve 均被引擎拒绝并留痕。
- 人类 credential 的 approve 仍需当前 Siren action、guard、schema 和 CAS。
- Istio 放行不能替代应用层 human-only 判断。

## C. Agent Runtime

### U7 容器化 Agent Run

作为用户，我启动 Coding/Writing/Authoring Run 时，默认由隔离 K8s Pod 执行并返回 canonical Run
evidence；Pod 无法扩大授权。

验收：

- 每个 Run 使用固定 profile、image、ServiceAccount、resource、network 和 workspace。
- Provider credential 只进入授权 Run。
- Pod 成功、失败、超时、取消和驱逐均形成可审计终态。
- Coding workspace 保留至人类结果决定，不自动 merge、push、deploy 或 activate。

### U8 宿主机 Agent Run

作为运维人员，我注册一个受信 Host Runner；服务端 profile 可选择它执行同一用户故事，断连、取消
和非法路径均按合同处理。

验收：

- Runner 只能声明服务器配置允许的 capability、root 和资源上限。
- 心跳、租约、identity、restart boundary 和 result callback 可审计。
- 断连后恢复或形成诚实失败，不重复提交结果。
- 任意绝对路径、env、command 或 privilege escalation 请求被拒绝。

### U9 后端不可由用户选择

作为攻击者，我在请求中提交 backend、image、cwd、Provider、模型或环境覆盖，这些字段必须被拒绝
并留痕。

验收：

- Application/Siren action 不暴露这些部署字段。
- HTTP body 中注入这些字段返回 schema/authorization rejection。
- Host Runner 失败不会 fallback 到更宽权限 K8s profile，反之亦然。

## D. 一致性、恢复和运维

### U10 重启恢复

作为运维人员，我能重启 Web、Worker、Agent Pod、Temporal 或节点；已提交业务事实不丢失，在途
任务恢复或给出可审计终态。

验收：

- Web/Worker restart 后从 PostgreSQL/Temporal 恢复。
- pending confirmation、Draft、Sidecar 和 Agent Run 可重新读取。
- 不依赖进程内 session、Promise queue 或未持久化工作状态。

### U11 备份恢复

作为运维人员，我能从真实备份恢复 PostgreSQL、Keycloak、Temporal 和必要 artifacts，并验证事件
重放结果一致。

验收：

- 备份有名称、校验和、时间、版本和目标路径。
- 恢复在隔离目标执行，不破坏原环境。
- 恢复后可登录，Workflow/Run 可查询，关键 artifact 可验证。
- Business Snapshot hash 与恢复前一致；记录实测 RPO/RTO。

### U12 扩缩容并发

作为运维人员，我运行两个 Web 副本并并发操作同一资源；系统只产生合法结果，竞争者得到带原因的
拒绝，日志与重放一致。

验收：

- 跨 Pod 裁决不依赖单进程 Promise queue。
- 同一资源的 guard 读取与事件 append 位于数据库级单 atom。
- 竞争结果、事件 seq、projection 与 replay hash 确定。

### U13 TLS 与 OIDC

作为内网用户，我信任一次根 CA 后，能无证书警告访问两个域名，OIDC redirect、issuer 和 logout
均正确。

验收：

- UI4A 与 Keycloak 使用不同内网域名。
- SAN、issuer、certificate chain 和 Istio credential 正确。
- 首次生成后重复部署不覆盖根 CA/私钥。
- 文档给出根 CA 安装、备份和恢复命令。

### U14 依赖故障诚实呈现

作为用户，当 LLM、Temporal、Keycloak、数据库或某个 Runtime Backend 不可用时，我得到准确、可
恢复的错误；系统没有伪成功或未经授权副作用。

验收：

- liveness 与 readiness 语义分离。
- `degraded` 不冒充 ready。
- 只读/人工能力若仍安全可用，应与不可用 durable operation 明确区分。
- 故障恢复后重试遵守幂等和 CAS。

### U15 升级与回滚

作为运维人员，我能部署新镜像、执行兼容迁移、验证后切换；失败时恢复旧镜像和升级前备份，事件
真相不被截断或改写。

验收：

- 升级前有验证过的命名备份。
- migration 与应用版本兼容窗口明确。
- rollout、smoke、rollback 和数据恢复命令均现场执行。
- 回滚后关键实体和 Business Snapshot hash 正确。

### U16 两种部署形态合同一致

作为维护者，我在 Compose 和 K8s 上运行同一核心验收 corpus，身份、裁决、Agent Run 和审计结果
保持语义一致。

验收：

- 两种环境使用同一 Git SHA 和 OCI image digest。
- 配置名义和 Secret 语义一致。
- 允许环境拓扑差异，不允许身份、权限、Run 或业务结果漂移。

## E. 首个试验性版本

### U17 可安装、可验证的试验性发布

作为试用者，我可以依据一个固定 release manifest 部署 `v0.1.0-experimental.1`，并清楚知道它
验证了什么、没有承诺什么。

验收：

- Git tag、Web/Worker/Runner digests、checksums、SBOM 和 release notes 完整。
- Compose 与 mothership K8s evidence 可追溯到同一 release。
- 已知限制明确包含内网实验、当前非 HA、Runtime backend 限制和升级兼容范围。
- 文档不使用 GA、正式 SLA、长期支持或未经验证的 production-ready 声称。

## Golden Story

```text
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
```
