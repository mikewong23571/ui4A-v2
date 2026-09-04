# T48 端到端 agent 双通道验收记录 — 2026-09-04

> 执行者:编排 agent(自治验收,workflow.md 协议代行)。
> 环境:本地 dev server(`node scripts/with-local-env.mjs pnpm dev:web`,http://localhost:3100,local demo 自报身份);
> PostgreSQL localhost:5433/ui4a(dev 库,与测试库 ui4a_test 隔离);CLI 为本仓构建产物
> `apps/cli/dist/main.js`(隔离 config,`--scope publishing` 显式 lens)。
> 浏览器门:agent-browser(真实 Chromium,会话 `t48-accept`,逐步截图)。
> 走查对象:`t48-accept-81676e`(全新 application),Draft `draft:4ebc6cb53afe8ff1bf9d`。

## 一、步骤记录

| # | 通道 | 动作 | 命令 / URL | 合同证据 | 断言 | 结果 |
|---|------|------|------------|----------|------|------|
| 1 | CLI | 基线读数 | `apps list` | envelope schemaVersion 1 | 已装 9 app,无 `t48-accept-81676e` | ✅ 9 app |
| 2 | CLI | 提案(不完整 bundle) | `drafts create --kind application-bundle --target t48-accept-81676e --payload-file(仅 schema+bundle)` | `?scope=publishing` 显式 lens;回执 rel=draft:4ebc6cb53afe8ff1bf9d | Draft 落痕 invalid:issue `parse-error`,checks `bundle-parseable:FAIL`(I6 诚实拒绝,不丢弃) | ✅ status=invalid |
| 3 | CLI | 修正 | `drafts revise --base-version 1 --payload-file(完整最小 bundle)` | provenance actor=agent | status=ready,v2,validation.valid=true,3 checks 全 PASS | ✅ ready/v2 |
| 4 | CLI | 校验 | `drafts validate --command-id …` | 同 rel 重读 | status=ready | ✅ |
| 5 | CLI | 机械 diff | `drafts diff` | `algorithm=bundle-inventory` | added applications=[t48-accept-81676e], flows=[t48-accept-81676e-entry], conflicts=0 | ✅ |
| 6 | CLI | 提交 | `drafts submit --command-id …` | activation=meta/activation:draft-4ebc6cb53afe8ff1bf9d | status=pending-approval | ✅ |
| 7 | CLI | 越权审批尝试 | `actions exec <activation> approve` | CLI 边界 | exit 4 `APPROVAL_FORBIDDEN`("Agent CLI cannot approve")(服务端 I4 由合同测试覆盖,见 §三.3) | ✅ |
| 8 | 浏览器 | 进入 meta 控制台 | `/meta?scope=publishing` | 截图 01 | 页面渲染「定义控制台」 | ✅ |
| 9 | 浏览器 | 打开 Drafts 集合 | 点击「打开 受治理草稿」 | 截图 02 | **集合页可见 CLI 创建的 draft**(同门:人类面看到 agent 提案,"t48-accept-81676e 类型 application-bundle 状态 pending-approval 版本 2") | ✅ |
| 10 | 浏览器 | Draft 详情 | 点击成员卡 | 截图 03 | 机械 diff(bundle-inventory)、3×PASS checks、"Human-only decision"责任点 | ✅ |
| 11 | 浏览器 | 请求 Approve | 点击 `Approve` | 截图 04 | requires-confirmation 二步门:「已请求"Approve",尚未执行」 | ✅ |
| 12 | 浏览器 | 确认执行 | 点击「确认并执行Approve」 | 截图 05 | activation status=accepted;按钮组消失(不再声明动作) | ✅ |
| 13 | 浏览器 | 出生验证 | `/meta?rel=meta%2Fapplications&scope=publishing` | 截图 06 | applications 集合含 `t48-accept-81676e`(1 处命中) | ✅ |
| 14 | CLI | 立即发现 | `apps list` / `flows list` / `activations get` / `GET /.well-known/ui4a.json` | 同一只读命令面 | apps 含 newborn(共 10);flows 含 `t48-accept-81676e-entry`(app=t48-accept-81676e);activation=accepted;业务 sitemap 含新 flow | ✅ 4/4 |

## 二、事件日志审计链(dev 库 `ui4a.events`,seq 552–563)

```text
552 draft  draft-created    actor=agent  principal=local-user  commandId=t48:accept:create-invalid:…
553 draft  draft-revised    principal=local-user  commandId=t48:accept:revise:…
554 draft  draft-validated  principal=local-user  commandId=t48:accept:validate:…
555 draft  draft-submitted  principal=local-user  commandId=t48:accept:submit:…
556-558 presence scope/focus-changed actor=human(浏览器走查的处境事实,与写路径分离)
559 core   application-seeded   principal=system:meta-bootstrap
560 core   definition-seeded    principal=system:meta-bootstrap
561 core   seed                 principal=system:meta-bootstrap
562 core   meta-bootstrap-applied(receipt)
563 draft  draft-accepted   actor=human(人类批准决定)
```

要点:**core seed 事件(559–562)先于 draft-accepted(563)在同一事务内落库**——与
`acceptDraftWithCoreEvent` 的原子性合同(coreSeq < draftSeq)及重放测试一致。人类决定
证据在 draft-accepted(actor=human);出生事件与启动 bootstrap 同种同 principal。

## 三、第一性原理路径审查(spec §6.8 八条)

1. **交互均映射已声明合同动作,无带外写入** ✅ — CLI 全部经 `/_meta/api/exec`(create/revise/validate/diff/submit);浏览器全部经合同渲染的 MetaActions(集合 create 于 D67.1 渲染,approve 于激活实体合同);无任何直接 SQL/内部 API 写。
2. **裁决序 declaration→guard→schema 可见** ✅ — 步骤 2 的 parse-error 是 schema/解析层留痕(不完整 payload 未被 guard 丢弃,成为可修订 Draft);`application-not-installed` guard 在 checks 中 PASS;名称冲突 guard 的拒绝留痕由合同测试覆盖(application-bundle.test.ts)。
3. **agent 零 approve** ✅ — CLI 门:客户端边界 exit 4 `APPROVAL_FORBIDDEN`;服务端 actor-is-human 拒绝由 P2 合同测试固定(application-bundle-activation.test.ts:agent approve → guard-failed 留痕零安装);事件链中唯一的 decidedBy=human 在 563。
4. **拒绝均为带理由事件/回执** ✅ — parse-error issue 留在 Draft validation(I6);CLI 越权为结构化 error envelope(code/message/requestId);合同层的冲突/lens/越权拒绝均断言 action-rejected/留痕(P1–P4 测试)。
5. **事实全部来自合同读取** ✅ — 浏览器呈现的 diff/checks/状态全部来自 Draft 实体投影;CLI 断言全部来自 envelope;无一处由走查脚本"相信"而非读取。
6. **人机同门** ✅ — 同一 Draft rel/activation rel 同时被 CLI(envelope)与浏览器(DOM/截图 02/03)消费;同一 `/_meta/api/exec` 处理器;步骤 9 是直接证据(agent 的提案出现在人类集合页)。
7. **出生仅经事件日志** ✅ — 新 app 的存在只能由 seq 559–562 解释;`apps list`/sitemap/浏览器集合全部为 fold 投影;无第二权威存储。
8. **授权仅由授予集合×归属推导,lens 显式** ✅ — CLI 显式 `--scope publishing`(D65);浏览器 `?scope=publishing`(scopedEndpoint);local demo 授予=全集(服务端事实),无请求侧扩权;credential 模式的治理展开与越权拒绝由 P3 合同测试覆盖(exec-governance-expansion:治理凭证可达新生 app,逐 app 凭证 422)。

## 四、发现与处置

1. **零产品缺陷**:双通道走查未发现走不通的路径或合同外控件;UI 全链与 Playwright golden(P6c)一致。
2. **事件顺序观察**:core seed 先于 draft-accepted 是原子事务的直接可见证据,非异常。
3. **CLI 越权守卫为客户端边界**(消息"Agent CLI cannot approve"):走查中未触服务端(无 action-rejected 事件);服务端 I4 拒绝已由合同测试覆盖,双层守卫语义如实记录。
4. **环境备注**:computer-use 屏幕捕获在本机不可用(无 display 枚举),浏览器门改用 agent-browser(真实 Chromium + 截图留痕),验收形态等价;dev 库与测试库同实例不同库(ui4a/ui4a_test),并行 vitest 无干扰。

## 五、结论

US1/US2(经 CLI 提案+浏览器批准的等价路径)、US3(出生)、US5(agent 同门立即发现)、
US8(负例:越权/不完整提案)双通道全过;第一性原理八条审查通过,无发现项遗留。
Chat 通道(US6)的协议级同门证据见 `route.meta-parity.test.ts`(P6b/P6b-2)。

## 六、部署站双通道复核(2026-09-04 发布 4f89f4f6 后)

环境:release `4f89f4f670af` 镜像 digest(web 81e27d10/worker dd30eb83/runner 964bd184),
8 服务 healthy,volume hash 不变,§7 公网验收合同全绿(/live 返回该 SHA)。CLI 为
release SHA 构建,Keychain 设备凭证(grant=development);浏览器为 mike PKCE 会话
(登录 URL scope 显示 web token 仅 `ui4a:policy:development`,无 governance)。

| # | 通道 | 动作 | 断言 | 结果 |
|---|------|------|------|------|
| P1 | CLI | `doctor` / `apps list` 基线 | bearer/keychain;三探针 200;apps=[development](凭据过滤) | ✅ |
| P2 | CLI | 不完整提案(--scope development) | draft:6f7466cc1decbce6a740 invalid + parse-error(I6) | ✅ |
| P3 | CLI | revise/validate/diff/submit | ready v2/3 checks PASS/bundle-inventory/pending-approval + activation | ✅ |
| P4 | CLI | 越权审批尝试 | exit 4 APPROVAL_FORBIDDEN | ✅ |
| P5 | 浏览器 | Drafts 集合 | **CLI(设备凭证)提案对 web 会话可见**——owner 同为 mike 的 Keycloak sub 38d075e5(跨 client 同门) | ✅ 截图 p02 |
| P6 | 浏览器 | 详情 | scope development/bundle-inventory/3 PASS/Human-only | ✅ 截图 p03 |
| P7 | 浏览器 | 两步确认 Approve | 首次以未授予 lens(governance,被丢弃)尝试被合同拒绝;以 development lens 重试 → accepted | ✅ 截图 p04/p05 |
| P8 | 事件日志 | 出生链 | seq 209-220:draft lifecycle(actor=agent, principal=mike sub)→ application-seeded/definition-seeded/meta-bootstrap-applied(principal=system:meta-bootstrap) | ✅ |
| P9 | 双门 | 新生可见性 | 浏览器 applications 与 CLI apps list 均**不含** t48-prod-65a800——mike 两通道授予均为 {development},无 governance scope,D66.4 展开未触发;受众谓词诚实过滤 | ✅(按设计) |

### 复核发现

1. **机制在生产成立**:提案→批准→出生事件→审计链全程真实凭证/公网闭环;
2. **操作备注**:meta 实体深链规范路径为 `/meta/entity?rel=…`(`/meta?rel=` 落仪表板 fallback,复核中已纠正,非产品缺陷);approve 的 lens 必须与 Draft 的 policyScope 一致(合同如实拒绝错配);
3. **行动项(授权配置,非代码)**:当前部署 mike 的 web/CLI 凭证均无 `ui4a:policy:governance`
   scope,D66.4 治理展开未被行使——新生 app 出生后需 IdP 侧授予(逐 app 或给
   operator 会话加 governance scope,经 backup-first realm-migrate)才对人类/CLI 可见。
   机制已由合同测试覆盖(exec-governance-expansion);是否调整 realm 授权面由用户裁定。
