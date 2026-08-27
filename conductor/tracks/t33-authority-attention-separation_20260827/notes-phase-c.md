# T33 Phase C 核对与证据补强 — Notes

> 阶段:Phase C(注意力核对 + CLI 纪律证据 + 新应用零改动证据)
> 依据:architecture.md §三/§四/§七、spec.md「归后续」节、DECISIONS.md D51
> 前置:Phase A/B 已落地(commit 216a6e4/c0ae492);五景 e2e a/b/e 绿。
> 范围纪律:未改授权谓词语义、未动 chat/driver 表述策略、未做「未定位」一等态
> 改造(显式 > presence > 首次授予兜底保留,§九开放问题不动)。

## C1 核对结论:agent 披露不回归(无旁路)

核对对象:T25/T29 成果的处境装配消费点——chat 路由
(`apps/web/src/app/api/chat/route.ts`)→ `runAgent` options
(`sitemap` / `startRel` / `app` / `clientView` / `lastNavigation`)→
`apps/web/src/engine/chat-situation.ts` 的 `situationForChat` /
`assembleSituation` 链。

### (a) 披露切片来源 = situation 单点装配 ✅

- L1 镜头内地图:`runAgent` 的 `sitemap` 是 HTTP 合同并集(宽合同),收窄发生在
  prompt 装配层——`packages/agent/src/loop/loop.ts:317-321` 以
  `currentApp = options.app`(= `situation.scope`)、`currentRel = options.startRel`
  (= `startRelFromSituation(situation)`)预切 `sliceSitemapDisclosure`,
  `packages/agent/src/llm/prompts.ts` 再复切(注释登记:两次切割幂等,有意设计)。
- L2 近景:逐步 `entity` 工具走 HTTP 合同读取(授予并集口径),动作/链接来自
  合同投影(咽喉点按授予集合 × 归属过滤),不来自任何会话态。
- 落点:`startRel` 唯一产出于 `route.ts:948` 的 `startRelFromSituation(situation,…)`;
  `scope` 唯一产出于 `situationForChat`(route.ts:819)。

### (b) 全库 grep 无路由旁路自算 lens ✅

`apps/web/src/app/**` 内 `assembleSituation|situationForChat|situation.scope|startRel`
的命中全部收敛到 `api/chat/route.ts`(situationForChat 属单点的入口侧调用,合规):
- `assembleSituation` 在 app/** 零命中;全仓唯一生产者为
  `engine/chat-situation.ts:44/53`(situationForChat 内部);
- `situationForChat` 仅 route.ts:819 一处调用;
- `situation.scope/site/thread` 均为对已装配 situation 的读取(route.ts:932/961/988/1037/1111),
  无重算;
- `startRelFromSituation` 仅 route.ts:948 一处生产;
- `loadPresenceForPrincipal` 在 app/** 零命中(presence 读取只经 chat-situation);
- `filterSitemapForPolicyScope(s)` 仅 `.well-known/ui4a.json` 路由使用,是**授予并集**
  的宽合同(sitemap-scope-union),非 lens;
- meta 站 `.well-known` 与 `meta/entity` 对 `identity.policyScope` 的使用仅为
  `effectiveScope` 响应元数据展示槽位(D51:显式 ?scope= 导航偏好,注释已登记),
  内容恒按授予并集返回;`declaredScopePreference` 只在授予集合内透传。

**结论:无第二实现,无需收敛改动。** architecture §八.2 所称「第 5 处旁路清零」
由本阶段 grep 证据复核成立。

## C2 CLI 纪律证据测试(D51 补充不变量:宽合同窄披露)

| 锚 | 位置 | 断言 |
| --- | --- | --- |
| (D51-宽合同) | `apps/web/src/app/.well-known/ui4a.json/route.production-auth.test.ts` | credential 身份 grantedApplications=['default','publishing'] → `version=test-version:default+publishing`,surfaces/flows/applications 为两应用并集,未授予的 community 不进发现文档 |
| (D51-窄披露) | `apps/web/src/engine/chat-situation.test.ts` | lens=default(clientView 显式)经 situation 单点装配 → `disclosure.scope='default'`,`startRel='overview'`;`sliceSitemapDisclosure({scope,currentRel})` 后 publishing 域 surface 收窄为 `{rel,title}` 导航入口、分组披露仅剩 default 应用,JSON 不含 publishing flow 详情 |

两锚互为对照:宽合同证明 HTTP 恒按授予并集返回(外部 CLI 承诺),窄披露证明
内置 agent 的「少看」只发生在 prompt 披露层。

fixture 变更说明:production-auth 套件引擎 fixture 增补 default 应用
(surface/flow/application + snapshot),既有「本地信任域全量 sitemap」断言同步
更新(现在含 overview 面),语义不变。

## C3 新 application 注册演练(D51 不变量#5)

`apps/web/src/auth/application-scope.test.ts` 新增 `describe('D51-新应用零改码')`,
向 fixture snapshot/sitemap 注册假应用 `fixture-app`(含 flow 定义 `fixture-flow`
归属、实例 `fixture:item-1`、集合面 `fixture-items`),**零产品代码改动**:

1. `assertReachable`:granted 含 fixture-app → 通过;不含 → 机械拒绝
   (mechanical code `scope_insufficient`,呈现层映射 reasonCode=audience-unreachable);
2. `filterEntityForGrantedApplications`:按受众集合裁剪 links/entities,
   count 同步重算;
3. sidecar 读咽喉 `getAuthorizedPresentationResult`(mock 引擎,纯单元):
   granted 含 → `authorized`;不含 → `audience-unreachable`;无实体 →
   `subject-unavailable`(三态全绿)。

## 验证记录

| 门 | 命令 | 结果 |
| --- | --- | --- |
| 五景 e2e | `CI=true playwright test e2e/t33-authority-attention.spec.ts` | **3 passed / 2 skipped**(c/d 锚点在 Phase B vitest,skip 占位) |
| 不变量+重放 | `CI=true playwright test e2e/invariants.spec.ts` | **4 passed / 2 skipped**(I5 全量重放一致:online hash=43922011b292 events=53 rels=31) |
| 全量 vitest | `NODE_OPTIONS=--no-experimental-webstorage vitest run` | **398 passed / 6 skipped 文件;3063 passed / 10 skipped 用例**(skip 均为 Temporal dev server 不可达的集成测试,既定行为) |
| tsc 七包 | 逐包 `./node_modules/.bin/tsc --noEmit`(pnpm shim 异常,plan 既定直调) | 七包全 OK(shared/engine/agent/web/worker/cli/agent-runner) |
| governance | `node scripts/governance/run-all.mjs` | **OK**(GR1/GR2/GR3/GR6;`apps/web/src/auth` 目录 3994/4000,余量 6,只减不增) |
| eslint | `eslint .`(web 包 binary 直调) | 0 error / 12 warning(全为未触碰文件既有 warning) |

## 变更清单(Phase C)

- `apps/web/src/app/.well-known/ui4a.json/route.production-auth.test.ts`:fixture 增补
  default 应用;本地全量 sitemap 断言同步;新增 `(D51-宽合同)` 用例。
- `apps/web/src/engine/chat-situation.test.ts`:新增 `(D51-窄披露)` describe
  (situation 单点装配 → startRel/scope → sliceSitemapDisclosure 对照)。
- `apps/web/src/auth/application-scope.test.ts`:新增 `describe('D51-新应用零改码')`
  (fixture-app 注册演练:assertReachable / filterEntityForGrantedApplications /
  getAuthorizedPresentationResult 三态;vi.mock engine service,纯单元)。
- `conductor/tracks/t33-authority-attention-separation_20260827/notes-phase-c.md`(本文件)。
- 产品代码零改动(含 auth/engine 谓词、chat/driver、presentation-words)。

> 工作树注记:`conductor/product-vision.md` 与 `docs/design-reviews.md` 为本次
> 会话开始前已存在的未提交改动(非 Phase C 产物),未触碰。
