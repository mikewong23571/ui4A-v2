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
| E-P0.2  | P0.2       | S1 工作线呈现探针                  | NOT RUN  |
| E-P0.3  | P0.3       | S2 历史与引用探针                  | NOT RUN  |
| E-P0.4  | P0.4       | S3 布局与会话存续探针              | NOT RUN  |

E-P0.2–E-P0.4 的已知事实骨架见 `spike-report.md`;探针执行后在此追加正式条目。

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
