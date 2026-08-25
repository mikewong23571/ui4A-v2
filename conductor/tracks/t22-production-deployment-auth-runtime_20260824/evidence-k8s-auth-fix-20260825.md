# T22 K8s 认证可用性修复与 Golden Story 身份链证据(2026-08-25)

> 关联 Track:T22;证据口径遵循 [evidence.md](./evidence.md)。本文不含 Secret、Token、
> Cookie 或私钥;credential 材料仅在运行时从 `ui4a-runtime-secrets` 读取。

## 背景与问题

`v0.1.0-experimental.1`(image revision `44a1fe3`)部署后,人类浏览器主路径不可用:

1. 未认证访问任何页面只得到数据加载失败的壳,全站无登录引导(UI 从不跳转 `/auth/login`)。
2. `GET /api/events` 不在 Istio/Caddy edge 白名单,edge 默认 deny → 404;且该路由此前直接信任
   `x-ui4a-principal` header,未接生产 credential 校验。
3. 浏览器客户端从不携带 policy scope;`/api/entity`、`/api/exec`、`/api/exec-plan` 未带 scope 时
   硬编码落 `development` default scope,已登录用户访问 `articles`(publishing)/`comments`、
   `inbox`(default)全部 403 `scope_insufficient`。

## 修复(已提交为 `09ab20d`,基于 `8ba3fd2`,决定 D38)

- 服务端 credential 模式下未显式请求 scope 时,按 rel 归属在已授予 scope 中确定性选择第一个
  覆盖的 scope(`relCoveredByPolicyScope`);显式 scope 语义不变,不扩大授权。
- `/api/events` 接入 `resolveTrustedRequestIdentity`(`ui4a:read`;principal 过滤不得超出
  credential principal),进入 Istio AuthorizationPolicy、VirtualService 与 Caddy 白名单,
  auth-surface.md 同步。
- 浏览器端 401 认证错误码统一 `redirectToLoginOnAuthError` 跳转 `/auth/login?returnTo=…`;
  403/scope_insufficient 不跳转。

## 质量门(本地,代码 = 后提交为 `09ab20d`)

- focused Vitest(改动相关 10 文件)84/84;`apps/web/src/{auth,app/api,components}` 回归
  445/445。
- `pnpm check` 全绿:typecheck 7 workspaces、ESLint、Vitest 335 文件 2581 通过
  (7 文件/13 用例因本机无 Temporal dev server 按既有约定跳过)。

## 部署(roll-forward,非 release 重发)

- Web image `docker.io/ui4a/web@sha256:b9e97b666b014a05ab242ec52d6678035cb8d9a90c97f6ab5cdd75bfeb140630`
  (tag `v0.1.0-experimental.1.t22auth2`;两 worker 节点 `ctr import` digest 一致;
  archive SHA-256 `0006d4d558f5f21a23c0756d0e273403b184151593fd7db17436795d0b6f9117`)。
- chart 为工作树 `deploy/helm/ui4a`(含 `/api/events` edge 放行);values 仅替换 web digest。
- `helm lint`/`helm template` 通过;`helm upgrade` rev 23→24,web Pod `web-6ffc5d66c5-7jm4j`
  Running 2/2,image 与上述 digest 一致。Worker/Runner/stateful 组件未动。
- 注意:镜像 OCI revision 标签为 `8ba3fd2`(构建时 HEAD),实际内容即后续提交 `09ab20d`
  (提交前构建,工作树与提交内容逐字节一致,未再重建)。

## E3 身份链验证(对 rev 24 最终镜像)

### 浏览器认证 UX(Playwright + 本机 Chrome,headless)

| 用例 | 结果 |
| --- | --- |
| 未认证访问 `/` 自动 302 → Keycloak `openid-connect/auth`(PKCE S256) | PASS |
| Keycloak 表单登录 → `/api/auth/callback` → 回跳 `/`(session cookie 建立) | PASS |
| 首页态势投影加载(修复前显示"读取合同失败") | PASS |
| 跨 scope 实体读取(文章数 stat = 3,articles 属 publishing) | PASS |
| `/api/events` 已认证 200(edge 放行 + credential 校验) | PASS |
| flow 页 `flow:article-drafting` 渲染 | PASS |
| POST `/auth/logout` 清理会话 | PASS |
| 登出后 `/.well-known/ui4a.json` → 401 | PASS |

### Golden Story 人类段(浏览器完成完整业务 Flow)

`article-drafting`:basic-info(标题)→ classification(分类)→ content(正文)→ ready →
发布成功,文章集合可见;事件 principal = credential `sub`(`954c2102-…`),非浏览器自报
`local-user`。6/6 PASS。

### Golden Story Agent 段(RFC 8693 + human-only approval)

1. human PKCE 自管 verifier 取 access token(不经过 web session)。PASS
2. human Bearer 直读业务实体 200。PASS
3. agent client credentials(ui4a-agent)成功。PASS
4. RFC 8693 token exchange,scope 收窄为 `ui4a:read ui4a:write ui4a:policy:publishing`。PASS
5. 换得 token `azp=ui4a-agent`、`sub`=human sub(canonical `sub + azp` delegation)。PASS
6. agent 读 sitemap 200。PASS
7. agent 对 published post 发起 `archive`(requires-confirmation=high)→ HTTP 202
   `status=suspended`,产生 pending confirmation(c3),未直接生效。PASS
8. agent 对该 confirmation `approve` → 422 `guard-failed: actor-is-human=false`
   (human-only approval 拒绝并留痕)。PASS
9. human `approve` → 200,post 进入 `archived`。PASS
10. 复读确认已归档。PASS(合计 12/12)

(首轮在 rev 23 上同样 12/12 通过,c1/c2 遗留挂起已由 human reject 清理。)

## 附:同批修复的 e2e 装置口径

T22 readiness 契约落地后,`/api/health` 的 `status` 仅在全部(含 optional)依赖 ok 时为
`"ok"`;dev/e2e 环境不接 temporal/keycloak/llm/runtime 探针,恒为 `degraded`,导致
`CI=true pnpm e2e` 的 serving 等待(`waitUntilHealthy` 断言 `status === 'ok'`)永久超时——
T22 后全量 e2e 在本机从未跑通过(plan 质量门未勾选的实证)。本批把三处装置对齐到 readiness
口径(`readiness === 'ready' && db === 'ok'`,required 依赖全 ok 即 serving):

- `e2e/server-kit.ts`、`e2e/baseline.spec.ts` 的 `waitUntilHealthy`;
- `e2e/smoke.spec.ts` 的 `/api/health` 断言(改断 `readiness === 'ready'`)。

验证:`CI=true pnpm e2e invariants` 4 passed / 2 skipped(约 2 分钟,含 I5 全量重放 hash
一致);`CI=true pnpm e2e smoke baseline` 5 passed / 2 skipped。另修 `e2e/s4.spec.ts` 三处
planDetail 断言补 T22 identity 审计块(plan-completed/plan-rejected/plan-suspended,
T22 起事件 detail 携带 identity,断言腐烂非行为回归)。

全量回归:`CI=true pnpm e2e` 43 passed / 31 skipped / 0 failed(约 7 分钟;skipped 为真实
LLM/Codex 凭据门槛用例,与本批无关)。

## 追加:`/api/delegations` 缺口修复(2026-08-25,同日第二轮)

委托监控页报"服务不可用"——`/api/delegations` 与 `/api/delegations/{id}` 属于 auth-surface
"未纳入 OIDC"清单,edge 按合同 404;页面后端不可达。本轮把两路由接入 application credential
(production profile,Browser Session 或 Bearer,`ui4a:read`;全局只读投影,无 per-principal
过滤;local profile 行为不变),edge 放行 exact `/api/delegations` + prefix `/api/delegations/`
(istio.yaml/render.ts/Caddy 三处),auth-surface.md 相应两行移入已认证表。

- 测试:`apps/web/src/app/api/delegations/route.production-auth.test.ts` 新增 6 例
  (401 fail-closed 不读投影/凭证 200/local 不变,列表+详情);既有集成测试改传 Request 实参;
  两个 edge 契约测试同步放行并移出 deferred 清单。
- 质量门:`pnpm check` 全绿(336 文件 2587 通过)。
- 部署:代码已提交为 `39b9c7e`;web 镜像
  `docker.io/ui4a/web@sha256:97b587227fefc6498dd39d5a0e50ca64229ec55570752820c3d54f962b1a75e3`
  (tag `v0.1.0-experimental.1.t22auth4`,OCI revision 标签 = `39b9c7e`;archive SHA-256
  `6789c4c409e46b880b5391bfd5edf89fcd4d1f9da943cfdfbd3cb7aab21bf21e`;两 worker ctr import
  一致,并以 digest 引用名补 tag——仅 tag 导入时 kubelet 按 digest 引用会去 docker.io 拉取);
  helm rev 25→26,Pod `web-7fbcc97fdc-qdpf6` Running 2/2。chart/values staging 在
  k8s-cp-1:/tmp/ui4a-release-t22auth4。(中间 rev 25 为提交前构建的 t22auth3,内容与本提交
  一致,已被 rev 26 取代。)
- 线上验证:未认证 `/api/delegations` 与 `/api/delegations/wf-x` → 401(fail closed,应用裁决
  而非 edge 404);`/api/chat/history` 仍 404(deferred 不变)。已登录浏览器(Playwright
  headless Chrome,PKCE 全链)4/4:登录 → `GET /api/delegations` 200 → 委托监控页无错误横幅、
  呈现合法空态(执行中 0)。

## 追加:meta 控制台与 chat 全链修复(2026-08-25,同日第三轮)

用户在 meta 控制台看到"读取定义合同失败"、chat 发问得到"失败: [object Object]"。逐层定位
并修复四个问题,最终 chat inline 全链(登录 → Session → Token Exchange → bounded fetch →
真实 LLM)打通:

1. **meta sitemap 未接 credential**(auth-surface deferred 项):`/_meta/.well-known/ui4a.json`
   路由 production 接入 `resolveTrustedRequestIdentity`(`ui4a:read`),authorizedScopes 收窄为
   granted policy scopes;edge 放行(istio/render.ts;Compose Caddy 本就放行——两形态白名单
   此前不一致)。提交 `5d96971`。
2. **chat origin 校验不适配 TLS 终止**:pod 内 `request.url` 协议恒为 http,与配置
   `https://…:32067` publicOrigin 不匹配 → 400 `request_origin_invalid`,前端又把
   `{error:{code}}` 对象插值成 `[object Object]`。修复:以 edge 覆写的
   `x-forwarded-proto` + Host 重建外部 origin(伪造 Host 仍拒);chat-panel 结构化错误取
   code 展示。提交 `ba39b0f`。
3. **inline exchange 只带单一 policy scope**:取 agentScopes 第一个(`default`),agent 读
   articles(publishing)403。修复:交换请求携带 human granted ∩ agentScopes 的全部
   policy scope(剥离 `ui4a:approve`,仍严格收窄),逐请求收窄由接收端 scopeCoverage 负责。
   提交 `0d18e3e`。
4. **deferred 校验白名单误报**:接收端 `delegatedScopesByClient` 仍按单 scope 收窄 →
   403 `delegation_scope_exceeded`。修复:白名单与交换携带的 policy scopes 对齐。
   提交 `e0a5ec7`(该改动曾被 T23 工作 stash,经 `git stash pop` 恢复后提交)。
5. **web 进程缺 LLM env**:settings/secrets 文件里 LLM 合同齐备(baseUrl/model/apiKeyRef,
   preflight 已强制),但无人导出 `LLM_*` 环境变量 → 诚实失败"LLM 配置缺失"。修复:
   `instrumentation.ts` register 在 production preflight 后导出 LLM_BASE_URL/LLM_MODEL/
   LLM_API_KEY(显式预设优先,缺项不写)。提交 `9540b84`(pathspec 提交,未触碰并发的
   T23 在途改动)。

- 质量门:第 1–4 项各自 `pnpm check` 全绿(至 2593 通过)。第 5 项提交时工作树含 T23 在途
   staged 删除(legacy capability-run 移除),全量 typecheck 暂不可跑;该项由
  `instrumentation.llm-env.test.ts` 4 例 + instrumentation 既有套件覆盖(10/10)。
- 部署:镜像 `docker.io/ui4a/web@sha256:d234f91801932054372b700b9255696d8f7c0633c7da337d7f6d41d9078f2c9b`
  (tag `v0.1.0-experimental.1.t22auth8`,OCI revision = `9540b84`;archive SHA-256
  `111607f91880a4ca05382315ecf89fcb33e197caf0a0162132cefef3f3f75fb5`;构建在
  `git worktree` 干净副本上进行,规避 T23 在途状态;构建前清理了本机 docker 磁盘
  [100%→53%])。helm rev 27→30(中间 28/29 为 t22auth6/7),Pod `web-dd4b495c6-ggw87`
  Running 2/2。staging 在 k8s-cp-1:/tmp/ui4a-release-t22auth8。
- 线上验证:meta 控制台 4/4(sitemap 200 credential、页面就绪);chat POST 200,真实 LLM
  回答"OK",outcome=answered,turn 事件落库(sessionId=credential sub)。

## 追加:canvas Sidecar 404 修复(2026-08-25,同日第四轮)

- 症状:chat 让 agent 在画布展示文章后,`/canvas?sidecar=sidecar:…&focus=post:…` 报
  `Sidecar … → HTTP 404`。
- 根因:`/api/presentation` 与 `/api/presentation/sidecar` 未接入 request identity,
  Sidecar 归属固定为 `user:local`——chat 以已认证 principal 建立的 durable Sidecar 在
  canvas 读路径下查不到;且 edge(istio VirtualService/AuthorizationPolicy、Compose
  Caddy)未放行这两路(auth-surface.md 原列为 deferred "必须 deny/not expose")。
- 修复(提交 `e3b56eb`):
  - `/api/presentation` POST:production 强制 credential(`ui4a:read`),以已认证
    principal 覆盖客户端自报 principal 作为 durable Sidecar key 归属;
  - `/api/presentation/sidecar` GET(`ui4a:read`)/POST(`ui4a:write`):同样接入
    credential 并按已认证 principal 读写;human lifecycle(`actor: 'human'`)约束不变;
  - local profile 两路行为完全不变;
  - edge 按 exact path 放行两路(render.ts、istio.yaml VirtualService+
    AuthorizationPolicy、edge-routing.caddy);auth-surface.md 与
    `t22-k8s-auth-edge-contract.test.ts`/`t22-compose-contract.test.ts` 同步收口,
    deferred 清单收敛为 `/api/chat/history`、`/api/chat/sessions`、`/api/meta/`。
- 质量门:vitest 47/47(既有 presentation 路由 4 例、新增 production-auth 8 例
  [401/已认证 principal 覆盖/local 不变、GET read/POST write 口径]、t22 两个 edge 合同
  套件)。提交时工作树仍含 T23 在途改动,全量 typecheck 不可跑;改动文件 ESLint 全绿。
- 部署:镜像 `docker.io/ui4a/web@sha256:c16064a64ecb50cf6acc42886a9dd3c8f4e0227728c6f349f561e22daffb0d56`
  (tag `v0.1.0-experimental.1.t22auth9`,OCI revision = `e3b56eb`;worktree 干净副本
  构建;两 worker 均已 import 并补 digest 引用名)。helm rev 31,Pod
  `web-5dc95844f7-9gzht` Running 2/2。staging 在 k8s-cp-1:/tmp/ui4a-release-t22auth9
  (chart 模板已从该提交同步,istio.yaml 含 presentation 两路)。
- 线上验证(Playwright headless Chrome,真实登录 ui4a-experiment-human):6/6——直取用户
  报告的 `sidecar:53201e98f1940fa7` 返回 200(version=1,subject=post:post-welcome,不再
  404);报告的 canvas URL 整页无 404 错误卡且渲染《欢迎来到 UI4A》正文;无 sidecar 参数的
  `/canvas?focus=post:post-welcome` 直达链路(POST /api/presentation → 复用/建立
  Sidecar)同样渲染成功;匿名直取两路均 401。

## 未覆盖(保持诚实边界)

- K8s/Host 两后端 Agent Run 仍为 `failed-honest`(见 RELEASE_NOTES 已知限制),本修复不涉及
  Runtime。
- Compose 形态等价路径未在本轮重跑(契约测试 `t22-compose-contract.test.ts` 已覆盖
  Caddy 白名单变更)。
- 客户端 CA 信任(runbook Step 13)按既有 runbook 执行过,本轮验证使用 `ignoreHTTPSErrors`,
  不作为 CA 信任的新证据。
