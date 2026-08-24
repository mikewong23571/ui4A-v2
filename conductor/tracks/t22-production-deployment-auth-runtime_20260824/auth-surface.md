# T22 v0.1 实验版认证暴露边界

本文是 Phase C checkpoint 的限制清单，适用于 `v0.1.0-experimental.1`。它遵循
[D35](../../../DECISIONS.md#d35-t22-v01-实验版收敛为单实例身份与部署主路径2026-08-24)，只声明
Golden Story、CLI 和 Agent 合同主路径，不把局部认证证据描述成全面 route authentication 或
全面 service-to-service OIDC。

关联文档：[Track index](./index.md)、[验收证据合同](./evidence.md)。本文描述当前代码接线；Compose
和 K8s/Istio 的真实部署证据必须按 evidence contract 另行记录，不能由单元测试结果推定。

## 结论

实验版采用单 Keycloak instance、单 realm、`ui4a-web`、`ui4a-agent`、`ui4a-api` 三个 client。
浏览器使用 Authorization Code + S256 PKCE 和单 Web 进程内 Session；CLI 直接携带外部取得的
Bearer Token；Agent 使用 Client Credentials 或 Standard Token Exchange。应用只从已验证凭证
派生 actor、principal、scope 和 policy scope。inline Agent 的 canonical delegation 仅为已验证的
human `sub` 加 exchanging client `azp`，不读取或扩展 `act`/`may_act`。

这不是全站 OIDC。Golden allowlist 之外的动态 API 必须由 Compose edge 与 K8s/Istio edge 拒绝或
不暴露；不能因为 UI4A 主路径已校验 Token 就把其他 route 标为受保护。

## UI4A_HOST Golden allowlist

下表是 v0.1 外部入口的 method + exact path 清单。查询参数不扩大 path 权限。Next.js HTML 页面与
构建生成的静态资源是展示资产，应由部署清单单独列出；它们不构成业务授权入口，也不能用来放宽
`/api/*`。

### 明确公共入口

| Method | Exact path | 当前语义 |
| --- | --- | --- |
| `GET` | `/live` | 仅表示 Web 进程可应答。 |
| `GET` | `/version` | 公开实验版本与构建信息。 |
| `GET` | `/api/health` | 当前公开的数据库 dependency 状态；不是 Phase D `/ready`，`degraded` 不能作为 Ready。 |
| `GET` | `/api/render/catalog` | 静态、无业务状态的 render vocabulary catalog。 |
| `GET` | `/auth/login` | 发起 Authorization Code + PKCE；不返回业务数据。 |
| `GET` | `/api/auth/callback` | 校验登录关联、state、nonce 和 ID Token，建立 opaque Session。 |
| `POST` | `/auth/logout` | 清理本地 Session 并尝试撤销 refresh credential；无 Session 时只清 Cookie 并跳转。 |

公共表示“不要求已有 UI4A application credential”，不表示跳过输入校验、同源跳转约束或 OIDC
协议校验。

### 已接入 application credential 的入口

| Method | Exact path | Credential / 最小 scope | v0.1 用途 |
| --- | --- | --- | --- |
| `GET` | `/.well-known/ui4a.json` | Browser Session 或 Bearer；`ui4a:read` | Business sitemap / CLI discovery / Agent discovery。 |
| `GET` | `/api/entity` | Browser Session 或 Bearer；`ui4a:read` | Business entity read。 |
| `POST` | `/api/exec` | Browser Session 或 Bearer；普通动作 `ui4a:write`，confirmation approve/reject 为 `ui4a:approve` | 单动作裁决和 human-only approval。 |
| `POST` | `/api/exec-plan` | Browser Session 或 Bearer；`ui4a:write` | Golden Story 的批量合同执行。 |
| `POST` | `/api/chat` | 生产 Browser Session；入口需 `ui4a:read` | 浏览器 Chat；inline turn 再执行受限 Token Exchange。 |
| `GET` | `/_meta/api/entity` | Browser Session 或 Bearer；`ui4a:read` | Canonical Meta entity read。 |
| `POST` | `/_meta/api/exec` | Browser Session 或 Bearer；普通动作 `ui4a:write`，approve/reject 为 `ui4a:approve` | Canonical Meta action 与 human-only approval。 |

生产请求里的 body/query/普通 header actor、principal、scope 和 delegation 都不是身份事实。直接
handler alias `/api/meta/entity` 与 `/api/meta/exec` 虽复用相同 application credential 校验，外部
edge 只应暴露上表中的 canonical `/_meta/*` 路径，避免形成第二套公开 URL。

### CLI、inline Agent 与 Worker Activity

- CLI 不提供登录和 Token 管理。配置了外部 Bearer Token 时，它只把该 Token 用于 discovery、
  entity、exec、exec-plan 和 Draft/Meta 合同调用，并停止发送 local-demo 自报身份字段。
- Browser inline Chat 从已验证的进程内 Session 取得 human subject Token，每个 turn 请求一次
  Standard Token Exchange。交换后的 credential 只存在于 same-origin、HTTPS、exact-path bounded
  fetch closure。接收端仍按 issuer、audience、signature、expiry 和 scope 独立验证。
- inline Agent 的 fetch allowlist 当前包含 business sitemap/entity/exec/exec-plan 与 Meta
  sitemap/entity/exec；其中 Meta sitemap 接收端尚未校验 application credential，因此
  `/_meta/.well-known/ui4a.json` 不属于本版本外部 Golden allowlist，部署 edge 必须拒绝它。此限制
  意味着 v0.1 不验收依赖 Meta sitemap 的 inline 导航。
- durable Worker Activity 不继承浏览器 Token，也不把 Token 写入 Temporal history、event 或日志。
  每次 Activity 通过 `ui4a-agent` Client Credentials 取得 service identity，且只允许同一 canonical
  HTTPS origin 的以下 exact paths：`/.well-known/ui4a.json`、`/api/entity`、`/api/exec`、
  `/api/exec-plan`。
- durable Worker 的 service identity 不是 human delegation。只有 Browser inline exchange 形成
  `sub + azp` delegation；service credential 不能批准 human-only action。

## KEYCLOAK_HOST 最小协议面

UI4A 当前只依赖下列 realm protocol paths；部署不得为 v0.1 暴露 Keycloak 管理控制面：

| Method | Exact path | 调用者 |
| --- | --- | --- |
| `GET` | `/realms/ui4a/protocol/openid-connect/auth` | 浏览器登录跳转。 |
| `GET` | `/realms/ui4a/protocol/openid-connect/certs` | UI4A Web 的 JWT/ID Token 验证。 |
| `POST` | `/realms/ui4a/protocol/openid-connect/token` | Web code exchange/refresh、inline token exchange、Worker client credentials，以及外部 CLI 取 Token 的实验流程。 |
| `POST` | `/realms/ui4a/protocol/openid-connect/revoke` | UI4A Web logout 撤销 refresh credential。 |

如果部署把 issuer realm 名配置为非 `ui4a`，上述 `/realms/ui4a` 必须机械替换为 canonical issuer 的
realm path，并把渲染结果作为 evidence；不得同时暴露多个实验 realm 路径。

## 独立共享密钥内部回调

以下入口不是 OIDC，使用独立共享密钥 header 和常量时间比较：

| Method | Exact path | 用途 |
| --- | --- | --- |
| `POST` | `/api/internal/capability-callback` | legacy Capability Run source finalize。 |
| `POST` | `/api/internal/agent-run-callback` | canonical Agent Run source finalize。 |

它们只能经 Web/Worker 内部网络调用，必须从 UI4A 外部 Gateway、VirtualService 和 Compose published
port path allowlist 中排除。共享密钥值不得进入本文、Git、日志、Temporal history 或验收 artifact。
这两个 callback 的证据只能证明独立 shared-secret authentication，不能计作 service-to-service
OIDC。

## 未纳入 OIDC 的动态入口

当前下列 route 没有接入统一 application credential adapter，因此不属于 v0.1 外部认证面：

| Method | Exact path | 当前风险/限制 |
| --- | --- | --- |
| `GET` | `/_meta/.well-known/ui4a.json` | 仍从普通 header/query 构造 Meta context；必须 deny/not expose。内部 alias `/api/meta/.well-known/ui4a.json` 同样不得暴露。 |
| `GET` | `/api/events` | 可读原始事件并接受普通 principal filter；必须 deny/not expose。 |
| `GET` | `/api/chat/history` | Chat 历史未绑定 credential principal；必须 deny/not expose。 |
| `GET` | `/api/chat/sessions` | Session 清单未绑定 credential principal；必须 deny/not expose。 |
| `GET` | `/api/delegations` | 委托清单未绑定 credential principal；必须 deny/not expose。 |
| `GET` | `/api/delegations/{id}` | 委托详情使用动态 path 且未绑定 credential principal；必须 deny/not expose。 |
| `POST` | `/api/presentation` | Presentation request 未接入 request identity；必须 deny/not expose。 |
| `GET`, `POST` | `/api/presentation/sidecar` | 仍使用固定 local principal/自报 human lifecycle；必须 deny/not expose。 |

`/api/health` 和 `/api/render/catalog` 因为被明确归类为公共入口，不属于“遗漏认证”。除公共入口、
已认证 Golden allowlist、内部 callback 和部署明确列出的 HTML/static assets 外，edge 采用 default
deny。尤其不能使用 `/api/*`、`/_meta/*` 或任意 prefix wildcard 代替 exact-path allowlist。

## 单副本 Session 与重启边界

浏览器 login transaction 和 Session 只保存在单 Web 进程内的 private store。Cookie 是 opaque 且
带完整性保护，Token 不在浏览器可见 Cookie 中；但 Web 重启会清空 store，现有 Cookie 随即失效，
用户必须重新登录。这是 D35 接受的单副本实验限制，不是 durable Session、跨副本 Session 或 HA。

Web/Worker 重启后的业务状态与 durable Workflow 恢复仍由 PostgreSQL/Temporal 验收；它不意味着
浏览器登录状态恢复。发布说明和重启验收必须同时记录“业务/Workflow 可恢复”和“浏览器需重新
登录”两个事实。

## Phase C checkpoint 与后续 edge 证据

Phase C 代码 checkpoint 在当前 Git SHA 上记录下列第 1–9 项证据。第 10 项属于 Phase H/I 的
Compose/K8s 实际 edge gate，不反向阻塞 Phase C 代码 checkpoint；单元测试也不能替代它：

1. 对每个 application-credential route，缺失 Token/Session、过期 Token、错误 issuer、错误
   audience、错误 signature、unknown `kid`、JWKS unavailable/stale 分别 fail closed，并且不执行
   engine、数据库写入或 Agent loop。
2. scope 不足和 policy scope 越权返回稳定 403；请求 body/query/普通 header 伪造 actor、principal、
   scope、channel、delegation、Istio marker 均不能覆盖 credential identity。
3. Agent/service credential 对 business confirmation 和 Meta approve/reject 的 human-only action
   100% 被拒；拒绝事件保留 credential-derived principal、scope 以及适用时的 `sub + azp` audit。
4. Browser PKCE 使用 S256；callback 必须拒绝 missing/unknown/replayed state、缺失 code、错误 nonce、
   无登录关联、无效 ID Token 和 Keycloak/JWKS outage；return target 不能形成 open redirect。
5. Session Cookie 篡改、过期、撤销和 refresh failure 均诚实失败；logout 清理本地 Session，Web
   restart 后旧 Cookie 失败并要求重新登录。
6. CLI Bearer 主路径不发送自报身份字段；401/403 不泄露 Token。只有明确无 Token 的 local-demo
   profile 才保留旧自报 adapter。
7. Token Exchange 只能收窄 scope；unknown agent client、task 请求覆盖 grant/provider/model/cwd、
   exchange response 扩权、错误 `sub + azp` 全部在网络或执行边界前失败。`act`/`may_act` 不参与
   canonical delegation。
8. bounded fetch 拒绝 HTTP、cross-origin、userinfo URL、redirect、相似前缀和所有非 exact-path
   请求，且错误和日志不包含 human Token、exchanged Token 或 client secret。
9. Worker Activity 每次取得 service credential，仅调用四个 exact business contract paths；Token
   endpoint unavailable、非 canonical base URL 和越界 path 均失败，Temporal history/event/log 无
   credential。
10. 对 UI4A_HOST 与 KEYCLOAK_HOST 渲染后的 Istio/Compose edge 做实际请求矩阵：Golden allowlist
    按 public/authenticated 语义通过，本文“未纳入 OIDC”及两个内部 callback 从外部均不可达；直接
    `/api/meta/*` alias 和 prefix 变体不可达。

最终 evidence 至少记录 Track、Git SHA、Web/Worker/Runner image digest、部署形态、命令、时间、
结果和无敏感值的失败码。当前代码级 route wiring 只支持 Phase C checkpoint，不代表上述 edge
矩阵已经在 Compose 或 mothership K8s 上通过。
