# T56 Evidence

> 证据登记簿。每条证据至少含:Story/Gate、Version(base、被测 HEAD、dirty)、Environment、
> Reproduction、Result(PASS/FAIL/NOT RUN)、Evidence。登记纪律:
>
> - 事实必须带文件路径/行号或命令输出摘录;历史 track 的结论不作为本轮结果。
> - 未执行的验证一律记 NOT RUN,不得写成已验证;原始观察(浏览器/线上样例)不等于部署事实。
> - 本文件由各任务随做随记;P0.1 建立基线条目与环境约定,后续任务追加条目并更新索引。

## 证据条目索引

| ID      | Story/Gate | 内容                               | Result   |
| ------- | ---------- | ---------------------------------- | -------- |
| E-P0.1  | P0.1       | 执行基线、治理基线、环境与约束核查 | PASS(含 NOT RUN 子项) |
| E-P0.2  | P0.2       | S1 工作线呈现探针                  | PASS(含 NOT RUN 子项) |
| E-P0.3  | P0.3       | S2 历史与引用探针                  | PASS(含 NOT RUN 子项) |
| E-P0.4  | P0.4       | S3 布局与会话存续探针              | PASS(含 NOT RUN 子项) |

E-P0.2–E-P0.4 的详细报告在 `probes/`(本目录),定案已并入 `DECISIONS.md` D78,
结论索引见 `spike-report.md`。

## Environment 约定(全 track 共用,2026-09-06 核实)

- **Web dev server:端口 3100**(D5)。本轮实测被本仓库 dev server 占用:
  `lsof -nP -iTCP:3100 -sTCP:LISTEN` → `node` PID 328,`ps -p 328` → `next-server (v16.3.1)`;
  `curl http://localhost:3100/` 与 `/.well-known/ui4a.json` 均 HTTP 200。
  **E2E 与浏览器验收前必须确认 3100 归属**(Playwright 需要干净 server;手工走查不得混用旧进程状态)。
- **PostgreSQL:宿主端口 5433**(docker 容器 `ui4a-postgres`,5433→5432,`Up 2 days (healthy)`)。
  dev 库 `postgres://ui4a:ui4a@localhost:5433/ui4a`;测试严禁指向 dev 库。
- **Vitest 隔离库:`localhost:5433/ui4a_test`**(`vitest.config.ts:8`,
  `TEST_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test'`;
  `packages/db/src/recovery.test.ts:54`、`migrations.test.ts:44` 机械强制库名 `ui4a_test`)。
- **Temporal**:dev 缺省 `localhost:7233`(`package.json:9` `temporal server start-dev --port 7233`;
  `apps/web/src/temporal/production-runtime.ts:43` 客户端缺省同值);
  **E2E 缺省 `localhost:7235`**(`e2e/kits/server-kit.ts:149`
  `TEMPORAL_ADDRESS ?? 'localhost:7235'`),且 `e2e/kits/test-isolation.ts` 的
  `assertIsolatedTemporal` 机械拒绝 dev 的 `localhost:7233`。本轮实测 127.0.0.1:7235 有
  `temporal` 进程在听(PID 62817)。
- **测试隔离纪律**:`e2e/kits/test-isolation.ts:assertTestDatabase` 要求 E2E
  `DATABASE_URL` 库名以 `_test` 结尾,否则抛错。

---

## E-P0.1 执行基线与约束核查(P0.1)

- **Story/Gate**:P0.1 记录执行基线与约束。
- **Version**:base = 被测 HEAD = `c38883b074d30620008eeacbf4bfe5c5f864b1f5`
  (`git log -1 --format='%H %s'` → `c38883b074d30620008eeacbf4bfe5c5f864b1f5 chore(conductor):
  initialize track 't56-work-thread-workspace_20260905'`)。dirty:仅
  `conductor/tracks/t56-work-thread-workspace_20260905/plan.md` 为 `M`(编排 agent 的 [~] 标注,
  非本任务改动);其余工作树干净。记录时间:2026-09-06 00:04(+08)。
- **Environment**:见上文「Environment 约定」;全部为本机实测。
- **Reproduction**:`git log -1 --format='%H %s'`;`git status --porcelain`;
  `pnpm governance`;`lsof -nP -iTCP:{3100,5433,7235} -sTCP:LISTEN`;
  `curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/`;下文各文件读取路径。
- **Result**:PASS(基线事实全部核实;子项 NOT RUN 见第 4 节)。

### Evidence 1:治理基线(已验证,本轮亲自重跑)

命令:`pnpm governance`(scripts/governance/run-all.mjs)。结论:**全绿**。

```text
check-deps: scanned dependency direction (GR1)            OK
check-compat: scanned legacy/compat markers (GR2)         OK(baseline pending removal: 0)
check-size: limits file<=500, test<=800, dir<=4000 (GR3)  OK(baseline remaining: 0)
check-d54: scanned 7 bundle(s) and 45 generic runtime file(s)  OK
check-meta-routes: scanned 338 production/E2E source file(s)   OK
governance: OK
```

GR3 近限目录(≥90% of 4000,test/non-test 拆分,原样摘录)——**新增代码避免堆入,需要时按
D53「膨胀即拆解」沿功能边界落子目录**:

| 目录                                      | total | test | non-test | test% |
| ----------------------------------------- | ----- | ---- | -------- | ----- |
| packages/engine/src/execution             | 3986  | 2257 | 1729     | 57%   |
| packages/engine/src/definition            | 3979  | 2845 | 1134     | 72%   |
| apps/web/src/chat                         | 3974  | 2313 | 1661     | 58%   |
| apps/agent-runner/src                     | 3938  | 1840 | 2098     | 47%   |
| apps/web/src/engine/service-tests         | 3918  | 3918 | 0        | 100%  |
| scripts/t22/compose                       | 3881  | 2603 | 1278     | 67%   |
| apps/web/src/engine/drafts                | 3776  | 2242 | 1534     | 59%   |
| apps/web/src/components                   | 3772  | 2347 | 1425     | 62%   |
| apps/web/src/engine/presentation          | 3707  | 1997 | 1710     | 54%   |
| apps/worker/src                           | 3610  | 2066 | 1544     | 57%   |

design.md §4 规划期提示的四个数字(chat 3974、engine/execution 3986、service-tests 3918、
engine/presentation 3707)与本次实测**逐一吻合**。本次跑的是默认 `pnpm governance`
(baseline remaining: 0,与 strict 等效的清空态);`pnpm governance:strict` 未单独执行
(见 NOT RUN)。治理行数上限不驱动代码裁剪,只约束新增落位。

### Evidence 2:现行 DECISIONS 约束摘要(只读提取,未改 DECISIONS.md)

与 T56 直接相关的决定(编号 — 一句话要点;全文见 `DECISIONS.md` 对应小节):

- **D27**(T16):Chat 只发 thin PresentationRequest/收 Receipt;完整 catalog/Surface/bindings/
  依赖 DAG 只进 Presentation Plane;User Sidecar durable key = (principal, policyScope,
  subject, intent, deviceClass),禁 sessionId/route。
- **D28**(T16):AI 摘要保持 Assistant 原生认知,不自动升级为应用工件/业务字段。
- **D44**(T26):Work Thread 是 principal-owned 显式引用投影——成员只由
  `thread-created/attached/detached` 显式事件决定(category 封闭为
  context/active/approval/event),生命周期 open/paused/completed/archived,跨 session/scope,
  owner 不变;不从聊天文本/rel 图/presence 自动扩张。
- **D45**(T30):组合以虚主体声明(`workspace:<id>`)退化到同一台 Surface 机器;region 声明
  版本化纯数据,逐区域 fresh 重授权,不可见区域放固定 `region-unavailable` diagnostic,
  全不可见才 failed。
- **D46**(T27):Workstation 站点/首页/处境常显(site/scope/thread/focus)与跨站桥;
  进线/出线是 URL 导航(`?thread=`/删除 `thread` 参数)。
- **D47**(T28):一等交互走 contract-driven 动作组(fresh read → exec,两段式确认);
  引用只消费 canonical `FactRef{rel,pointer}` chip,live 取 final SSE sources、history 按
  turnId 取 `chat-message-appended.citations`,禁止文本匹配;raw 是共享抽屉内容非第三站点;
  generic intent 精确匹配 + role budget。
- **D50**(T33):读面姿态——actions 任何 intent 始终一等可见,参数表单单一默认收起;
  责任点写是一击零参数(成员决策卡);复杂写正典在 chat 原话授权。
- **D51**(T33):授权 ≠ 注意力——授权输入仅凭证授予集合 × 事实归属;注意力是 situation
  单点装配(显式 > presence > 未定位),lens 只流向常显/披露/导航落点,类型上不可进入鉴权。
- **D54**(T39):认知语义派生优先、视觉策略不是真相;Meta canonical 单一路由;
  **Application 是图书馆,Work Thread 是书桌**(`application:<name>` 只读零 action);
  Assistant 披露全量重建非累积 + 32 KiB 字节门。
- **D58**(T42):共同工作上下文——Agent 只传出生时固定的 `contextRel`;每次决策经授权
  HTTP 重读工作线及最多四个显式 context/active/approval 引用;无递归、无自动 attach;
  中立发现起点 `applications` 集合。
- **D68**(T49):聊天会话双轴——principal 是唯一所有权/授权轴,sessionId 仅分组键
  (`rel=chat:<sessionId>`);sessions/history/conversationView 三路 principal 过滤;
  旧数据诚实投影,不回填。
- **D69**(T50):定义提案合同自披露(`x-ui4a-payload-schemas` 注解,HTTP 不窄化,
  模型视图剥 schema 留 example);拒绝数据化(DraftValidationIssue.expected)。
- **D70**(T51):授权可见性披露——approve 响应 disclosure 三分支;「我的授权」只读面板 +
  `GET /api/auth/session` 投影 + 「刷新授权」重跑 `/auth/login`;面板是投影非第二权威。
- **D74**(T54/G01):Meta 确认批准经同一 executeMeta 事件计划重执行,决定与伴随事件同事务;
  业务面确认批准语义不变。
- **T35「恒三栏」**:**DECISIONS.md 中无编号条目**。它是 T35 的 track 级设计定稿:
  `conductor/tracks/archive/t35-ux-walkthrough-remediation_20260827/design-notes.md` §十
  「线工作台定稿:2 轨 + 1 舞台,pin=上下文条目,按钮跟着注视走」——布局不变式
  「新内容只有两个去处:变成书桌条目,或接管舞台;**栏数恒为 3**」,pin 语义
  「pin = 挂进本线工作集(上下文引用),不是实时展示」。另见 `conductor/done-report.md`
  T35 小节「线工作台 §十定稿(2 轨+1 舞台…)」。T56 将按 design.md §3「决策先于实现」
  在 P0.5 以新的有证据 DECISIONS 条目 supersede 它(撤销恒三栏/本线视为 noGaze),
  原归档文件只读,不改写历史 track。
- 邻接事实(T55 已落地的 chat/service 编排约束,T56 改 chat 邻接模块时适用):
  **D75** chat POST 四段边界(身份/请求体/会话编排/响应),段模块在 `src/chat/post/`
  (post-identity/turn-context/turn-response,含 2026-09-05 GR3 拆解修订);
  **D76** service hub 降权(ExecOutcome 下沉 `service-outcome.ts`,exec 六段归位,
  编排模块在 `src/engine/exec/` 子域)。

### Evidence 3:T54/T55 已有实现事实(只读核查,行号对应该 HEAD)

**线程投影(pure)**

- `packages/engine/src/projection/work-thread.ts`(335 行)。导出:`THREADS_REL='threads'`、
  `THREAD_REL_PREFIX='thread:'`(:18-19)、七个动作定义 THREAD_CREATE/ATTACH/DETACH/PAUSE/
  RESUME/COMPLETE/ARCHIVE_ACTION(:29-116;archive 带 `'requires-confirmation': 'high'`,
  :114)、`threadRel()`(:142)、`threadActionsForStatus()`(:146)、
  `projectWorkThread()`(:246)、`projectWorkThreads()`(:316)。
- **`projectWorkThread(thread, snapshot, deps) → SirenEntity` 返回 shape**(:280-313):
  `class: ['work-thread', status]`;properties 含 `rel`(thread:<id>)、`identity`(=goal.text)、
  `id/owner/goal/status/statusText`(任务语:进行中/已暂停/已完成/已归档,:208-213)、
  `context`(rel string[])、`resume`(「停在「…」」,取首个 active 状态指针,无则回退线程状态,
  :252-260)、`active`/`approval`(statusPointer 数组 `{rel,status?,dangling}`,:156-173)、
  `recent-events`、可选 `goalSourceText`(:279)、`presentation.fields`(identity/status/
  resume/goalSourceText,:296-307);actions 按 status(:118-140,**archived: [] 无动作**);
  links = self + 每类引用 link(rel `[category]`/`[category,'dangling']`)+ event 审计链接
  (`/api/events?afterSeq=N-1`,:184-205);`entities` = context 导航成员卡
  (class `thread-reference`[+dangling],properties {rel, identity, status},actions: [],
  :264-276)——**仅 context 生成子实体,active/approval/event 只是 links/properties**。
- `packages/shared/src/work-thread.ts`(327 行):`THREAD_REFERENCE_CATEGORIES =
  ['context','active','approval','event']`(:9),`THREAD_STATUSES`(:10),
  `THREAD_REFERENCE_SOURCES = ['action','presence']`(:11);上界 `MAX_THREAD_ID_LENGTH=64`、
  `MAX_THREAD_REFERENCES_PER_CATEGORY=256`、`MAX_THREAD_RECENT_EVENTS=50`(:13-18);
  `ThreadSnapshot {id, owner, goal:{text,source}, status, references, recentEventSeqs}`(:75-84);
  `parseThreadSnapshot`(:250)/`parseThreadEventDetail`(:297)封闭词表校验。
- 测试:`packages/engine/src/projection/work-thread.test.ts`;
  `packages/shared/src/work-thread.test.ts`。

**页面壳**

- `apps/web/src/components/canvas/canvas-body.tsx`(116 行):`railOn = threadId !== undefined`
  (:22);**`gazeIsThreadItself`(focus === `thread:<id>`)判定在 :44-45**;
  **noGaze 判定在 :57-63**(无 focus/concern/roots/thread/appLandingFocus,或
  gazeIsThreadItself);**noGaze 渲染分支在 :65-96**——本线分支 :68-78(协作引导文字 +
  `ThreadStageActions` :76 + `ApplicationEntryStrip` :77),非本线入口层 :80-85;
  有注视走 `PresentationSurfaceHost`(:89-95)。三栏 rail::98-115(aside
  `data-testid="thread-desk-rail"` :106,内嵌 `ThreadDesk` :110;`lg:w-96` :108)。
  T35 §十恒三栏注释在 :17-20。
- `apps/web/src/components/app-shell.tsx`(47 行):`AppShell({children, aside})`,
  aside 槽 :43;顶栏含 SituationBar 处境芯片(:36-38,T35 D-7)。
  **chat 挂接点:`apps/web/src/app/layout.tsx:20` `<AppShell aside={<FloatingChat />}>`**——
  FloatingChat 全局挂在壳 aside;`/chat` 独立页复用 ChatPanel 且 FloatingChat 自隐藏
  (`apps/web/src/app/chat/page.tsx:20` pathname 判断)。

**材料与 pin**

- `apps/web/src/components/actions/thread-material-add.tsx`(189 行):非书桌宿主的
  「添加涉及对象」;主路径 `ObjectSelectorPanel`(import :20,来自
  `../canvas/desk/thread-desk-selector`),高级回退裸 rel `ActionRunner`(:168-177);
  attach 提交 `{category:'context', rel: memberRel}`(:104)经宿主 submit 适配器(同一
  /api/exec);成功后 `cache.invalidateAfterExec` + `notifyThreadUpdated`(:87-89);
  「已添加」读线程授权投影 `properties.context`(:41-48),不自造清单。
- **pin 存储:浏览器 localStorage,key = `ui4a.thread.pins.<threadId>`**
  (`apps/web/src/components/canvas/desk/thread-desk.tsx:36-37` `threadPinsKey`;
  `readThreadPins` :40,`writeThreadPin` :53-61,写后广播 window 事件
  `ui4a:thread-pins-changed` :61)。书桌工作集 = 合同 context 成员 + pin-only 条目
  (`pinOnly = pins − threadRel − context`,:148-149);pin 与 membership 是两条语义,
  与 D44/design.md §2「已有本地 thread pin 偏好 → 固定视图快捷入口」一致。
- desk 组件:`thread-desk.tsx`(337 行)、`thread-desk-selector.tsx`(217)、
  `thread-desk-shared.ts`(137;`THREAD_UPDATED_EVENT='ui4a:thread-updated'` :6)、
  `thread-stage-actions.tsx`(88)。测试:`thread-desk.test.tsx`、
  `thread-desk-selector.test.tsx`(同目录)。

**聊天历史与引用**

- `apps/web/src/chat/history.ts`(158 行):**`ChatTurn`(:35-42)不含 clientView 字段**——
  它是 `Omit<ChatTurnDetail,'outcome'>` + seq/ts/status/outcome + `citations?: FactRef[]`
  (「Response-only projection joined from canonical chat-message-appended by exact
  turnId」,:40-41)。clientView 在 **`ChatMessageAppendedDetail.clientView?:
  ClientViewReport`**(:76-77,「当前 user 原话发送时的客户端观察;不授权事实读取或
  effect」)——只落在 user 原话事件 detail,未接进 ChatTurn 投影(S2 的核心已知缺口,
  与 design.md §3-S2「ChatTurn/history UI 目前未完整带出」吻合)。
- `apps/web/src/chat/conversation.ts`(331 行):`ConversationMessage`(:32-44)**同时带
  `citations?: FactRef[]` 与 `clientView?: ClientViewReport`**——事件级投影已保序;
  ConversationState/View 另有 `clientView: ClientViewFact | null`(当前观察)。
  归属按 (principal, sessionId) 双键(:7-8 注释,D68.3)。
- `apps/web/src/app/api/chat/history/route.ts`(96 行):principal 过滤经
  `chatHistoryPrincipal`(:33;`apps/web/src/chat/history-access.ts:12-22`,仅 production
  profile 生效);事件读取 `listEvents(getDb(), 0, {principal})` **从 seq 0 起全量拉取后
  按 `rel === 'chat:<sessionId>'` 内存过滤**(:34-40)——S2 需核查此读取口径的分页/上限
  边界;citations join:assistant 角色 + 精确 turnId(:71-90),只注入 status='final' 的回合。
- `apps/web/src/components/chat/citation-list.tsx`(123 行):标签取授权实体声明身份
  (`declaredTitleOf` :17-35:identity/title → target → flow),按 rel 懒取 `/api/entity`
  (meta/、draft: 走 `/_meta` 前缀,:46),失败/无身份诚实回退 rel;JSON Pointer 只进
  title 属性(审计口径,:106);点击 `citationCanvasHref(route, citation.rel)`(:102);
  active 态由 URL focus 导出(:96-97)。无字段级/集合成员级 pointer 定位(FR8 已知边界)。
- **FactRef shape:`{rel: string, pointer: string}` 仅此二字段**
  (`packages/agent/src/types.ts:104-107`);`apps/web/src/chat/citations.ts` `parseCitations`
  拒绝 rel/pointer 之外任何键、去重保首现序;**无证据快照、无版本、无 identity 字段**
  ——历史引用不能自证回答时点内容(S2/FR8 的时点诚实缺口)。
- 聊天编排(T55/D75):`apps/web/src/chat/post/`(post-identity/turn-context/turn-response
  及同名 .test.ts);`apps/web/src/engine/chat-thread.ts` 承接用户消息显式 attach。

**呈现(presentation)**

- pure kernel:`packages/engine/src/presentation/`(`index.ts` barrel:broker、
  compose/compose、lens、patch、recipe/{promotion,recipe,resolver}、scenario、
  sidecar/sidecar、surface);职责:Sidecar/Recipe/Surface 纯语义、组合与 patch。
- web 适配:`apps/web/src/engine/presentation/`——`compositions.ts`(内建 composition
  声明 registry,`workspace:` 前缀解析,D45)、`runtime-composition.ts`
  (composeSurfaceRegions/planGenericSurface 接线,区域 Surface 组装)、`broker.ts`
  (stages: authorization/situation/resolution/planning)、`runtime.ts`、`situation.ts`、
  `recipes*.ts`、`recipe-context.ts`、`generic-intent-policy.ts`、`app-workspace/`
  (application header/composition)。本轮只记入口与职责,未深挖内部。

**E2E 基座**

- `e2e/kits/test-isolation.ts`(20 行):`assertTestDatabase`(库名必须 `_test` 结尾)、
  `assertIsolatedTemporal`(拒绝 dev `localhost:7233`);测试
  `e2e/kits/test-isolation.test.ts`。
- `e2e/kits/server-kit.ts`(322 行):E2E server/Temporal 套件;`TEMPORAL_ADDRESS` 缺省
  `localhost:7235`(:149)。
- 现存 spec:`e2e/t26-work-thread.spec.ts`(182)、`e2e/chat.spec.ts`(371)、
  `e2e/interaction/chat-citations.spec.ts`(109)、`e2e/workstation/bridges.spec.ts`(106)、
  `e2e/workstation/workstation-home.spec.ts`(360)、
  `e2e/workstation/workstation-situation.spec.ts`(107)。
  **`e2e/workstation/work-thread-workspace.spec.ts` 尚不存在**(P4.1 待建)。

### Evidence 4:NOT RUN(本轮未验证项,不得当作已验证)

- S1/S2/S3 三个探针全部未执行(属 P0.2–P0.4);spike-report.md 仅有骨架与已知事实。
- 未跑任何测试:`pnpm test`/`pnpm vitest run`(含 G1 相关 vitest)、`pnpm e2e`(全量或
  invariants)、真实 LLM 门禁 `pnpm eval:llm` 均未运行。
- 未跑 `pnpm check`(类型检查/ESLint 全量)与 `pnpm governance:strict` 单独命令
  (本轮 `pnpm governance` 默认模式已绿且 baseline remaining: 0)。
- 未跑 `pnpm --filter @ui4a/web build`。
- 线上样例(spec §2:`ui4a.styleofwong.cn/canvas?focus=thread:ux0905-deep-review…`)
  未与本地任何版本核对;spec §2 浏览器走查观察是规划期输入,不是本轮可复现证据。
- 未做任何浏览器手工走查;3100 端口 dev server 的运行状态只验证了「在听 + HTTP 200」,
  未验证其渲染内容与本 HEAD 一致。
- 数据库内容未检查(除容器/端口健康状态);未执行任何写操作。

---

## E-P0.2 S1 工作线呈现探针(P0.2)

- **Story/Gate**:P0.2(S1 出口 → D78 决定 2/3/4;design §3-S1)。
- **Version**:base = 被测 HEAD = `c38883b074d30620008eeacbf4bfe5c5f864b1f5`(与
  E-P0.1 基线一致)。dirty 见 `probes/s1-presentation.md` 头注(并行窗口文件非本任务
  产物)。执行时间:2026-09-06。
- **Environment**:隔离库 `ui4a_s1_test`(docker `ui4a-postgres`,宿主 5433),全程
  `TEST_DATABASE_URL` 指向该库,未触 dev 库 `ui4a` 与 `ui4a_test`;fixture 前缀
  `t56s1-<runId>`。
- **Reproduction**:
  ```bash
  TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_s1_test \
    pnpm vitest run apps/web/src/engine/service-tests/work-thread/presentation.test.ts
  # → Test Files 1 passed (1); Tests 6 passed (6); exit code 0
  ```
- **Result**:PASS。
- **Evidence**:详细报告 `probes/s1-presentation.md`(exact Siren/授权裁剪六处/呈现链
  surface 树/依赖五条/新鲜度四类接线/路线 A vs B 对比/分组语义/最小扩展清单)。要点:
  路线 A 选定(纯投影补 `thread-reference` 成员卡 + `version:1` 认知声明,零新增
  rel/授权机制);裁剪与真空同形 →「当前可见」口径;生命周期动作绕过确认门
  (`service-exec.ts:87-89`)实测固化(用例 3)。探针种子常驻于
  `apps/web/src/engine/service-tests/work-thread/presentation.test.ts`(P1.1 Red 种子,
  GR3 独立子目录预算);路线 B scratch 已删。
- **NOT RUN**:浏览器渲染断言(A2uiSurface 实际视觉,属 P2/P4);`pnpm check` 全量、
  `CI=true pnpm e2e`、真实 LLM 门禁、`pnpm --filter @ui4a/web build`(非目标);
  路线 A 的实施(成员卡/traits 落码,P1);归档线完整呈现 fixture 组合未展开
  (归档无动作与成员卡解耦两点已有断言/代码事实覆盖)。

## E-P0.3 S2 历史与引用探针(P0.3)

- **Story/Gate**:P0.3(S2 出口 → D78 决定 5;design §3-S2)。
- **Version**:base = 被测 HEAD = `c38883b074d30620008eeacbf4bfe5c5f864b1f5`(与
  E-P0.1 基线一致;P0.1 行号事实经复核,个别修正录于报告头部)。执行时间:2026-09-06。
- **Environment**:隔离库 `ui4a_s2_test`(5433);探针运行配置在仓库外
  `/tmp/vitest.s2.config.ts`(复用仓库 `vitest.global-setup.ts`),未改任何仓库测试基座
  文件;未占用 3100/3110;所有 principal/session/rel 用 `t56s2-<rand>` 前缀,每例
  `TRUNCATE events` 自清理。定点质量门(仅探针文件):eslint exit 0、tsc 探针相关
  0 error、prettier 通过。
- **Reproduction**:
  ```bash
  TEST_DATABASE_URL='postgres://ui4a:ui4a@localhost:5433/ui4a_s2_test' \
    pnpm vitest run --config /tmp/vitest.s2.config.ts
  # → exit 0;Test Files 3 passed (3);Tests 17 passed (17)
  ```
  (三文件中 `apps/web/src/app/api/chat/history/s2-probe.test.ts` 已按报告 §2.7 删除
  ——其 8 个场景与断言完整录于报告 §1,可原样重建;另两枚保留为 P3 种子,由 G2 的
  `components/chat` 目录级命令覆盖。)
- **Result**:PASS。
- **Evidence**:详细报告 `probes/s2-history-citations.md`。要点:`ChatTurn` 丢
  clientView 实测(`'clientView' in turn === false`,三态坍缩);live/history 缺口唯一在
  ChatTurn join;`listEvents` 无默认 LIMIT、显式 limit 硬顶 101 会静默截没页外回合;
  `{rel,principal}` 过滤与 `desc+beforeSeq` 游标既有可用;local profile history 路由无
  principal 过滤(生产走凭证轴);集合引用风险=无时点边界的「心智错位」;无缓存即无
  失效残留;`withCitationsOnLastAssistant` 并发归属缺口(P3 处理项)。
- **NOT RUN**:production profile 的 history principal 过滤端到端实测(仅代码路径核查
  `history-access.ts:9-18`);大会话规模下按 rel 过滤读取的性能曲线(正确性实证至
  134 事件量级);`(principal, rel, seq)` 索引收益(属 schema 决策,本 track 默不做);
  meta 平面聊天历史一致性;真实 LLM。完整 `pnpm check`/`pnpm governance`/Playwright
  E2E 未跑(非目标)。

## E-P0.4 S3 布局与会话存续探针(P0.4)

- **Story/Gate**:P0.4(S3 出口 → D78 决定 1;design §1/§3-S3)。
- **Version**:被测 HEAD = `493dc67ddfa6dd8828daf8837c22ffd55ce50cc8`(基线
  `c38883b` + 编排 agent 的 plan.md [~] 标注,无代码差异)。执行时间:2026-09-06。
- **Environment**:隔离库 `ui4a_s3_test`(5433)+ 隔离 server
  `PORT=3110 UI4A_DIST_DIR='.next-t56s3'`(`.next-t56s3` 603MB 已删,`tsconfig.json`
  已还原);用户 3100 dev server、dev 库、7233/7235 未触碰;Temporal/worker 未起
  (允许);受控 SSE 经 fetch shim 注入协议正确帧以省真实 LLM 配额,下游消息态/
  isRunning/停止/localStorage/布局全为真实产品代码。探针执行方式:仓库内 Playwright
  chromium + node 脚本量 DOM bounding boxes;自起进程全部正常结束(3110 已释放)。
- **Reproduction**:`probes/scripts/` 下 5 个脚本(运行于 3110 隔离栈):
  `s3-geometry.mjs`(几何+截图)、`s3-persist.mjs`(存续矩阵)、`s3-sse.mjs`(受控 SSE)、
  `s3-clientview-keyboard.mjs`(clientView/键盘)、`s3-popout-session.mjs`(/chat 会话
  采纳);34 张截图在 `probes/shots/`(关键:`1080x820-thread-itself-chat.png`、
  `390x844-chat-float.png`、`sse-4-narrow-390-streaming.png`)。
- **Result**:PASS。
- **Evidence**:详细报告 `probes/s3-layout-session.md`。要点:640px 在当前壳内任何视口
  不可达(关 chat 恒 568);并排阈值定案 384px→1072、320px→1008,200% 缩放必覆盖;
  存续矩阵单文档切换(客户端导航/back/收起重开/形态切换/缩放)全 PASS,FAIL 根因唯一
  为裸 `<a>` 硬导航(书桌条目 `thread-desk.tsx:290`、品牌链接 `app-shell.tsx:28`);
  Escape 不关面板、无焦点恢复、无初始焦点管理;本线页 0 个 H1、对象页 2 个 H1;
  clientView 发送侧与 URL 同源无漂移;重开不回停靠的 dockedThread 记忆为正确现状,
  P2 保留。
- **NOT RUN**:真实服务端 SSE 全链路(chat-turn 落库/history join/pendingSession 轮询,
  属 S2/US12 范围);真实 LLM 回答质量、委托模式、eval 门禁;200% 缩放以
  960×540 CSS + deviceScaleFactor 2 等效模拟(真实浏览器缩放交互未用);SessionList
  切会话 abort(仅代码级核对);读屏器/真人键盘走查、打印/RTL;用户 3100 dev server
  渲染内容与本 HEAD 一致性。`ui4a_s3_test` 库保留供并行复核,清理由编排 agent 决定。

---

## E-P2.3 P2 Gate 浏览器交互与视觉(P2.3 + P2 Phase 实际操作)

- **Story/Gate**:US01/US05/US07;G2/G3;FR1/FR4/FR7(存续)。
- **Version**:被测 HEAD = `12397a0d` 的工作树前身(35552afd + P2.3 修复),隔离栈与
  G3 CI server 两路验证;编排 agent 复跑时 HEAD=`12397a0d` dirty 仅 plan.md。
- **Environment**:①CI=true Playwright 自管 server(3100,ui4a_test,Temporal 7235);
  ②编排 agent 亲走查:3110 + `ui4a_s3_test` 本地 profile(agent-browser 会话),走查后
  server 已停、端口已释放、3100 dev server 已恢复。
- **Reproduction**:
  G2:`pnpm vitest run apps/web/src/components/canvas apps/web/src/components/actions/thread-material-add.test.tsx`;
  `pnpm vitest run apps/web/src/components/chat apps/web/src/app/api/chat/history/route.test.ts apps/web/src/chat/conversation.test.ts`。
  G3:`CI=true pnpm e2e e2e/workstation e2e/t26-work-thread.spec.ts e2e/interaction/chat-citations.spec.ts e2e/chat.spec.ts`;
  `CI=true pnpm e2e e2e/t24-presentation-honesty.spec.ts`。
  走查:3110 隔离栈按 US01(进线)→US05(展开/Escape/焦点/分栏)→US07(材料→对象→返回本线→后退)顺序点击。
- **Result**:PASS。
- **Evidence**:
  - G2 组 1:70 用例 69 pass/1 fail(唯一 fail=P3.1「固定视图」预期 Red);组 2:16 files 116/116。
  - G3:21 passed/1 skipped(fixme=US07 clientView 等 P3),exit 0;编排 agent 后台复跑同结果;
    t24 单跑 3/3;t16-golden `--list` 收录。
  - 截图:`evidence/shots/` 17 张 + README(viewport/route/fixture/sha);编排 agent 亲看
    01(本线概览主内容)、03-vp-390(覆盖不出屏)、08/09(决定前/后)、走查过程 4 张(/tmp)。
  - 走查实测(编排 agent 亲操作,1280×?):US01 进线 H1=目标、成员卡、材料入口;助手 FAB
    展开=float(遮蔽后可读 728px≥640)、Escape 关闭焦点回 FAB、草稿跨关开/跨形态保留;
    「分栏」→ in-flow aside 384 + surface 848(=vw−48−384,D78 公式吻合)、零重叠、
    body.scrollWidth=视口;US07 desk 条目保留 thread、返回本线→H1=目标、浏览器后退 URL 正确。
  - **Finding(F-P2.3-1,P3 处理)**:surface 成员卡与内容区实体链接(collection→object)导航丢
    `thread=` 参数,落点页无「返回本线」;desk 条目与带 thread 深链正确。已登记进 plan P3.1。
  - **Note**:停靠形态跨客户端导航回到 float(FAB),草稿保留;属「尊重当次选择」的呈现语义,不判缺陷。
- **NOT RUN**:US04 归档回顾浏览器走查(G3 无归档线用例,P3/P4);pin-only 区分(P3.1);
  US12 真实 LLM(G4);200% 真实缩放交互(E2E 以 960 CSS 等效);读屏/真人五秒测试(G6,未测)。

---

## E-P3 P3 Phase Verification(材料/决定/历史/引用闭环 + 亲走全链路)

- **Story/Gate**:US02/04/06/08/09/10;G1/G2/G3 受影响范围;FR5/6/7/8。
- **Version**:被测 HEAD = `62149a3b` 工作树(P3.1 `4adb676`、P3.3 `f388bf4`、P3.4 `bb52a83`、
  P3.2 `bc90066`、GR2 措辞修复 `d2bd486d`);编排 agent 亲测。
- **Environment**:①vitest:unit(jsdom)+ db(ui4a_s1/s2/s3_test);②G3:CI=true Playwright
  自管 3100 server(ui4a_test);③浏览器走查:3110 + ui4a_s3_test 本地 profile + 真实 LLM 配置
  (.env.local,一次短问答消耗),走查后 browser/server 均已关闭、端口已释放。
- **Reproduction**:
  G1 三组与 G2 两组命令同前(P2.3 条目);G3 同 P2.3 条目命令。
  走查:3110 重建走查线(DB 当日被 server 重启重置,重建 `thread:t56-p3-walk` 并按 t26 口径
  attach context/active/approval; FR9 诚实失败态「内容不存在或不可见+返回首页」被 live 验证)→
  概览四类角色卡→点责任卡→引用链→助手问答→历史恢复。
- **Result**:PASS。
- **Evidence**:
  - G1:projection/fold/shared 76/76;service thread+confirmation+meta 22/22(s3)+work-thread 19/19;
    engine 全包 840/840。
  - G2:canvas+actions 113/113(含 P3.2 approval-decision 9 例、P3.1 pin/nav 11 例);
    chat 全域 44 files 335/335;render/words 71/71。
  - G3:21 passed/1 skipped(两次运行一致,exit 0)。
  - 浏览器亲走(截图 /tmp/t56-p3-*.png,7 张):概览四类角色卡(archived idea 状态诚实、
    c1 回执行「deprecate · 由 human 提议/approved」);固定视图文案生效;责任卡点击落
    confirmation 实体页(「已由 human 批准」H1 回执+meta 目标无内联审批,F-P2.3-1 修复后
    返回本线在位);输入范围条与 URL 同源(P3.3);真实 LLM 回答依据 5 条 chip 全部带
    「(当前名称)」时点标注+pointer 路径(P3.4);引用点击落点 URL 保留 thread;
    历史面板显示会话/回合,刷新恢复路径重建回答与 citations(P3.3 join)。
  - 走查口径说明:pending 确认的两步批准点击未在浏览器实测(内置确认策略 human high 直通,
    挂起需 Cedar strict fixture——即 e2e 隔离 harness 口径),由 jsdom approval-decision 9 例
    + P4.1 e2e 覆盖;c1 已决回执与 Meta 边界为浏览器实测。
- **NOT RUN**:pending 批准浏览器点击(上述口径说明)、US04 归档线浏览器走查(P4)、
  集合型引用浏览器重排演示(jsdom 覆盖)、US12 正式三轮协作(G4/P4.2)、真人五秒测试(G6)。

---

## E-P4.2 G4 真实 LLM(US12)与 G6 注意力走查

- **Story/Gate**:US12;G4;G6;FR7/FR9。
- **Version**:G4 被测 HEAD = `88d3ce0`+eval spec 工作树;G6 综合本轮 P2.3/P3 浏览器走查与
  P4.1 常驻截图(编排亲看)。
- **Environment**:G4 = 隔离库 5433/ui4a_test + 隔离 Temporal 7235 + 真实 LLM 凭证
  (来源 .env.local 装配,值未入任何输出);G6 = 本机浏览器实际操作记录。
- **Reproduction(G4)**:`set -a; source .env.local; set +a; RUN_LLM_EVAL=1 DATABASE_URL=
  …ui4a_test TEST_DATABASE_URL=…ui4a_test pnpm eval:llm --project=working-context`。
- **Result**:G4 = PASS(3 用例含 US12 三轮全过,1 例 retry 吸收,exit 0);G6 = 完成(方法见下)。
- **Evidence**:
  - US12 三轮(X→Y→本线同 session):每轮起步 rel=当轮 clientView(X→post:post-welcome、
    Y→post:first-post、本线→thread),B 线内容零渗入;回答人工复核谈对对象(摘录存
    P4.2 subagent 报告与 eval 证据);引用 (rel,pointer) 全部回读可验证;领域副作用事件=0
    (18 条事件全为 chat/presence/决策审计类);owned-thread attach 按精确谓词核对
    (eval 无凭证环境按设计 skip,0 条,非笼统放行)。
  - 模型行为观察:Y 轮 2/5 次协议封装失败被诚实折算 failed 并由场景重试吸收(US12 协作
    本身正确);引用指针惯用服务端观察前缀,spec 按呈现形态等价展开,未降级为关键词判定。
  - **G6 记录(编排 agent 实际操作,US01/02/04/05/08 顺序)**:找到目标=进线即首屏 H1
    (0 额外点击);责任在概览成员卡直接可见(0 点击),决定面板 1 点击可达,普通知情决定
    不跨业务页面(US02;P3 走查+P4.1 e2e 双证);US04 归档线浏览器证据=P4.1 截图亲看
    (零写控件+当前可见口径+固定视图分离);US05 无需缩字号(五视口 e2e+390 走查);
    US08 历史误读防护=turn-context-notice+引用「(当前名称)」标注+恢复路径实测;
    关键来源/raw 两步可达(页面工具 1+1);材料/助手一处入口开关、不依赖 hover。
  - **真人五秒注意力指标:未测**(无真人被试;不宣称用户厌烦感下降)。
- **NOT RUN**:G6 真人计时测试(未测);G4 FR9 模型不可用分支本轮未触发(模型可用;
  诚实失败行为由用例机械覆盖)。
