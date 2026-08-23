# UI4A v2 架构简报(实施导向)

> 蒸馏自正典 `docs/UI4A-v2(重排版):界面作为合同,应用作为数据,能力作为边界.md`(v2.6,805 行),辅以 `README.md`、`docs/UI4A-技术选型.md`、`GOAL.md`、`DECISIONS.md`。所有 JSON 与编号规则为原样引用,出处以"(第 N 层)/(附录 A.x)/(README)/(GOAL)"标注。
> **用途**:实施 subagent 的上下文入口。需要更多细节时再回读正典对应章节(注意全角标点文件名)。
> **当前性规则**:本简报同时保留历史推导和当前实现；遇到冲突时以 `GOAL.md` 与较新的 `DECISIONS.md` 为准。T15 已 supersede AI-optional/rule fallback，T16 已 supersede render capability/concern 凝固，D28 已删除 publishing 摘要工件。

## 1. 分层总览

正典五部十一章:

| 部 | 层 | 职责一句话 | 状态 |
|---|---|---|---|
| 一 | 1–4 | 论证为何是合同:处境稀缺、AI 从内核变用户、记忆归应用、sitemap 缓存分层 | 论证 |
| 二 | 5 | 已验证实现:状态机+schema 全栈实测、调试教训(目标相关性/拒绝即数据) | 钢 |
| 三 | 6–7 | 定义平面(应用编辑自己)、能力平面(与真实世界的边界) | 粉笔有图纸 |
| 四 | 8–10 | 人的位置:信任线(委托/确认)、交互(三扇门/字段语义)、渲染(生成式+骨架+BIOS) | 粉笔有图纸 |
| 五 | 11+ | 策略、九条洞、闭环自审、五条垂直切片 | 账本 |

最终图景(导览原话):**"一个真相(单引擎 + 单日志)、两个站点(业务 + `_meta`)、三个平面(业务、定义、能力)、一套协议(带 schema 的实体、带 guard 的动作、可导航的链接)、一套渲染器架构——外加一条信任线:主语是委托,确认是消息,信任是数据。"**

依赖方向:事件日志是共享底座,不属任何平面(A.0);`_meta` 独立的是 HTTP 面不是进程——路由进同一个引擎、同一个 atom(单写串行提交)、同一条日志,类型区分业务事件与定义事件(第六层)。施工顺序 = 五条垂直切片(README"施工顺序")。

## 2. 合同层(Siren)

**实体结构**:引擎做 `rel → Siren 实体` 的投影,字段为 `properties / actions / links`,且 **"guard 求值结果逐项注入"**(第五层);选型文档细化为 properties/actions/links/**guard-results** 四件组装。子实体经 `entities[]`(Siren sub-entity),B2 的"经子实体链接直达 `post:post-welcome`"即靠它。

**业务 rel 命名**:资源实例 `资源类型:实例名`——正典出现 `post:post-welcome`、`vm:i-abc123`、`flow:<name>`(flow 定义实体,节点/边作为子实体)、`confirmation:<id>`(待确认实体)。meta rel 用 `meta/` 前缀九个(见 §10)。

**action 声明字段**(A.2 中 action-definition 的 properties 原样):`name, title, method(POST), to(目标节点), guards[](谓词名数组), requires-confirmation("high" 风险标注,第八层), effect, fields[]`。顶层 actions 可只带 `name/title/guards`。`effect` 两形:**纯效果 `{"type": "transition"}`;能力效果 `{"type": "spawn", "capability": "summarize", "bind": {...}, "on-done": "summarized"}`**。"定义定义的语言,就是被定义的那套语言"。

**field-definition**(A.2 原样,RJSF 的直接输入):

```json
{ "name": "region", "type": "select",
  "semantics": "org-standard",
  "source": { "kind": "context", "from": "project.homeRegion" } }

{ "name": "content", "type": "textarea", "required": true,
  "semantics": "work-product",
  "source": { "kind": "proposal", "capability": "draft", "options": 3,
              "selection": "human-required" } }

{ "name": "subnet", "type": "select",
  "semantics": "elicitation",
  "on-invalid": "clarify",
  "elicit": { "strategy": "options-first", "max-turns": 5, "timeout": "72h" } }
```

四种语义:org-standard / intent / work-product / elicitation;六种来源:默认四态(静态、上下文、策略路由、词汇别名)、显式意图、起草+选择、引出、查找、效果产出。日志记录参数出处 `default / intent / proposal / elicited`。

**端点**:agent 只用三个——`sitemap / entity / exec`(第五层)。业务面 `/.well-known/ui4a.json`;meta 独立站点 `/_meta/.well-known/ui4a.json`、`/_meta/api/entity`、`/_meta/api/exec`(第六层)。

**sitemap**:不是 URL 清单,是"应用交互拓扑的完整声明:界面清单、流程图(用户故事的机器可读形态)、迁移规则、每节点的 action schema、语义锚点"(第四层);**从状态机自动推导**,定义激活即重生成,版本号即缓存键。缓存分层四段(原样):`[应用 sitemap](版本级) / [任务流程定义](任务级) / [状态投影](会话级,append-only) / [当前人工输入](每轮,永远最后)`。

## 3. 引擎与裁决

**三层裁决精确顺序**(第五层原话,顺序不可换):

> 1. **action 是否声明于当前节点** → 2. **guard 谓词** → 3. **字段 schema**,非法动作直接拒绝且入日志。

TS 映射(选型 §3):动作声明 → Cedar 策略 + JSON Schema(Ajv)校验 → XState 转移。引擎单 atom,所有变更串行提交(第六层)。

**guard**:谓词经注册表共享(demo 用 CLJC 物理共享;TS 中放 `packages/shared` 全栈共享),"按钮的 disabled 与 Agent 看到的 guard 不满足是**同一个谓词的两个投影**"。guard 必须纯且快、只读快照,**铁律:guard 永远不调 capability**——capability 结果先落状态,guard 再读状态(第七层)。`requires-confirmation` 不是状态谓词而是**策略标注**:谓词答"状态允许吗",标注答"这个 actor 是否需要委托人确认";guard 结果由两种扩为三种:**通过、拒绝、挂起(动作转入 pending 而非被拒绝)**(第八层)。

**动词→注册表镜像**(第六层):呈现(GET entity)→投影注册表;裁决(guard)→谓词;迁移(effect)→效果;第四动词"触达"(capability)→外环 capability 目录。capability 三类动词:**转换**(形式变语义不变)、**提取**(工件→结构化描述,模型背书)、**效应**(发邮件/调外部 API)。能力接口统一 `artifact(s) in → artifact out`,工件内容寻址入日志,业务实体只存引用;schema 参数化允许(`table→json:<target-schema>`),业务名词参数化不允许(第七层)。

**事件日志字段**:每个事件带 `actor: "human" | "agent"`(第八层升级为求值输入:`actor=assistant, principal=user`,权限求值 = 用户角色 RBAC ∩ 委托范围);**拒绝的动作同样留痕且带原因**;确认链路留痕"提议者 agent、确认者 human、信道、时间戳"。

## 4. 事件溯源

操作记录 = append-only 事件日志;当前 UI 状态 = 日志折叠后的物化状态;chat history = 日志的定制投影(第三层)。demo 印证:引擎侧一份 append-only 日志,聊天 session 存浏览器 localStorage 是纯投影,清掉无损。一条日志两个层面:对象层状态迁移 + meta 层定义事件 + capability 产物共用,可回答"这篇文章为什么是 archived"的跨层因果(第六层)。重放确定性:引擎物理上只能经 capability 接触外界,**日志 + capability 产物 = 完整重放输入,应用核心是日志的纯函数**;任何依赖时间的逻辑必须是时钟 capability 的 **tick 提议**,不许后台线程改状态(第七层)。验收(GOAL I5):从空库重放,实体状态 hash 与重放前一致。已知洞 #8:双层日志的重放与存储成本未测量。

T15 将聊天正式纳入同一事件溯源口径：user/assistant 原话按 role、session/turn、message id 和顺序 append-only 保存；服务端从日志投影有界近期原文以及结构化 `activeGoal`、focus/history、referents、constraints、pending clarification、authorized effects 和最近结果。结构化状态可被后续原话修订，但不得回写或替换原始消息；刷新、重连和 delegated 恢复均从日志重建，不建立进程内第二真相。

执行审计同样是事件投影：effect 请求携带 user `sourceMessageId + quote`，服务层按 principal、时序和原文再次核验；成功事件记录 action declaration、guards、schema、confirmation policy 和授权索引，随后的人类确认与最终业务事件继续同链。`execution-audit` 只能从这些事件解释“谁授权了什么、为何允许、谁确认、发生了什么”；找不到授权时输出 `authorization-error`，禁止反向编造原因。

## 5. B1–B3 基线场景(T2 验收脚本)

正典第五部实测表 + GOAL 断言。总口径(GOAL):**每个场景由两种执行者各跑一遍——人类走 renderer,agent 走合同(tools/HTTP),同一套场景,同一份日志**。

- **B1 委托发布**"帮我发布一篇文章":agent 导航至发布向导 → 三步填充(严格按字段 schema)→ publish → 文章真实落库,计数 2→3。
- **B2 点名下线**"把 post-welcome 下线":经子实体链接直达 `post:post-welcome` → 执行 unpublish → 精确下线一篇,其余未受影响。此场景源自"顺手归档六篇"教训,目标相关性分层(demo 修正后决策次序,原样):**点名的资源(上下文参数值出现在目标里) > 点名的动作(名字/标题与目标有词级交集) > 与目标相关节点上的流程推进词 > 自由漫游**,且每层都有停止条件。
- **B3 审核队列**"审核所有待处理评论":导航至审核队列 → approve 至 pending 清空 → 队列归零,事件留痕。
- **B4 失败呈现**:无效 API key,请求真实发出,401 如实进入对话,"失败也是合同的一部分",委托不崩溃。

每步三种操作:**navigate(沿 GET actions 与 links 迁移,含子实体链接)、action(提交引擎裁决)、done**。`done` 的判定规则(demo 教训 #2):流程的终点不是目标的终点,**done 必须由"完成类动作成功过"相对目标判定**。被拒动作的两种后续:终结一条路径(拒绝去去重),或字段级自救——direct 被拒后按 action 字段 schema 填默认值重试(教训 #3:拒绝是数据,不是失败)。

## 6. driver 架构

**AI-first agent 执行循环**(T15 supersede 第二层历史实现):真实 LLM driver 根据 sitemap、授权实体事实、会话上下文与轨迹动态理解目标；生产 Assistant 不再以 rule driver 兜底。scripted/mock driver 仅验证循环协议。模型缺失或失败时诚实失败且零副作用，人工 renderer 保持可用。裁决器治理副作用，不替代模型认知。

生产接口形态(选型 1.1,两层工具):固定协议出口为 `navigate` / `answer` / `exec` / `exec_plan` / `clarify` / `render` / `done` / `fail`;每状态动态动作工具由当前实体 `actions[]` 逐个生成，字段 schema 内联进参数，guard 求值结果嵌进 description。`navigate` 的 rel 来自实体 links/子实体；LLM prompt 同时披露完整授权 facts、links、actions、guard-results、app-scoped sitemap capabilities 与会话约束。HTTP 合同是唯一真相,tools/MCP 是投影；合法 action 只代表“合同当前允许”，不能替代 user effect authorization。

**认知自由，读取受权，物化受管，副作用受裁决**：对当前授权 facts 的阅读、临时总结、比较和解释是 LLM 原生能力，直接经 `answer` 返回，不注册 `read/summarize/compare/explain` action。需要跨会话复用、结构化 schema、重试、成本或审计的模型输出才进入 capability，物化为带 source/model/schema/content hash 的 artifact；将 artifact 写回业务字段或改变节点仍需独立 action、guard/schema 与确认。正式模型工件在任何 action/spawn 事件写入前要求外部 `LLM_MODEL`，禁止 `unconfigured` 半成品。

**两种 clarify 不混用**：普通对话中的歧义澄清是 Agent 协议终态，不产生 artifact，也不要求 application capability；只有需要 durable、schema-driven elicitation 的正式字段收敛才使用 application `clarify` capability(第九层规格):

```
capability: clarify
输入工件: {fields: [字段schema], context: 实体快照, 约束: guard 求值}
输出工件: {values: {字段: 值}}          ← schema 校验通过才准出
执行者:   高级 AI × principal
终止条件: schema 满足 | max-turns | timeout
```

正式 elicitation 的输入是悬挂字段，输出是满足 schema 的值。触发双层:主动(实体投影携带字段语义,agent 见 elicitation 字段直接开澄清)与被动(提交校验失败且字段声明 `:on-invalid :clarify`,引擎把拒绝转澄清 session)。失败回流路由:**状态型失败(非法迁移)回 agent,意图型失败(缺 intent 字段)路由给人**;出处记作 `elicited:session-N`。

## 7. :form runner 与哑路径

durable elicitation 的 runner 阶梯(第九层)可从传统表单到高级模型对话；它描述 capability 的执行策略，不是产品 Assistant 的 driver fallback。"最哑的澄清就是传统表单本身"。表单从实体 `actions[]` 的 fields 生成;**field-definition(含 semantics/source/on-invalid/elicit)就是 RJSF v6 的输入**(JSON Schema draft-07 + Ajv,RJSF 直接吃)。渲染词汇表 `form` 词条绑定 schema:`{schema: action.fields, data}`。Assistant 不可用时保留表单/renderer 控制面，但不伪装完成自然语言任务。

## 8. 悬浮聊天与三投影

assistant 是客服插件形态**悬浮窗**:跨页面悬浮,点击展开聊天;用户输入目标,agent 逐步汇报轨迹(导航、回答、执行、拒绝原因、完成);**聊天界面就是事件日志的投影层**(第五层)，原始消息与结构化会话状态同源重建。三投影(选型 1.1):**renderer 给人、HTTP 给脚本、tools/MCP 给模型**——同一合同,三种消费。聊天窗升格为"人类注意力的唯一入口"(第九层):目标形成、途中澄清、确认批准、草稿选择,全部作为对话到达。provider profile 仅由外部 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 完整提供；default/auto 都解析为 LLM，缺项、端点错误或超时诚实失败且零业务副作用。

### 8.1 Presentation Sidecar 旁路

T16 将 generative presentation 从 Chat context 拆为旁路：Chat 只发
`PresentationRequest(subject,intent,constraints,delivery)` 并保存 receipt id；独立 Plane 执行
Situation/Lens 授权、Recipe/Sidecar fastpath、Surface planning 和 A2UI compilation。持久化对象是
binding-only semantic Surface，不是 hydrated facts 或 SDK model。

```text
packages/shared/presentation     thin request/receipt
packages/engine/presentation     pure lens/surface/recipe/sidecar/patch folds
packages/agent                   bounded Presentation and Revision LLM adapters
apps/web/src/db/presentation     append-only projection adapter
apps/web/src/engine/presentation Broker, Recipe pregen and fastpath
apps/web/src/render/presentation deterministic A2UI compile/hydrate
```

查找顺序固定为 user pinned/cache → promoted/candidate Application Recipe → generic → runtime
planner。每次命中仍重新授权、校验依赖并实时解引用。Sidecar key 是用户级
`(principal,policyScope,subject,intent,deviceClass)`，禁止 sessionId。自然语言和直接操作只产生
受限 semantic patch；共享 Recipe 必须去用户化、机械 diff、human promotion，并能从 Presentation
事件重建。Presentation fold 与 Business fold 分离，任何 Presentation event 误入 Business fold
都 fail-closed。

### 8.2 外置 App Authoring Agent 边界

Application 创建暂不进入产品 Chat runtime。外置 Agent 可以读取定义语言、用户故事和 meta
contract，起草完整 Application Bundle；UI4A 只接受候选定义，并执行确定性的 parse、schema、
invariant、diff、human approval、activation、audit 和 replay。外置 Agent 不获得绕过 meta
裁决的写路径，其模型、记忆和编排方式也不成为 UI4A 内核协议。

### 8.3 External Agent CLI 与 Governed Draft Ingress

T17 把 `ui4a` 定义为 HTTP/Siren/meta 的可安装参考客户端，不是新协议或 Agent runtime。
外部候选经 `meta/drafts` 与 `draft:<id>` actions 进入独立 Draft domain；payload 以 SHA-256
内容寻址保存，`draft_projection` 可从事件重建。`SubmissionPolicy(draft|direct|none)` 由激活
合同与 scope 决定，请求不能覆盖；Presentation Sidecar 不进入 Draft。

Flow Draft 的 human approval 在同一 PostgreSQL 事务追加
`definition-candidate-applied` 与 `draft-accepted`。core event 独立重放完整定义、版本、diff、
checks 与审批 provenance；旧实例保留 bornVersion，新实例读取新 active pointer。CLI 无 LLM、
approve/reject、身份 flag 或 raw write；local demo 身份仍按 D8/D10 明示为 self-reported。

## 9. 五条垂直切片(第五部,施工顺序)

1. **确认门切片**:agent 执行高危动作 → guard 挂起 → pending 实体化 → notification capability 送达 → 人类在推送上 approve → 事件留痕带 actor/principal。一次验证 guard 第三语义、确认实体、出站能力、委托模型四个论点。构成(README):Cedar 风险策略 + guard 挂起语义 + Temporal notify activity + RJSF 渲染 pending 实体 + 收件箱。GOAL S1 断言:动作未生效挂起 → human approve(actor=human)→ 生效,日志含 actor/principal/信道。
2. **最小 meta 切片**:flow 定义从源码常量挪进事件日志(XState machine-as-JSON),加定义编辑流和激活 guard;"非法动作被拒绝、非法定义也应被拒绝"从原则变成测试用例。S2 断言:非法定义被拒且留痕 → 修正 → 机械 diff 上人类批准 → sitemap 重生成 → agent 下一步即可用新动作,**无任何 prompt 改动**。
3. **委托实体切片**:agent 执行从浏览器 Promise 链挪进引擎流程实例(Temporal workflow 即委托实体):N 路并行、崩溃续跑、舰队队列页。验证"裁决器即并发控制"(两个 agent 抢同一条评论,一个成功一个拿到 is-pending 失败)与人类监控成本不随 N 超线性。
4. **plan-exec 切片**:agent 一次决策输出整段计划,引擎**一次事务里逐步模拟**——每步仍做完整三层裁决,通过则提交,被拒则分步报告。"不是信任计划,是批量裁决计划。"
5. **骨架与渲染切片**:历史 T7 先验证词汇表、binding-only 与 action 背书；当前 T16 使用薄 Presentation Request、Application Recipe、用户级 Sidecar、semantic Surface Tree 和 A2UI hydration，取代 render capability/concern 凝固。

**尚未解决的洞(九条,按严重度)**:①安全权限(剩确认疲劳实证、范围配置 UX、注入有界化未消除且 meta 对注入有放大效应——`_meta` 审批 guard 是必需品);②意图缺口实证;③标准化卡位(独创性窗口一两年);④表达力边界(自由画布/多人协作无解);⑤零数据(缓存命中未测);⑥定义迁移实操;⑦capability 沙箱真实性("不要假装 eval 加正则过滤等于安全");⑧双层日志成本;⑨生成式渲染信任边界(binding-only 未实测、diff 疲劳)。

## 10. 附录 A:`_meta` 规格(T4)

**九个顶层 rel**:可写——`meta/flows`(流程状态机:节点/字段/动作/边)、`meta/resources`、`meta/projections`、`meta/capabilities`(kind:转换/提取/效应、输入输出 schema、宿主、成本档)、`meta/activations`(激活队列)、`meta/policies`(scope、确认阈值、渐进信任账本);只读——`meta/versions`(内容寻址工件)、`meta/registries`(谓词/效果/类型/kind 清单)、`meta/self`(definition-lifecycle 自身定义+种子 guard 集)。

**最小核四个**(删除测试,A.1.1):`meta/flows`(没有它定义不是数据)、`meta/activations`(没有它 meta 沦为绕过权限的后门,**比没有更糟**)、`meta/registries`(否则 agent 只能猜 guard 名)、`meta/self`(读不了就操作不了)。最小核全部行为 = **一台状态机(definition-lifecycle)+ 一排编辑动词 + 一组不变式 guard**。其余五个的到来时机:resources(第一个全新资源类型)、projections(第二次手写 entity builder)、capabilities(第一次出站调用,第一个是 notify)、policies(assistant 真带 principal 行走时,阈值可先硬编码)、versions(严格说是日志视图)。

**定义实体的 Siren 形状**(A.2 原样,节选关键字段):

```json
{ "class": ["meta", "flow-definition"],
  "properties": { "name": "post-status", "version": 3, "status": "active",
                  "initial": "draft", "terminal": ["archived"] },
  "entities": [{ "class": ["meta", "node-definition"], "rel": ["node"],
    "properties": { "name": "published", "title": "已发布" },
    "entities": [{ "class": ["meta", "action-definition"],
      "properties": { "name": "archive", "title": "归档", "method": "POST",
                      "to": "archived", "guards": [],
                      "requires-confirmation": "high",
                      "effect": { "type": "transition" } } }] }],
  "actions": [
    { "name": "revise",    "title": "修订(开新草稿)", "guards": ["is-active"] },
    { "name": "deprecate", "title": "废弃", "guards": ["no-live-instances"] }],
  "links": [{ "rel": ["self"], "href": "/_meta/api/entity?rel=meta/flow:post-status" }] }
```

**激活请求**(A.2 原样节选):`properties` 含 `id, status: "pending-approval", artifact: "sha256:…", diff, requested-by: {actor, principal}, checks: [{name, pass}]`(如 edge-targets-exist);`actions`: `approve`(guards: actor-is-human, approver-has-mandate)、`reject`(必填 reason 字段)。**委托策略**(A.2):`scopes: ["read:*", "write:low-risk"]`、`confirmation: {high: "always", medium: "until-3-clean"}`、`trust-ledger: {archive: {clean: 2, needed: 3}}`;actions: grant-scope / revoke-scope / reset-trust(actor-is-human)。

**编辑动词**(A.3,草稿态 flow 上,全部过同一三层裁决):`add-node`(is-draft, node-not-exists)、`add-field`(is-draft, node-exists, type-registered)、`add-action`(is-draft, node-exists, to-exists, guards-registered, effect-known)、`remove-node/field/action`(is-draft, not-referenced)、`submit`(is-draft)、`revise`(is-active,产生 v+1 草稿)、`deprecate`(no-live-instances)。

**definition-lifecycle**(A.4 原样):

```
draft --submit--> validating
validating --checks-pass--> pending-approval
validating --checks-fail--> draft(附校验报告)
pending-approval --approve--> active(写 versions,重生成 sitemap,bump :version)
pending-approval --reject--> rejected(reason 入日志)
pending-approval --timeout--> expired(时钟 capability 的 tick 提议)
active --revise--> draft(v+1)
active --deprecate--> deprecated
```

**激活不变式**(A.5,种子 guard 集,即测试用例目录):`edge-targets-exist`;`guards-registered` / `field-types-known` / `effect-known` / `capability-registered`;`initial-exists` + `terminal-reachable`;`resource-href-unique`;`projection-refs-valid`;`capability-schema-compatible`(spawn 的 bind 与能力输入 schema 相容);`no-live-instances-on-removed-nodes`;`field-source-declared`(事实型字段必须声明来源,不得悬空等 agent 猜);`work-product-selection-gated`(价值载体字段必须携带 human-required 选择声明,exec 时 guard 检查选择事件存在)。

**在途迁移三手段**(第六层):实例盖版本戳(按出生版本走完);定义只增不删(废弃代替删除);激活前校验是读库 guard。**权限平面**(A.6):读——已认证 principal 皆可;草稿编辑——human-admin | meta-agent;approve——actor-is-human 且有 mandate;整站挂 `_meta` 前缀单点收口鉴权/限流/审计。**跨站规则**(A.7):业务实体 links 可携带 `_meta` 完整路径 href(客户端零改动跨站),业务站导航枚举排除 `_meta` 前缀(进入定义层必须显式意图)。**BIOS**(A.8):内建 UI 五面——定义查看、激活队列+机械 diff+approve/reject、版本历史+回滚、词汇表浏览、EDN/schema 表单最小编辑器;刻意不内建可视化设计器与智能辅助。完整性三条:内建不可卸载(恢复分区不是默认分区);扩展视图里的批准回链内建审查(**审批者看到的 diff 不能经过被审批者提供的任何渲染器**);内建随内核版本化。

## 11. 五条铁律(README 表述 + 正典出处)

1. **AI-first、机械治理**(T15 supersede AI-optional):LLM 是 Assistant 的理解、对话、总结、比较、解释与规划主体；机械层承担事实、权限、裁决、确认、审计和重放。模型不可用时诚实失败且零副作用，人工 renderer 保持可用；不以 rule driver 复刻智能。历史正典的“AI 不承担正确性”保留为“LLM 输出不是业务真相、副作用必须机械裁决”，不再推导为无 AI 自动完成同一任务。
2. **binding-only**:模型只发引用不发内容——渲染器从实体缓存解引用,**字面意义上发不出一个数字**。(第十层:"模型只发引用,不发内容";交互层"选,不是画"。)
3. **交互必须 action 背书**:任何可点按钮必须绑定到已声明 action,提交经引擎裁决。(第十层:"装样子可以,骗点击不行"。)
4. **事实永不发明**:字段值来源必须声明(默认/查找/引出/效果产出/意图/起草+选择),agent 猜只对价值载体字段合法且过选择门。(第九层铁律其一,activation invariant `field-source-declared`。)
5. **审批不委托**:`approve` 永远 actor-is-human;审计渲染(事件流、机械 diff)路径零 AI。(A.4:"定义变更的裁决权不进入渐进信任的白名单——assistant 可以提议一切,批准权不可委托";第十层事件流"渲染路径零 AI"。)

GOAL 的自动化不变量:I1 真实 LLM 的 U1–U23 Story Eval 达标且生产无 rule fallback;I2 渲染 spec 解引用值与实体快照一致;I3 fuzz 可点元素必映射已声明 action;I4 agent 身份执行 approve 必被拒;I5 可重放;I6 拒绝留痕且可作下一步上下文;I7 模型故障诚实且零副作用、人工控制面可用。

## 12. 术语表

- **平面**:架构的三个层——业务(实例与流程)、定义(应用编辑自己的结构)、能力(与世界的边界)。
- **裁决**:引擎对每次 exec 的三层校验(声明→guard→schema);"裁决器就是并发控制"。
- **委托(principal/actor)**:权限主体始终是人(principal),行为者是人类会话或 assistant 角色(actor);OAuth RFC 8693 `act` claim。
- **背书**:交互元素必须由已声明 action 担保;引申"模型背书的能力"(提取类,产出是模型的承诺而非事实)。
- **Sidecar fastpath**:按 principal/policyScope/subject/intent/device 保存 binding-only 用户呈现版本；每次命中重新授权、校验依赖并解引用当前事实。它 supersede 历史 concern 凝固模型。
- **处境披露(situatedness)**:能力只在被实体 action 引用时出现,作用域从超媒体结构继承——对比 function-calling 的全局广播。
- **提议权**:真实世界对应用没有写权限只有提议权;人类填表、agent 动作、LLM 产出、时钟 tick 都是提议,过同一裁决器。
- **工件(artifact)**:能力的通用货币(file/text/document-pdf/table/image/embed),内容寻址、入日志、业务实体只存引用。
- **三扇门**:人类进环的三个理由——确认门(风险/动作级)、选择门(价值/字段级,AI 起草 N 草稿人选)、引出门(模糊/对话直到 schema 满足)。
- **信任线**:穿过三平面而非第四平面的一条线——主语是委托,确认是消息,信任是数据。
- **骨架**:不能委托给 AI 的五个 UI 面(主页态势简报/归位/事件流/收件箱/对话+画布),过四判据(零智能可用、永不遗漏、独立于被审计者、空间锚点)。
- **BIOS**:`_meta` 的内建 UI,修自己的扳手不能是自己造的零件;随内核发行、不入日志、保留路由不可劫持。
- **拒绝即数据**:被拒动作带原因入日志,回流为 agent 下一步决策上下文。
- **plan-exec**:一次决策输出整段计划,引擎单事务逐步模拟裁决,"批量裁决计划"而非信任计划。
- **钢与粉笔**:已实证 vs 仅论证;五条切片是"把粉笔换成钢的路径,不是下一版文档"。
- **市场不是雇佣**:业务拥有语义/状态/流程/裁决,能力拥有对世界的触达;`_meta` 注册表是交易柜台,复用率是附庸化的体温计。

---

**关键文件路径**:
- 正典:`/Users/mike/projs/playground/ui4A-v2/docs/UI4A-v2(重排版):界面作为合同,应用作为数据,能力作为边界.md`(注意全角标点文件名)
- 选型:`/Users/mike/projs/playground/ui4A-v2/docs/UI4A-技术选型.md`(§1.1 工具投影、§3 自写增量五项、§6 渲染词汇表与 A2UI 接线、§7 检索来源)
- 验收:`/Users/mike/projs/playground/ui4A-v2/GOAL.md`(B1–B4/S1–S5/I1–I7 + T15 U1–U23)
- 决策:`/Users/mike/projs/playground/ui4A-v2/DECISIONS.md`(D1 Next.js API 层、D2 PG 从第一天、D3 pnpm workspaces 布局、D4 temporal start-dev、D5 端口 3100、D6 docker 代理异常注记)
