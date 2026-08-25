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

## 修复(工作树,基于 `8ba3fd2`,决定 D38)

- 服务端 credential 模式下未显式请求 scope 时,按 rel 归属在已授予 scope 中确定性选择第一个
  覆盖的 scope(`relCoveredByPolicyScope`);显式 scope 语义不变,不扩大授权。
- `/api/events` 接入 `resolveTrustedRequestIdentity`(`ui4a:read`;principal 过滤不得超出
  credential principal),进入 Istio AuthorizationPolicy、VirtualService 与 Caddy 白名单,
  auth-surface.md 同步。
- 浏览器端 401 认证错误码统一 `redirectToLoginOnAuthError` 跳转 `/auth/login?returnTo=…`;
  403/scope_insufficient 不跳转。

## 质量门(本地,工作树 = 8ba3fd2 + 本修复)

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
- 注意:镜像 OCI revision 标签为 `8ba3fd2`(构建时 HEAD),内容 = 8ba3fd2 + 本修复(提交前构建)。

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

## 未覆盖(保持诚实边界)

- K8s/Host 两后端 Agent Run 仍为 `failed-honest`(见 RELEASE_NOTES 已知限制),本修复不涉及
  Runtime。
- Compose 形态等价路径未在本轮重跑(契约测试 `t22-compose-contract.test.ts` 已覆盖
  Caddy 白名单变更)。
- 客户端 CA 信任(runbook Step 13)按既有 runbook 执行过,本轮验证使用 `ignoreHTTPSErrors`,
  不作为 CA 信任的新证据。
