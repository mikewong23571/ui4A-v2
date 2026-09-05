# T56 S2 探针报告:历史上下文与引用的时间边界(P0.3)

> 任务:design.md §3-S2。执行日 2026-09-06,被测 HEAD `c38883b074d30620008eeacbf4bfe5c5f864b1f5`
> (与 evidence.md E-P0.1 基线一致;本任务工作树新增文件见文末 git status)。
> 环境:独立测试库 `ui4a_s2_test`(docker `ui4a-postgres`,宿主 5433),全程未触 `ui4a`/`ui4a_test`
> 默认库,未占用 3100/3110,未杀进程。探针运行配置在仓库外 `/tmp/vitest.s2.config.ts`
> (root 指向仓库、`@` alias、`TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_s2_test`、
> 复用仓库 `vitest.global-setup.ts` 建库+advisory lock),未改动任何仓库测试基座文件。

## 0. 执行摘要

命令与结果(P0.3 DoD):

```text
TEST_DATABASE_URL='postgres://ui4a:ui4a@localhost:5433/ui4a_s2_test' \
  pnpm vitest run --config /tmp/vitest.s2.config.ts
→ exit 0;Test Files 3 passed (3);Tests 17 passed (17)
```

- `apps/web/src/app/api/chat/history/s2-probe.test.ts` — 8 例(步骤 1/2/3 DB 侧/6/7)
- `apps/web/src/components/chat/citation-list.s2-probe.test.tsx` — 6 例(步骤 3/4)
- `apps/web/src/components/chat/history-replay.s2-probe.test.tsx` — 3 例(步骤 1 UI 腿/步骤 5)

定点质量门(仅对探针文件):`eslint` exit 0;`tsc --noEmit`(apps/web)探针相关错误 0、
全量 `error TS` 计数 0;`prettier --check` 通过(--write 修复过一轮)。
P0.1 已核实事实的行号复核:FactRef `packages/agent/src/types.ts:104-107`、
`ChatTurn` 无 clientView `apps/web/src/chat/history.ts:35-42`、
`ChatMessageAppendedDetail.clientView` `history.ts:76-77`、
`ConversationMessage` 双带 `conversation.ts:32-44`、history 路由 seq 0 拉取
`route.ts:34-40`、CitationList pointer 仅进 title `citation-list.tsx:106`、
懒取 no-store `citation-list.tsx:49` —— 全部与 P0.1 记载一致,个别行号修正见上。

fixture 口径说明:探针按真实写路径(`post/turn-context.ts:84-108`、`session-events.ts`、
`inline-stream.ts:325-350`)同构追加事件;两个"工作线 A/B"以 `clientView.thread` 字符串建模
——那是唯一到达服务器的处境事实;真实 thread 实体的创建/呈现属 S1 fixture,不在本探针重复。
所有 principal/session/rel 用唯一前缀 `t56s2-<rand>`,每例 `TRUNCATE events` 自清理。

---

## 1. 分步实证

### 步骤 1(A 线问 A → 切 B 线问 B → 刷新):事件 → history → ChatUiMessage 映射链

同一 principal(`user:t56s2-…-owner`)同一 session 两回合,回合间只变 `clientView`
(thread-a/idea-a → thread-b/idea-b)。落库事件(实测 psql 摘录,user 回合一):

```json
{"role":"user","turnId":"t56s2-g9uzvf-turn-a","content":"看一下 t56s2-g9uzvf-idea-a 的进展",
 "messageId":"t56s2-g9uzvf-turn-a","sessionId":"t56s2-g9uzvf-sess",
 "clientView":{"schemaVersion":2,"presence":{"clientInstanceId":"t56s2-g9uzvf-client",
   "site":"workstation","scope":"publishing","thread":"thread:t56s2-g9uzvf-thread-a",
   "focus":"idea:t56s2-g9uzvf-idea-a"}},"provenance":{"kind":"user-input"}}
```

history 路由读回(实测 JSON 摘录,同一回合):

```json
{"seq":1589,"ts":"…","goal":{"verb":"看一下 t56s2-…-idea-a 的进展"},"steps":[],"driver":"llm",
 "turnId":"t56s2-…-turn-a","outcome":"done","summary":"…正在评审中。",
 "messages":[{"role":"assistant","text":"…正在评审中。"}],
 "sessionId":"t56s2-…-sess","status":"final",
 "citations":[{"rel":"idea:t56s2-…-idea-a","pointer":"/properties/status"}]}
```

断言实证(`'clientView' in turn === false`,两回合皆然):**clientView 到 ChatTurn 层整体丢失**
——不是 null,是字段不存在,消费方无法表达"当时上下文未知"。join 键三元组
`(principal 事件列, sessionId, turnId)` 在 user 事件与 chat-turn 事件上双全,join 无数据障碍。

组件层(history-replay 探针,FloatingChat 按 localStorage sessionId 刷新重放):
`restoreSession` 镜像断言证明重放 user 消息 = `turn.goal.verb`、citations 只挂回合末条
assistant 消息;渲染结果中**没有任何当时 thread/focus 标注**;两条引用 chip 外观完全一致,
无法区分"A 线回合的引用"与"B 线回合的引用"。注:今天 user 原话事件的 content 恒等于
`goal.verb`(`turn-context.ts:91` 写入),故文本零漂移;但 history 路由根本不读 user 角色
chat-message-appended(见步骤 2),重放文本实际取自 chat-turn.detail.goal。

### 步骤 2(缺 clientView 的历史回合):静默成功,"未知"不可表达

- 旧 shape(无 clientView)回合 → history 200 正常返回,`'clientView' in turn === false`。
  与"有 clientView 但被丢弃"的回合在投影上**逐字节相同**——三态("有时点观察"/"事件无观察
  (旧版)"/"user 原话事件整体缺失")在 ChatTurn 上坍缩成一态,PRD 要求的"上下文缺失则
  明确未知"(FR7)在现 shape 下无处落笔。
- 只追加 user chat-message-appended 而无 chat-turn 事件的提问 → history 返回 `turns: []`:
  **history 路由完全忽略 user 原话事件**(route.ts 只消费 chat-turn-started/progress/chat-turn
  与 assistant 的 citations join),该提问对刷新后的用户彻底不可见。

### 步骤 3(集合引用):pointer 不参与定位,风险在"心智错位"而非标签错位

DB 侧:`{rel:'ideas:…', pointer:'/entities/1/properties/rel'}` 经 history 原样透传,
`Object.keys(citation)` = `['pointer','rel']`,无任何快照/版本/identity。

组件侧(实测):CitationList 对该引用懒取 `rel` 顶层实体,标签显示**集合当前声明身份**
("T56S2 想法清单(今天的成员顺序)"),点击 href 落集合本身
(`/canvas?focus=ideas%3At56s2&thread=…`),pointer 只进 `title` 审计属性。
关键实证:**集合级引用与单对象引用(`pointer:'/'`)的 chip 可见结构完全相同**
(标签+rel 对照,唯一差异在不可见的 title),页面也无"回答时/当时"字样——
用户会以为点的是"当时那个对象",实际落到今天的集合。FR8 说的"不能拿今天的第 N 项
推断当时对象"在现状不表现为标签文本错误(标签是集合名),而表现为**无时点边界提示的
集合级 chip 被当成精确定位**。

### 步骤 4(改名与权限撤回):标签恒为当前名,无缓存、无失效机制

- 改名:fetch 返回"改名后的新标题" → 标签即显示当前名,**无"当前名称"时点标注**
  (FR8"实时标题必须表明是当前名称"现状未实现);回答时名称不可知(FactRef 无快照),
  也不应伪造。
- 授权撤回(fetch 403)与网络失败(throw):标签诚实回退 `rel` 本身,不猜名称、不暴露
  存在性细节,引用行不炸整条消息;点击仍导航到该 rel(点进去得到 denied 回执)。
- 缓存现状:`useDeclaredTitles` 是组件内 `useState` + `cache:'no-store'`,**无模块级缓存、
  无跨实例缓存、无失效机制**(实测同一 rel 两次挂载产生 ≥2 次 /api/entity 读取)。
  推论:不存在"撤回后残留旧标题"的缓存问题——代价是历史消息每次挂载都重读全部 rel
  (当前规模可接受,大历史面板会有 N rel/挂载 的请求放大)。

### 步骤 5(迟到响应/旧 SSE):UI 单飞 + 流取消 + turnId 防线,层层兜底

- **running 中无法连发第二问**:assistant-ui composer 在 running 态把「发送」按钮替换为
  「停止」(`queryByRole('发送') === null`),composer 输入框仍可打字(草稿保留——S3 关心
  的存续点顺带实证)。`use-chat-session.ts` 的 `onNew` 本身没有 isRunning 守卫,单飞保证
  完全在 composer 门禁层。
- **停止后旧流晚到帧不渲染**:点「停止」→ abort 取消读取;此后对旧流 controller 推送
  final 帧(无论 turnId 是否正确)均不可达(流已 cancel,enqueue 抛错被探针捕获),
  断言迟到结论未出现在消息列表,第二问照常完成且列表不被污染。
- **帧级防线**:`use-chat-session.ts:402` `'turnId' in frame && frame.turnId !== turnId`
  丢弃异回合帧(探针曾因自造 turnId 与客户端 `crypto.randomUUID()` 不符而收不到帧——
  反向证明该防线真实生效)。
- **残留缺口(纯函数实证)**:citations 归属用 `withCitationsOnLastAssistant`
  (`chat-types.ts`)按"最后一条 assistant"落位,与 turnId 无关;若并发回合真的发生
  (绕过 composer 门禁,如未来多入口共写同一 hook 状态),先到回合的引用会挂到后到回合
  的回答上。单飞门禁存续的前提下这是理论缺口,P3 改动 chat 状态拥有者(S3)时须保持
  单飞语义或把 citations 归属改为按 turnId。

### 步骤 6(history 读取页边界):默认无上限,显式 limit 硬顶 101

`packages/db/src/events/query.ts` 实测:
- 路由同款 `listEvents(db, 0, {principal})`:SQL **无 LIMIT**,全量返回——134 条
  (130 filler + 1 回合 4 事件)全部返回(2ms 量级);**今天不存在"因默认页上限漏判"的
  正确性问题**,存在的是 principal 级全史扫描的成本问题(live 侧
  `loadAgentConversation` 同样 seq 0 全量:`session-events.ts`)。
- 显式 `limit` 必须 1..101,`limit:102` 抛 `event limit must be an integer between 1 and 101`;
  **若给读取加默认页 limit=101,页外回合被静默截断**:101 条 filler 之后的一回合在
  `limit:101` 读取下 0 条可见 → 回合消失、citations 消失,且是静默丢失(空与非空无告示)。
- 既有有界读参数(可复用、无需扩 storage):`rel`/`kind`/`principal` 等值过滤、
  `order:'desc'` + `beforeSeq` 游标。实测 `rel:'chat:<id>'` 精确取回该会话 4 事件。
- dev/local profile 下 `chatHistoryPrincipal` 返回 undefined(`history-access.ts:9-18`,
  production 才走凭证 principal),路由不带 principal 过滤;实测同 rel 不同 principal 的
  chat-turn 会混入同一响应(local demo 开放视图,生产由凭证轴隔离)。S2 的 join 方案
  必须显式带上 principal 过滤,不能依赖现状。

### 步骤 7(live/history 一致性):缺口唯一且在 ChatTurn 投影层

同一批事件两侧对照(实测):
- live 侧(`loadAgentConversation` → `conversationView`/`foldConversation`):
  user 消息带 `clientView`,`view.clientView` 还有 `sourceMessageId=turnId`、
  `observedAtSeq` 的精确回指——**live/prompt 链路的当时上下文是完整的**。
- history 侧(同一批事件经 GET /api/chat/history):`'clientView' in turn === false`。
- 结论:语义不一致不是事件缺失、不是写入丢失,而是 **history 路由没有把既有 user 事件
  join 进 ChatTurn**。精确 join 键(principal×sessionId×turnId)两侧可得
  (user 事件 `messageId=turnId`,assistant 事件 `messageId=turnId:assistant`)。

---

## 2. 出口定案(design.md §3-S2 出口逐项)

### 2.1 读取/事件 shape:写侧零变化,读侧一处扩展(先记决策,不回填)

- **不改**:事件种类、chat-message-appended detail、FactRef(维持 `{rel,pointer}` 二字段,
  D47 口径不变)、不加快照/版本字段(会扩大写入模型,且违反"新元数据不回填历史")。
- **要扩(只读投影)**:`ChatTurn`(history.ts)新增
  - `clientView?: ClientViewReport`——路由从同 rel 下 user 角色 chat-message-appended
    按 turnId join(数据已在日志里);
  - `userContextKnown: boolean`(或等价判别字段)——由"是否找到该回合 user 原话事件"
    得出,区分"事件存在但无 clientView(旧版)"与"user 事件整体缺失";两者 UI 都按
    "当时上下文未知"呈现,但审计口径可分。
- 新增字段只影响 `GET /api/chat/history` 响应与 ChatTurn 类型,属只读投影扩展;
  落地前按 track 纪律在 DECISIONS 记一条(T56 的 P0.5 决策条目可并入),
  存量历史回合不回填 clientView。

### 2.2 join 与缺失策略

- 精确 join 键 = `principal`(events 列)× `sessionId` × `turnId`(detail),三键双侧可得;
  路由 join 时必须同时按 `rel:'chat:<sessionId>'` + `principal` 过滤读取(见 2.5),
  fold 侧沿用 `belongsToSession` 双键再校验(D68.3)。
- live 面板不显示本次回合的 clientView(用户当场可见),history 回合显示:
  - `userContextKnown && clientView` → "本回合发表于 [当时 thread 可读身份] · 注视 [focus]"
    (身份经当前授权读取,失败回退 rel,不猜);
  - 否则 → 明确"当时上下文未知",**不得**用最新 presence、当前 URL 或最近一条 clientView
    补旧消息(D51/注意力纪律;design §2"禁止的推断"行)。
- user 原话文本维持取 `chat-turn.goal.verb`;今天它恒等于 user 事件 content,若未来分离,
  同一条 user 事件 join 已能取出原话,shape 无需再变。

### 2.3 引用降级示例(集合级来源 + 时点边界的展示 shape)

引用 chip 按可证明性分两型(纯展示层区分,数据仍是不变 FactRef):

```text
精确型(rel 可解析对象身份,pointer 为对象级或 '/'):
  [想法 A(当前名)]  idea:idea-a        ← 标签 + "当前名"时点标注 + rel 对照
集合/成员型(pointer 指向集合成员且成员身份不可证明):
  [集合 · 成员路径]  想法清单(当前名) · /entities/1
      └ 副行(或 title/aria):"回答依据当时的集合内容;不指向今天同一位置的条目"
  点击落点:集合实体页(citationCanvasHref(route, citation.rel) 不变)
```

- 判别用纯指针前缀(`pointer` 以 `/entities/` 或可声明的集合成员路径开头)且不解析
  回答自然语言(FR8 红线);单对象引用显示"当前名"标注是改名场景的最小时点诚实。
- 不为历史引用发明 identity URL、不补"当时第 N 项"的名称(无快照不可知)。

### 2.4 授权失效后的标签缓存策略

- 现状无缓存即无失效问题:撤回后下次挂载 403 → 诚实回退 rel。**P3 不建全局标签缓存、
  不持久化失败结果**(与 FR10"同 rel 内容更新不能继续显示旧事实"一致)。
- 若为请求放大引入缓存:限组件实例内存级、成功值可留、失败值不缓存(维持现状语义)、
  并挂现有 `cache.invalidateAfterExec`/thread-updated 事件做失效;失败与空严格区分。

### 2.5 历史读取的过滤/分页方案(不全站扫描、不静默截断)

- history 路由把 `listEvents(getDb(), 0, {principal})` 改为
  `listEvents(getDb(), 0, { rel: 'chat:<sessionId>', principal })`——有界性来自
  **按会话过滤**,不是按页截断;生产 principal 过滤经 `chatHistoryPrincipal` 保持,
  dev 开放视图行为不变(如实记录于 2.5 证据)。
- 红线(实证支撑):任何"默认 limit"都会把页外回合/citations 静默截没(limit 硬顶 101);
  若未来会话事件量需要真分页,用 `order:'desc'`+`beforeSeq` 游标(参数已存在)且 join
  语义必须"读到该回合全部事件为止",UI 上如实给"更早回合"入口。
- 索引现状:events 表只有 `events_seq_asc`/`events_domain_seq_asc`;rel 过滤在 seq 扫描上
  filter,单会话读取仍是 O(principal 全史) 的扫描成本(返回行数有界)。demo 规格可接受;
  若加 `(principal, rel, seq)` 索引属 schema 变化,须先单独决策,不在本 track 默做。
- live 侧 `loadAgentConversation` 的 seq 0 全量同病同理,可与 history 改造同批处理,
  但注意它按 `domain:'core'` 读取的口径不变。

### 2.6 测试落位建议(P3 Red;GR3 近限回避)

| 测试 | 位置 | 说明 |
| --- | --- | --- |
| history 路由 join/clientView/userContextKnown/页边界回归 | `apps/web/src/app/api/chat/history/`(本探针 DB 文件原位) | 触库;正式化时按分类规则登记/重生成 `vitest.db-tests.list.ts`,否则会被 unit 项目误收(不可达 DATABASE_URL 必炸) |
| ChatTurn→UI 重放映射、"未知"显示策略纯函数 | 新子目录 `apps/web/src/chat/history/` | **`apps/web/src/chat/` 本体 3974/4000 近限,不得再堆**(D53 沿功能拆解) |
| CitationList 两型 chip、"当前名"标注、denied 回退 | `apps/web/src/components/chat/`(两枚种子已在此) | 纯 unit,目录余量充足 |
| 刷新恢复/引用点击 E2E | 扩展现有 `e2e/interaction/chat-citations.spec.ts` | GR5:不新增 per-track Playwright 配置 |

### 2.7 探针代码去向

- **删除** `apps/web/src/app/api/chat/history/s2-probe.test.ts`(本报告完成后即删):
  它 import `@ui4a/db/events`/`getPool`,按分类规则属 db 项目却未登记
  `vitest.db-tests.list.ts`,留存会落入 unit 项目(不可达 DATABASE_URL)破坏
  `pnpm test`;而登记共享清单文件与并行窗口纪律冲突。其 8 个场景与断言已完整录于
  本报告 §1,可按 2.6 原样重建。
- **保留为 P3 种子**:
  - `apps/web/src/components/chat/citation-list.s2-probe.test.tsx`(6 例:集合 chip、
    两型同构、改名、403、网络失败、无缓存);
  - `apps/web/src/components/chat/history-replay.s2-probe.test.tsx`(3 例:重放映射、
    单飞/迟到帧、citations 归属缺口)。
  理由:纯 unit(不触库、unit 项目直跑)、lint/format/tsc 全过、kebab-case 合规命名、
  所在目录余量充足;断言多为"现状锚",P3 定案后反转为正式断言即可。
- 仓库外遗存:`/tmp/vitest.s2.config.ts`(运行配置)、隔离库 `ui4a_s2_test`
  (TRUNCATE 后无业务状态,可留作 P3 复跑)。

---

## 3. NOT RUN(不得当作已验证)

- 完整 `pnpm check` / `pnpm governance` / 全量 vitest / Playwright E2E 未跑
  (非目标;仅定点 eslint/tsc/prettier + 探针 suite)。
- production profile 的 history principal 过滤未做端到端实测(仅代码路径核查
  `history-access.ts:9-18`;实测的是 local profile 开放视图)。
- 大会话规模下按 rel 过滤读取的性能曲线未测(正确性实证至 134 事件量级)。
- `(principal, rel, seq)` 索引的收益未验证(属 schema 决策,未动)。
- meta 平面(`/_meta`)的 chat 历史对等性未涉及;agent 路由按 spec 约束未触碰
  (历史回答讲另一个对象不构成 LLM 答错证据)。
- S1(工作线呈现)/S3(布局与会话存续)范围问题未测;3100 端口 dev server 未使用。
