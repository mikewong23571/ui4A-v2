# UI4A 技术选型：全部用社区轮子

> **历史选型调研。** 依赖选择仍有参考价值，但本文中的双 driver、rule fallback、render capability/tool-rendering 和 concern-key 缓存不是当前产品协议。现行实现以 `conductor/tech-stack.md`、T15 AI-first、T16 Presentation Recipe/User Sidecar 和 `DECISIONS.md` D27–D28 为准。

> 原则：架构概念映射到现成的、被社区认可的框架与组件；UI4A 的增量只留在**没人做过的那一层**（Siren 投影 + 三层裁决 + 平面组装）。
> 检索时间：2026-08。所有选型均验证过当前维护状态。

## 0. 总栈决定：TypeScript 全栈

demo 是 Clojure/ClojureScript，但按"不重造轮子"的原则，**主栈换 TypeScript**：

1. v1 第五层本来就指定了 XState——TS 原生；
2. demo 用 CLJC 做谓词共享，是因为 clj/cljs 是两个编译器；TS 全栈同语言，**共享是免费的**，比 CLJC 更彻底；
3. 设计的每一层在 TS 生态都有头等轮子（Temporal/Cedar/RJSF/AI SDK/shadcn），Clojure 生态没有对等物——留下意味着每层重新发明；
4. demo 的价值是验证过的架构，不是那两千行代码——协议层的经验 1:1 平移。

Clojure 路线注记：malli + re-frame 可行，但工作流引擎、策略语言、schema 表单、生成式 UI 四个关键位都无轮子，与选型原则冲突，不推荐。

## 1. 选型总表：架构概念 → 现成轮子

| UI4A 概念（文档层） | 选型 | 备选 | 理由与验证 |
|---|---|---|---|
| 流程真相源：状态机（第六层核心） | **XState v5** | — | v1 已指定。machine config 是纯 JSON 对象，`createMachine(config)` 运行时构造——**"定义即数据"字面成立**；state snapshot 可持久化（实例恢复）；Stately Studio 免费提供可视化编辑器 = BIOS 定义查看的现成形态 |
| 合同格式：超媒体实体 | **Siren**（media type） | HAL / JSON:API / JSON-LD | 2025–26 agent 浪潮重新发现超媒体；Siren 的 `actions`（method + href + fields）是"agent 要做事"的最佳格式——检索确认，社区共识与我们 v1 的判断一致 |
| schema 层与校验 | **JSON Schema (draft-07) + Ajv**；内部类型用 Zod | — | RJSF 直接吃 JSON Schema；Ajv 是事实标准校验器；合同格式必须是语言中立的 |
| 引擎 / API 承载 | **Next.js (App Router)** 的 API 层；或独立 Hono 服务 | Fastify | AI SDK 与 RSC 生成式 UI 原生集成；合同端点是普通 HTTP+JSON，框架无关 |
| 事件溯源（第三、六层） | **PostgreSQL append-only 表** | KurrentDB（原 EventStoreDB） | 检索确认：单主写几千 TPS 内足够；规模化再迁 Kurrent（原生流/订阅/投影）。demo 级起步甚至 SQLite |
| **能力平面：job/租约/超时/重试/补偿（第七层）** | **Temporal（TypeScript SDK）** | — | **吞掉了我们缺失的"附录 B 能力宿主协议"的全部设计**：认领、租约、心跳、幂等、重试策略、定时器、补偿——全是 Temporal 内建概念。官方有 "Building durable agents with Temporal and AI SDK" 指南，即我们要的组合 |
| 信任线：委托 scopes / 风险分级 / 确认策略（第八层） | **Cedar** | OPA/Rego、OpenFGA | 检索确认 2025–26 势头（AWS AVP 托管服务 + Firebase 生态采用）；**AWS 官方博客"多 agent AI 链的最小权限"用的正是 Cedar 三层策略模型——就是我们的场景**。策略即数据，可作 meta 实体存取 |
| 认证与委托链（第八层 principal/actor） | **Keycloak 26.2+** | Ory Hydra 2.3 | 检索确认：Keycloak 26.2（2025-04）将 **RFC 8693 Token Exchange 升为正式支持**——`act` claim 链（actor 代表 principal）就是信任线的现生实现，不用自己发 token |
| 确认通知（第一个 capability） | Temporal activity + Web Push / SMTP | Novu（规模化再考虑） | notify 就是一个 activity，重试/超时免费 |
| 哑表单：`:form` runner、meta BIOS 编辑器（第九、十层） | **RJSF（react-jsonschema-form）v6** | — | 检索确认活跃维护（rjsf-team 组织，v6.8）；JSON Schema 直接渲染表单；多主题（含 shadcn 风格适配）；**我们的 field-definition 就是它的输入** |
| UI 组件库（第十层骨架） | **shadcn/ui** | Radix（仍支持）/ Base UI | demo 的 app/ 已在用；2026-07 起 Base UI 为默认底层、Radix 全面支持；11.5 万星。骨架五面（主页/收件箱/事件流/归位/画布）全部用现成组件拼 |
| 聊天 + 生成式 UI（第九、十层） | **Vercel AI SDK 5 + assistant-ui** | — | AI SDK 5.0 的 generative UI 一等公民（tool-rendering / UI state）；assistant-ui 提供完整聊天组件（useChat、流式、工具、多步）；**`generateObject`/structured output 就是 clarify"chat 即函数"的现成机制** |
| 机械 diff（第十层 BIOS） | **deep-object-diff / TerminusDB JSON Diff & Patch** + react-diff-view 渲染 | — | 结构化 diff 库现成；diff 是纯数据 → 渲染零 AI，通道隔离铁律可执行 |
| 流程图渲染（组件词汇表之一） | **React Flow** | — | 节点图的事实标准组件；XState 图谱可直接喂 |
| LLM driver / rule driver | AI SDK `generateText/step` + 自定义 rule 循环 | — | 双 driver 架构不变；provider 无关 |

### 1.1 Agent 侧接口：tool 投影，不自造线协议

demo 用自定义 JSON 协议（prompt 描述 + 模型吐 JSON）是原型期捷径；生产形态用平台原生 tool calling 作传输，协议分两层：

1. **固定协议动词**（≈5 个，全应用通用）：`navigate(rel)` / `exec(action, params)` / `clarify(fields)` / `render(spec)` / `done(summary)`——合同端点的工具形态，小到一个常量；
2. **每状态动态生成的动作工具**：当前实体的 `actions[]` 逐个生成工具，字段 schema 内联进参数，guard 求值结果嵌进 description（"blocked: is-pending 失败"——拒绝即教育）；`navigate` 的 rel 参数从实体 `links` 生成枚举。**合法动作集就是工具列表——处境披露的 tool 形态，作用域自动继承**。

要点：HTTP 合同仍是唯一真相，tools 只是它的 LLM 投影（entity.actions → tool schemas 是几十行的生成器）；sitemap 静态前缀（system prompt）+ 动态工具列表 = 第四层缓存结构的工具版；chat 是介质不是工具，引出门走 structured output；同一合同可再包一层 **MCP server**（tool 格式即 MCP 原生格式），让外部 agent（Claude/Cursor）零成本操作应用。三个投影：renderer 给人、HTTP 给脚本、tools/MCP 给模型。

## 2. 被社区验证过的关键组合（不是我们自己拼的）

- **Temporal × AI SDK**：官方博客与课程（durable agents in TypeScript）；
- **assistant-ui × AI SDK**：官方集成文档（useChat、工具、持久化）；
- **RJSF × 主题库**：Material/Ant/Chakra/Fluent 官方主题，社区有 shadcn 适配；
- **Cedar × 多 agent 链**：AWS 安全博客的参考架构；
- **Keycloak × RFC 8693**：26.2 GA，文档齐备（含 impersonation vs delegation 语义辨析）；
- **XState machine-as-JSON × Stately**：机器定义可存储/可运行时构造/可视化。

## 3. 社区轮子吞掉了设计的哪些未完成章节

这是本次选型最大的收益——"距实现的距离"里第二档（还需设计）被大幅清空：

| 原设计缺口（闭环自审承认的粉笔） | 被谁吞掉 |
|---|---|
| 附录 B：能力宿主协议（认领/租约/幂等/超时/回流校验）——**整章未写** | **Temporal 全部内建** |
| 委托实体的"崩溃续跑/并行/超时" | **Temporal workflow 的 durable execution**——委托就是一个 workflow，事件历史就是轨迹，续跑是平台特性不是我们的代码 |
| 信任线的策略语言（scope DSL、风险分级规则） | **Cedar**——不用发明 DSL，策略文本可存可 diff 可审计 |
| actor/principal 的 token 链 | **Keycloak RFC 8693** |
| 哑渲染/最小编辑器/BIOS 表单 | **RJSF** |
| 生成式渲染的"模型→组件"通信 | **AI SDK tool-rendering** |
| 机器可视化（BIOS 定义查看） | **Stately / React Flow** |

**仍然要自己写的（UI4A 的真正增量，也是没人做过的）**：

1. **Siren 投影层**：rel → 实体（properties/actions/links/guard-results 的组装）——薄，但核心；
2. **三层裁决的 exec 端点**：动作声明 → Cedar 策略 + JSON Schema 校验 → XState 转移；
3. **效果词汇表**：set-field/transition/append/spawn 映射到 XState context 更新 + Temporal activity 启动——原"效果解释器"风险项收缩为一层薄映射；
4. **guard 注册表桥**：谓词求值结果（Ajv/自定义）投射进实体的 guard-results；
5. **meta 平面的 definition-lifecycle flow**：用 XState 写它自己（自举），激活 guard 调用结构校验（edge-targets-exist 等不变式，deep-diff 提供基础）。

## 4. 选型如何改写五条垂直切片（工作量重估）

| 切片 | 现在的构成 | 重估 |
|---|---|---|
| 确认门 | Cedar 风险策略 + guard 挂起语义（自写，薄）+ Temporal notify activity + RJSF 渲染 pending 实体 + assistant-ui 确认气泡 | 2–4 天 → **1–2 天** |
| 最小 meta | XState machine-as-JSON 存 Postgres + definition-lifecycle（XState 自举）+ 结构不变式 + deep-diff + RJSF/Stately 做 BIOS | 1–2 周 → **约 1 周** |
| 委托实体 | **Temporal workflow 即委托实体**：AI SDK driver 在 workflow 里跑，每步 exec 调引擎，事件历史即轨迹；并行=N 个 workflow；舰队页 = workflow 列表 + 收件箱组件 | 3–5 天 → **2–3 天**（续跑/超时/并行免费） |
| plan-exec | XState 批量解释 + 单事务裁决 | 2–3 天（不变） |
| 骨架与渲染 | shadcn 骨架五面 + AI SDK generative UI + React Flow + RJSF + 绑定式渲染器（自写，薄） | 1–2 周 → **约 1 周** |

**总量：demo 质量从 4–7 周压到约 2–4 周**，且最大的不确定项（宿主协议、效果解释器、委托持久化）全部从"要设计"变成"用平台"。

## 5. 架构一句话映射

> **XState 定义业务流（真相源），Postgres 存事件（日志），Siren 投影合同，Cedar 裁决权限，Keycloak 发委托，Temporal 跑能力和委托（durable），AI SDK + assistant-ui 聊天与生成式渲染，RJSF 做哑兜底，shadcn 拼骨架——UI4A 只写中间那层胶：投影、裁决、平面组装。**

## 6. 渲染词汇表：render capability 的组件清单

第十层的 render capability 需要**初始词汇表**——agent 可选的呈现方式，全部映射到现成组件。每个词条 = `{名字, 组件, 绑定 schema}`：组件是代码、被数据按名引用（与内核注册表同一模式）；绑定 schema 是该组件的输入契约，AI 只能发绑定引用、渲染器客户端解引用——**模型发不出数字**的剃刀由此落地。

| 词汇 | 组件（现成轮子） | 绑定 schema 要点 | 典型用途 |
|---|---|---|---|
| `table` | **TanStack Table** + shadcn Table | `{columns: [{field, label}], rows: entity-ref}` | 集合、列表、长表格 |
| `chart` | **shadcn Charts**（Recharts 3 封装） | `{kind: bar/line/area/pie, series, dimension}` | 趋势、比较 |
| `stat` | **Tremor** | `{metrics: [{label, value, delta}]}` | 态势简报（主页骨架） |
| `timeline` | **react-chrono** | `{events: entity-ref, ts/title/body 映射}` | 事件流、轨迹 |
| `flow` | **React Flow** | `{machine: flow-ref → nodes/edges}` | 流程图、状态机（BIOS 定义查看） |
| `form` | **RJSF** | `{schema: action.fields, data}` | 直接操作、哑兜底（`:form` runner） |
| `diff` | **deep-object-diff** + react-diff-view | `{before/after: version-ref}` | 机械 diff（BIOS、版本对比） |
| `kanban` | **dnd-kit** + shadcn Card | `{lanes, cards: entity-ref, laneField}` | 队列、审核、收件箱 |
| `markdown` | react-markdown / Streamdown | `{text: artifact-ref}` | 报告、agent 输出、正文 |
| `detail` | shadcn Sheet / Card | `{entity: entity-ref}` | 实体详情侧栏 |
| `calendar` | FullCalendar | `{events: entity-ref}` | 日程（后期加入） |
| `map` | MapLibre | `{points: entity-ref}` | 地理数据（后期加入） |

MVP 取前十个——骨架五面恰好全部覆盖：主页 = `stat` + `timeline`；收件箱 = `kanban`/`table`；事件流 = `timeline`；BIOS diff = `diff` + `flow`；画布 = 全词汇表。

**同一词汇表，两条使用路径**（runner 阶梯重演）：

1. **骨架路径（`:form`）**：骨架面静态绑定组件——事件流固定用 `timeline` 渲染、diff 固定用 `diff` 渲染，**选择是写死的，不经 AI**（审计通道隔离）；
2. **生成路径（`:ai`）**：画布上由 render capability 选择——经 AI SDK 的 **tool-rendering** 机制实现：每个词条注册为可渲染 tool，模型发出 `{component, bind}` 形态的 tool call,assistant-ui 渲染该 tool 调用;tool 的参数 schema 从词汇表注册表**自动生成**——词汇表更新，模型的选择空间随之更新，零 prompt 改动（与 sitemap 自动更新同一机制）。

按关注点凝固的渲染缓存 = `{concern-key → render spec}` 的持久化——首次生成，之后稳定，可分享（渲染说明是数据）。

检索依据：TanStack Table 是 [React 表格的事实标准](https://www.pkgpulse.com/guides/tanstack-table-vs-ag-grid-vs-react-data-grid-2026)（headless、社区口碑"godlike"，AG Grid 为企业级付费备选）；图表的 [2026 共识](https://www.pkgpulse.com/guides/recharts-v3-vs-tremor-vs-nivo-react-charting-2026)是 shadcn Charts(Recharts 3)+ 想要开箱即用仪表盘用 [Tremor](https://tremor.so/)；时间线 [react-chrono](https://dev.to/olga_tash/top-react-libraries-for-project-management-apps-you-need-to-know-5dg8) 是 go-to;拖拽/看板的标准是 [dnd-kit](https://dndkit.com/)。

### 6.1 渲染协议：采用 A2UI（Google, v0.9）

渲染层的**线上协议不自造**，采用 Google 的 A2UI（Agent to UI）协议：四种 JSON 消息（`createSurface` / `updateComponents` / `updateDataModel` / `deleteSurface`）、组件目录以 JSON URL 引用、数据与组件分离（组件按路径绑定数据、双向回写）、action 事件回传、传输无关（A2A / AG-UI，REST/WS/SSE 规划中）。渲染器生态：Lit / Angular / Flutter GenUI，React 经 CopilotKit。

**与 UI4A 的接线——A2UI 是渲染协议，合同是它下面缺的真相源**：

1. **词汇表身份转变**：上表的 data-viz 词条（TanStack/Recharts/Tremor/react-chrono/React Flow/dnd-kit…）注册为 **A2UI 自定义扩展目录**——基础目录只有布局原语，数据可视化词条由我们补；
2. **binding-only 剃刀的落实**：A2UI 默认允许 agent 直接 `updateDataModel` 写值（模型可以发数字）；我们改为**客户端渲染器拥有数据模型，agent 只发实体引用**，渲染器从实体缓存解引用——A2UI 机制支持这种用法，约束在我们侧强制；
3. **交互背书的落实**：A2UI 的 action 事件默认回传给 agent（对话回路）；我们改为**渲染器拦截 action、映射到实体上已声明的 action → exec 裁决**——合同外的按钮无法提交；
4. **骨架与 BIOS 不走生成路径**：事件流/diff/收件箱静态绑定组件（`:form` 路径），A2UI 只服务动态画布（`:ai` 路径）。

风险注记：v0.9 年轻、协议会演进；对冲是 Google 背书、AG-UI/A2A 生态、CopilotKit 的 React 支持。聊天内嵌渲染仍用 AI SDK tool-rendering，画布 surface 用 A2UI——两者传输无关，不冲突。

## 7. 检索来源

- XState：[官方文档](https://stately.ai/docs/xstate)、[xstate.js.org](https://xstate.js.org/)、[npm](https://www.npmjs.com/package/xstate)、[v5 持久化讨论](https://github.com/statelyai/xstate/discussions/4318)
- Temporal：[TS SDK](https://github.com/temporalio/sdk-typescript)、[durable execution 指南](https://learn.temporal.io/tutorials/typescript/background-check/durable-execution/)、[Temporal × AI SDK 构建 durable agents](https://temporal.io/blog/building-durable-agents-with-temporal-and-ai-sdk-by-vercel)、[事件历史](https://docs.temporal.io/encyclopedia/event-history/event-history-typescript)
- RJSF：[rjsf-team/react-jsonschema-form](https://github.com/rjsf-team/react-jsonschema-form)、[文档](https://rjsf-team.github.io/react-jsonschema-form/docs/)
- Cedar：[cedarpolicy.com](https://cedarpolicy.com/)、[AWS 多 agent 最小权限博客](https://aws.amazon.com/blogs/security/enforce-least-privilege-authorization-in-multi-agent-ai-chains-using-cedar/)、[Cedar/Rego/OpenFGA 对比](https://sph.sh/en/posts/policy-language-comparison-cedar-rego-openfga/)
- Keycloak：[26.2 Token Exchange GA](https://www.keycloak.org/2025/05/standard-token-exchange-kc-26-2)、[token exchange 文档](https://www.keycloak.org/securing-apps/token-exchange)、[Ory Hydra 2.3 讨论](https://github.com/ory/hydra/discussions/3359)、[2026 IdP 对比](https://www.pkgpulse.com/guides/logto-vs-ory-vs-keycloak-open-source-identity-providers-2026)
- AI SDK / assistant-ui：[generative UI 文档](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)、[v5 UI state](https://ai-sdk.dev/v5/docs/ai-sdk-rsc/generative-ui-state)、[assistant-ui × AI SDK 集成](https://www.assistant-ui.com/docs/integrations/frameworks/ai-sdk)
- 事件溯源：[Kurrent/EventStoreDB](https://www.kurrent.io/event-sourcing)、[PostgreSQL as event store](https://github.com/eugene-khyst/postgresql-event-sourcing)、[对比文章](https://www.event-sourcing.dev/postgresql-vs-eventstoredb/)
- 超媒体格式：[Siren 规范](https://github.com/kevinswiber/siren)、[HAL/Siren/JSON-LD 深度对比](https://zuplo.com/learning-center/a-deep-dive-into-alternative-data-formats-for-apis-hal-siren-and-json-ld)、[超媒体格式选择](https://sookocheff.com/post/api/on-choosing-a-hypermedia-format/)
- shadcn/ui：[2026-07 Base UI 默认](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)、[radix-ui 统一包](https://ui.shadcn.com/docs/changelog/2026-02-radix-ui)、[采用数据](https://www.shadcndeck.com/blog/rise-of-shadcn-ui-2026)
- JSON diff：[deep-object-diff](https://github.com/mattphillips/deep-object-diff)、[TerminusDB JSON Diff & Patch](https://terminusdb.org/docs/json-diff-and-patch/)
- A2UI：[A2UI × ADK 实践详解](https://atamel.dev/posts/2026/03-30_a2ui_with_adk/)、[ADK × AG-UI 集成（Google 开发者博客）](https://developers.googleblog.com/delight-users-by-combining-adk-agents-with-fancy-frontends-using-ag-ui/)、[CopilotKit × ADK 前端指南](https://webflow.copilotkit.ai/blog/build-a-frontend-for-your-adk-agents-with-ag-ui)；前身脉络：[Interactive Canvas（已归档，2023 下线）](https://developers.google.com/assistant/interactivecanvas)、[Google 生成式 UI 研究](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/)
