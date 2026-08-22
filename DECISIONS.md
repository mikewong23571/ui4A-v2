# DECISIONS — 决策记录

> 规则(见 GOAL.md):实现与文档冲突时,先在此记录分歧与决定,再动代码或文档。
> 本文件同时记录施工前定案的开放选项。

## D1 引擎 / API 承载:Next.js App Router API 层(2026-08-21)

- **背景**:`tech-stack.md` 待定项,备选独立 Hono 服务。
- **决定**:Next.js(App Router)API 层,单体承载 UI + 合同 API。
- **理由**:AI SDK 与 RSC 生成式 UI 原生集成;demo 单体最简;合同端点是普通 HTTP+JSON,框架无关,日后要拆服务不受此决定绑架。Temporal worker 作为独立进程(apps/worker)。
- **影响**:仓库形态见 D3。

## D2 事件存储:PostgreSQL(docker)从第一天起(2026-08-21)

- **背景**:`tech-stack.md` 待定项,备选 demo 级 SQLite 起步。
- **决定**:直接用 PostgreSQL(本地 docker 容器)。
- **理由**:GOAL 口径即 PostgreSQL;不变量 I5(可重放:从空库重放事件日志,实体状态 hash 一致)必须从第一天就在真实 PG 上验真,SQLite 起步会造出第二个要迁移的环境。本机 docker daemon 已确认可用(29.6.2)。
- **测试策略**:单元/集成测试连接 docker compose 提供的 PG(测试库,每轮清库重放);不引入 testcontainers 依赖,compose 固定端口简化 demo。

## D3 仓库形态:pnpm workspaces monorepo(2026-08-21)

- **背景**:选型文档未指定包管理与仓库布局。
- **决定**:pnpm workspaces(本机 pnpm 10.32.1 / node 24),布局:
  - `apps/web` — Next.js(UI + 合同 API 层);
  - `apps/worker` — Temporal worker 进程(T3 起使用,先立骨架);
  - `packages/shared` — 谓词、schema、词汇表等跨端共享(全栈同语言,谓词共享免费的前提)。
- **理由**:TS 全栈;引擎/投影/裁决等核心逻辑放 shared 或独立包,由 web 与 worker 共用;具体包边界在 T1 计划中细化,允许后续增包(如 `packages/engine`),增包不算变更本决定。

## D4 Temporal:本地 dev server(temporal CLI),不上 docker 镜像(2026-08-21)

- **背景**:Temporal 是 T3 起的运行依赖。
- **决定**:用 `temporal server start-dev`(brew 安装的 temporal CLI)作本地 dev server;compose 中不放 temporal 镜像。
- **理由**:start-dev 零配置、秒起、自带 UI;demo 质量目标下比 docker 镜像更省。生产化显式排除在范围外(GOAL.md)。

## D5 dev 端口固定 3100(2026-08-21)

- **背景**:端口 3000 被本机另一项目(ui4A v1 Vite dev server)长期占用,不可杀。
- **决定**:本项目 web dev server 一律 `PORT=3100`;Playwright webServer、E2E、curl 验证全部用 3100;文档(README quickstart、workflow.md 命令)统一写 `PORT=3100 pnpm dev`。

## D6 环境注记:Docker Desktop 代理异常(2026-08-21)

- **现象**:`docker pull` 全局挂起(Docker Desktop 内置代理 `http.docker.internal:3128` 上游不转发);容器内直连 registry 正常。
- **已做**:postgres:17-alpine 通过本地脚本经容器网络下载 blobs 组装 tar 后 `docker load` 注入;未改动用户 Docker Desktop 配置。
- **影响与预案**:后续需要拉镜像(如 Keycloak)时:优先在 Docker Desktop GUI 修正/关闭手动代理后重启;否则重复上述 load 方案,或改用 brew/发行 tarball 安装。编排 agent 在派发相关任务时必须把本注记写进 subagent prompt。

## D7 环境注记:GLM 端点行为(2026-08-21)

- 模型:缺省 `glm-4.7`(env `LLM_MODEL` 可覆盖);tool calling 工作正常。
- **`tool_choice: "required"` 在 GLM Chat Completion 端点挂起不响应**(90s+ 无返回)——必须用缺省 `auto`;已修复于 commit `004e3db`,后续任何 LLM 调用不得再传 required。
- `@ai-sdk/openai` 缺省走 Responses API,接 GLM 必须显式 `provider.chat()` 锁定 Chat Completions 协议。
- 推理模型每步决策 8–20s;agent 循环步数上限要考虑真实时延(当前 24 步)。

## D8 审计身份口径:T3 前为自报(2026-08-21)

- 事件日志的 actor/principal/channel 来自请求自报(exec/chat 端点无认证),在 T3 接入 Keycloak(RFC 8693 `act` 链)之前**不具强审计语义**;I5/I6 断言基于此口径成立。评审记录(T2 review Low #6)。


## D9 Keycloak 延后至 T5(2026-08-21)

- T3 确认门的 S1/I4 验收断言(actor/principal 入日志、approve 必 human)不依赖 token 基础设施(D8 自报口径已覆盖);Keycloak(RFC 8693 act 链)在 T5 委托实体切片真需要 principal 语义时接入(届时解 D6 镜像问题:brew/tarball 或修代理)。

## D10 Keycloak 不进入 DONE 验收面(2026-08-21,更新 D9)

- GOAL 范围边界明文:"生产化(多租户、部署硬化、压测、**真实 SSO 对接**)显式排除在外";B/S/I 六组验收无一断言 Keycloak。
- 信任线语义在引擎层已强制(actor-is-human、principal 委托链入日志[D8 自报口径]);S3 断言(并发裁决/崩溃续跑/N 路并行/舰队页)全部由 Temporal 承载,不需要 token 基础设施。
- 决定:T5 不装 Keycloak;若后续(用户要求或 T8 空间富余)做 token 交换演示,按 D6 预案(brew/tarball)单独立项。

## D11 发布向导循环化:publish 回 basic-info(T5 Phase C,2026-08-21)

- **背景(spec 与实现的缺口)**:T5 spec 验收 4 要求「发布×2 不同标题」委托并行**全部完成**;实测第二个发布目标必失败——`publish` 迁到 `done` 终态后单例向导(article-drafting:main)被消费,`flow:article-drafting` 别名指向的实例停在无动作节点,合同上不存在再次发布的路径(read-判-行 agent 无从续)。
- **决定**:`article-drafting` 的 `publish.to` 由 `done` 改为 **`basic-info`**(发布即回到起草起点,向导循环使用);`basic-info` 增补 `abandon`(放弃 → `done`)以保持「terminal 节点存在且从 initial 可达」的激活不变式(terminal-reachable 对修订后的定义仍过)。同步更新 6 处既有测试的机械期望(domain/flows、engine/service、bornversion、api/contract 单测 + e2e chat/s2)。
- **语义影响**:B1/I1/B4/kill 续跑的断言零改动(轨迹与 successes 不变);S2 仅机械期望更新(ready 节点动作面未动)。S3-并发/S3-并行的发布载体自此成立。

## D12 A2UI:用官方 SDK(@a2ui/react + @a2ui/web_core),不自实现薄协议层(2026-08-21,T7 Phase A)

- **背景**:T7 spec 架构决定 3——先查 npm 有无官方/A2UI 兼容 SDK,有则用,无则自实现薄协议层(四消息 createSurface/updateComponents/updateDataModel/deleteSurface + surface 管理器),结论无论有无都记 DECISIONS。
- **调研结论(2026-08-21,npm registry)**:**有官方 SDK**。`@a2ui/web_core`(0.10.6,Google a2ui-team,Apache-2.0,核心库:catalog/surface/组件树/数据模型,依赖 preact-signals/zod)与 `@a2ui/react`(0.10.2,React 渲染器,peer 同版 web_core);另有 `@a2ui/lit`/`@a2ui/angular` 渲染器与 `@a2ui-sdk/types`/`@a2ui-sdk/utils`。协议规范在 a2ui.org(v0.9 与 v1.0 并存;tech-stack 记的 v0.9,SDK 0.10.x 追新规范)。注意:npm 上古老的 `a2ui@1.0.7`(2016,Angular 2 组件库)与 A2UI 协议无关,勿装。自定义扩展目录是 A2UI 一等机制(catalog JSON:$id/catalogId[URI 稳定标识,不承诺运行时下载]+ components{词名: JSON Schema};createSurface 以 catalogId 引用,协商后 surface 生命周期内锁定)。
- **决定**:Phase B 画布接入用官方 SDK——`@a2ui/react`(渲染器)+ `@a2ui/web_core`(surface 管理/catalog 协商);**不自实现薄协议层**。词汇表注册表即 A2UI 自定义扩展目录:目录 JSON 与注册表同源,经 `/api/render/catalog` 提供,`catalogUrl` 以 URL 引用。
- **我方强制不因 SDK 改变**(spec 架构决定 3 的两条):a) agent 只发 updateComponents + 实体引用,不发 updateDataModel 数值——数据模型由渲染器从 /api/entity 拉取私有持有(updateDataModel 是渲染器内部操作);b) action 事件渲染器拦截 → 映射实体已声明 action → /api/exec 裁决(合同外按钮无法提交)。
- **安装时机与回退**:Phase A 只落注册表形状与目录端点骨架(词条组件 lazy 占位 + bindSchema),SDK 依赖在 Phase B 组件接入时安装(避免提前引依赖);若届时集成受阻(如 React 19/Next 16 兼容或目录协商缺口),回退自实现薄协议层(四消息 + surface 管理器,数据与组件分离、组件按路径绑定),并更新本决定。

## D13 chart/detail 词条:shadcn 未初始化,直接用 recharts + 极简样式(2026-08-21,T7 Phase B)

- **背景**:选型 §6 chart 词条 = shadcn Charts(Recharts 3 封装)、detail 词条 = shadcn Sheet/Card。实查 apps/web:shadcn 起手架**未初始化**(无 components.json、无 ui/ 组件源);T7 阶段补装 shadcn CLI 并初始化会引入一批本 track 用不到的组件与配置面,超出"骨架五面全用现成组件拼"的最小口径。
- **决定**:chart 词条直接用 **recharts**(shadcn Charts 的底层库,同为选型指定)/ detail 词条用**极简 tailwind 卡片**实现;均记为本偏差,不硬凑 shadcn 封装。
- **语义影响**:零——词条合同(bind schema/目录/渲染链)不变,仅组件实现层替换;日后初始化 shadcn 可平替(词条模块内部替换实现即可)。

## D14 词条依赖版本注记:Tremor 3 于 React 19(实测可用)、TanStack Table 锁 v8(2026-08-21,T7 Phase B)

- **Tremor(stat 词条)**:`@tremor/react@3.18.7` peer 声明 react ^18(项目 19.2.8)——pnpm 安装告警但**实测渲染通过**(jsdom 组件测试 + Metric/Card/Text)。样式经 globals.css `@source '../../node_modules/@tremor/react/dist'` 让 Tailwind v4 扫描库内类名生成。若后续真机出现 React 19 运行时问题,回退为极简统计卡(同 D13 口径)并更新本条。
- **TanStack Table(table 词条)**:v9(9.1.2)是 signal 化重写(useTable/table.Subscribe 新 API,经典 API 移入 `/legacy` 导出);**锁 `^8.21.3`**(useReactTable 稳定 API,社区文档完备)。选型只写"TanStack Table"未锁版本,v8 同为 TanStack Table。
- **A2UI SDK**:`@a2ui/react@0.10.2` + `@a2ui/web_core@0.10.6` 装机成功;peer zod ^3.25.76 与仓库 hoist 的 zod 4.4.3 告警——SDK 以自身依赖嵌套解析 zod 3.x,peer 告警为传递性噪音(pnpm 逐包解析),实测不影响使用。

## D15 终审跟进项(2026-08-21,T8 终审 review;H-1/M-1/M-2/M-4 已当场修复)

- **M-3(跟进)**:meta add-action 的 action-definition 载荷目前无深层 JSON Schema(多余键原样入定义,靠机械 diff 人工把关)。跟进方向:action-definition Ajv schema(白名单键 + additionalProperties:false)作为第七条激活不变式 `action-shape-valid`。属 arch-brief 洞 #1(meta 注入放大)的有界化,不阻塞 DONE。
- **L-1(跟进)**:事件日志模块(db/events)后续抽 packages/eventlog,消除 worker→web 跨 app 引用。
- **L-2(跟进)**:RenderSpec 形状(agent/web 两处)下沉 shared,消除运行时才发现的漂移。
- **L-3(注记)**:spawn 效果当前只产 spawn-requested 审计事件、无消费者(capability 沙箱后续接入时补)。
- **铁律 4 范围口径**:field-source-declared / work-product-selection-gated 两条 A.5 全集不变式不在 T4 种子六条内(计划内缺口,后续 track)。

## D16 shadcn/ui 设计基座落地;Tremor 与 react-chrono 计划退出;深色 = 媒体查询翻转(2026-08-21,T9 Phase A)

- **背景**:T7 按 D13 口径绕过 shadcn(chart 直接用 recharts、detail 用极简 tailwind 卡片),stat 词条用 Tremor(@source 扫描 dist 类名)、timeline 用 react-chrono。实测视觉质量与深色一致性不达标(工程工具风基座缺失,各页样式散装)。
- **决定**:apps/web 正式初始化 shadcn/ui(new-york 风格、CSS 变量版、Tailwind v4 CSS-first `@theme inline`):`components.json` + `cn()` + 十件基础组件(button/card/badge/table/separator/skeleton/scroll-area/collapsible/alert/tooltip)落 `src/components/ui/`;globals.css 定义全套语义令牌(中性灰基底 + 单一蓝色强调 + 小圆角)。**本条平替 D13 的偏差口径**:后续 Phase 词条实现层迁回 shadcn 封装(chart → shadcn Charts 风格封装、detail → Card/Sheet),词条合同(bind schema/目录 JSON/data-word 标注)不变,仅实现层替换。
- **Tremor / react-chrono 计划退出(Phase D 执行)**:stat 词条平替为 shadcn Card + 语义令牌、timeline 平替为自建列表/表格;届时删 `@tremor/react`、`react-chrono` 依赖与 i3/invariants 的 chrono 白名单口径。本 Phase 只删 globals.css 的 `@source '../../node_modules/@tremor/react/dist'` 行(stat 词条暂时失去部分样式,可接受),依赖保留至 Phase D。
- **深色策略**:`prefers-color-scheme` 媒体查询翻转 `:root` 语义令牌(demo 级,不引 next-themes,跟随系统);组件内 `dark:` 变体类(Tailwind v4 缺省即媒体查询)口径一致。
- **页面壳**:AppShell(sticky 顶栏 + 唯一 `<main>` 统一栅格 max-w-5xl)进 layout;SiteNav 上移顶栏(data-nav 六值不变);每页恰好一个 main(i3 fuzz 注入点)由壳提供。

## D17 聊天流式化 + chat-turn 留痕 + 三态工作台(2026-08-22,T9 Phase B)

- **背景**:T2 悬浮聊天为一次性 JSON(floating-chat 原注释「一次性 JSON,简单可靠;流式为加分项」),实测 LLM 回合分钟级无反馈(裸 `●`)、停止按钮 disabled、刷新丢会话。
- **决定**:
  - `runAgent` 增 `onStep` 回调,/api/chat inline 路径改 **SSE**(step 帧逐步投影 trail,final 帧收尾;render 短路/参数错误/delegated 仍一次性 JSON);
  - 新增 `chat-turn` 事件(kind 入 `LogEventKind`,fold no-op 纯留痕):inline 回合完成后直写日志(双写者模式同 worker),**聊天历史 = 日志投影**(`GET /api/chat/history?sessionId=`),服务端仍无会话态;delegated/render 回合不写(轨迹分别在舰队页/凝固事件);
  - LLM 调用加 60s `AbortSignal.timeout`(GLM 端点挂死折算 fail,B4 口径),客户端 120s 超时 + `onCancel` 真实中止;
  - 工作台三态:FAB → 右侧 sidebar(与主区分栏,AppShell 加 aside 槽,main 仍唯一)→ `/chat` 独立窗口(共享 sessionId + 历史投影)。
- **语义影响**:聊天消息文本口径(trailToMessages)不变;事件日志多一种纯审计 kind,I5 重放同构(fold 对 chat-turn 不改状态)。

## D18 画布词条接 A2UI 用一次性同步解析(binderless),不用响应式 generic binder(2026-08-22,T9 卡死修复)

- **背景**:实测 /canvas 任意二次状态变更(重新载入/唤起聊天)即主线程死循环(CDP 采样:TableWord renderWithHooksAgain 反复 + commitMutation/DeletionEffects 深递归)——官方 `createComponentImplementation` 的 GenericBinder 以 useSyncExternalStore 订阅数据模型,与词条内部 store 钩子(TanStack useReactTable 渲染期 setOptions)相互通知形成 render/commit 死循环;tab 切换黑屏同因。
- **决定**:词条实现改用 `createBinderlessComponentImplementation` + `dataContext.resolveDynamicValue` **渲染期一次性同步解析** {path}/{call} 绑定,不建订阅。依据:本站 surface 是静态投影——agent 不发 updateDataModel(spec 架构决定 3,数据模型渲染器私有),action 执行后整面 reload 重建,响应式绑定零消费方。
- **语义影响**:零——bind schema/目录协商/数据模型私有口径不变;词条组件仍零改动(目录层适配);画布 reload 行为不变。若未来引入 agent 增量更新数据模型,需重新评估响应式绑定(届时词条内 store 钩子需与 A2UI 订阅隔离)。

## D19 Application 实体与六点演进路线(2026-08-22,架构评审对话)

- **背景**:审查「meta 创建实体是否建立了渐进式披露/遍历图」发现:flow 内有显式图(FlowEdge + sitemap 投影,`packages/engine/src/sitemap.ts`),跨 flow 无声明式载体;「渐进式披露」在文档仅出现一次且无定义(机制实际由处境披露 situatedness 涌现承担:`siren.ts` 只投影当前节点动作面);发现层(sitemap flows 平铺)随「meta 服务个人工作流扩展」的产品定位会持续退化——agent 入口决策退化回 CLI 式能力堆叠(原始问题)。
- **决定**:
  1. **不做全局遍历图**——跨 flow 遍历保持超媒体涌现(links + 目标相关性纪律);flow 内状态机图已覆盖真实时序约束,全局图是双重真相且过度约束。
  2. **渐进式披露正名**:处境披露即本架构的渐进披露,术语表对齐,零代码;引入 application 后披露链完整为 application → flow → node → action,每层只披露下一层入口与意图。
  3. **引入 application 定义平面实体**:intent 字段是本体(一段话:这个应用解决什么),归组 flows;业务实例不重新归父(可达性经 flow 已有);不做站点分裂(同引擎同 HTTP 面,轻于 `_meta` 模式);经 meta 同一份合同与 lifecycle(draft→approve)编辑。既有 flow 归 default application。
  4. **版本哲学:定义显式、实例派生**。flow 版本机制已有(activation artifact sha256 + approve 沉淀 definition-versions,`packages/engine/src/meta.ts:423-463`),暴露成可读投影即可;application 版本 = manifest 锁成员 flow 版本(lockfile 模型);业务实例**不建版本表**,历史 = 事件日志投影(audit view)。
  5. **Archive = 状态迁移,不是删除**:定义侧用 deprecate/archive 动词(sitemap 与发现层排除、href 不死(resource-href-unique)、可 unarchive);实例侧走 field-definition `semantics` 保留 status 约定(投影默认过滤、显式查询可见),平台给约定不给机制;application archive 只摘发现层,成员 flow 深链不死。
  6. **人类默认暴露**:骨架级路由 `/app/<name>`,从描述符+投影渲染(intent、入口 flow、按 app 过滤的态势、scoped 到该 app 的 agent 入口);默认页形态由描述符 entry 字段声明(管理型 dashboard / 内容型内容优先)。原则:人类不可能提出不存在的问题——默认页让应用在人类感知里存在,尔后才有人与 agent 的应用内协作。
  7. **meta 可视化是 approval gate 的可用性前提**(approve 永需 actor-is-human:agent 设计的定义,人类看不懂就签不了字,自举循环断在人类身上):优先 flow 拓扑图(FlowEdge 数据现成)+ activation 结构 diff(definition-versions 前后对比);只读投影,编辑仍走合同动词,**不做拖拽式图形编辑**。
  8. **三层用户场景 = principal scope 默认值,不是三套 UI**:维护者 → meta scope(actor 类已有)、编排者 → app scope、访客 → public scope;三个内置 archetype,**不做通用 RBAC**;骑在 policy 实体(principal/scopes/confirmation/trust-ledger)上,处境披露按 actor 过滤动作面已工作。访客场景要求 sitemap/导航可按 app 收口(application 即发现边界)。
- **路线(依赖序)**:T1 application 实体 + sitemap 分组 + agent 两层发现 → T2 版本显式化 + archive → T3 `/app/<name>` 默认暴露 + scoped chat → T4 meta 可视化(拓扑图 + activation diff)→ T5 角色 archetype + scope 默认。
- **T1 spec 必须回答的开放问题**:membership 方向(app 持 flow 清单 vs flow 声明归属;单属还是多属);agent 工具面/导航枚举按 app scope 过滤的机械;default application 迁移口径。
- **明确缓做**:policy 按 app 收口、跨 app 共享/分发、访客身份认证(D8 自报口径延续)、application 级 activation 捆绑。

## D20 默认模型升级 glm-5.3(2026-08-22)

- 用户指示:缺省模型 glm-4.7 → **glm-5.3**(2026-08-14 发布并全量 GLM Coding Plan;同 coding endpoint、1M context、reasoning effort low/high/max 缺省 max)。改动:`DEFAULT_LLM_MODEL`(packages/agent/src/llm-driver.ts)+ llm-smoke/demo-checklist 注释;`LLM_MODEL` env 覆盖口径不变。
- 本条更新 D7 的缺省型号口径;D7 其余结论(`tool_choice` 必须 auto 不可 required、`provider.chat()` 锁 Chat Completions)继续有效——glm-5.3 的 tool calling 与 reasoning 流行为以 llm-smoke 实测复跑为准;reasoning effort 缺省 max,每步决策时延可能高于 D7 的 8–20s 口径,观测后校准。

## D21 激活不变式六项 → 七项:S2 e2e 精确名单断言机械适配(2026-08-22,T10 Phase A)

- **背景(spec 内部张力)**:T10 spec 架构决定 3 要求第七条不变式 `app-known` 且 checks 全量报告(checks 入 activation 实体与事件 detail);同 spec 红线「B1–B4/S1–S5/I1–I6 既有断言零改动」——两者对 e2e/s2.spec.ts 的 checks 精确名单断言(:383)与 UI 行数断言(:432,`toHaveCount(6)`)不可同时成立。
- **决定**:按 D11 先例(机械期望更新不算语义改动)处理:s2.spec.ts 名单断言加 `'app-known'`、行数 6→7、注释「六项」→「七项」;submit 链路语义(checks 全过 → pending-approval;fail → 回 draft 留痕)零改动。
- **过渡期语义**:application 表落库前(Phase B seed 完成前)`app-known` vacuous pass(检查在列表、恒过);Phase B seed 保证 `default` 恒激活后检查长牙。invariants.ts/effects.ts/meta.ts 三处注释已固化此口径。

## D22 GLM-5.3 探针实测结论(2026-08-22,T11 Phase A;校准 D7/D20)

- **实测环境**:glm-5.3 @ open.bigmodel.cn coding endpoint,ai@7.0.71 + @ai-sdk/openai@4.0.45,generateText×3 / streamText×3(e2e/glm-probe.spec.ts 门控)。
- **reasoning 暴露形态(新事实)**:@ai-sdk/openai chat 路径 SDK 层**完全不暴露** reasoning(`result.reasoning` 0 parts、fullStream 0 个 reasoning-* 部件,zod schema 剥离 `reasoning_content`);只能经原始 HTTP 层取——流式用 `includeRawChunks: true` 从 fullStream `raw` 部件解析 `delta.reasoning_content`(T11 Phase C 取数路线即此)。GLM 端点 reasoning **非增量、末尾齐发**(静默 4–9s 后与 tool call 同批到达)——thinking 帧语义 = 整段一次性「留痕回放」,不是实时打字机。
- **tool calling(auto)复验成立**:6/6 返回 tool call 且与 reasoning 同现;D7 的 `tool_choice` auto + `provider.chat()` 口径在 glm-5.3 继续有效。
- **时延校准(与 D7/D20 冲突点的裁决)**:小 prompt(615 tokens)简单步实测 4.2–8.5s,低于 D7 的 8–20s 下限;D20「effort max 时延上浮」未在该场景复现(effort 档位端点行为不可证实,SDK 不发 reasoning_effort)。裁决:**8–20s 作为上限口径保留**(大 prompt/长轨迹场景以 llm-smoke 为准),下限校准为「简单步 4–9s」;60s abort 兜底继续宽裕。

## D23 激活不变式第八条 capability-registered(2026-08-22,T13 Phase D)

- **背景**:arch-brief §10 A.5 种子集本含 `capability-registered`,T4 落地六项时未含;T13 引入 capability 定义面(draft/notify/clarify seed + capability-seeded 入日志 + snapshot.capabilities)后具备落地条件。
- **决定**:第八条 `capability-registered` 照抄 app-known(T10)模式——`DefinitionRegistries.capabilities?` 可选,未提供 vacuous pass(过渡期),提供时全部引用必须 ∈ 已注册集;submit 拒且留痕走既有 checks-fail 路径。**引用点口径**:field `source.kind='proposal'` 的 capability、effect `type='spawn'` 的 capability、field `'on-invalid'` 标记(定义是数据,枚举外取值由本检查兜底);`elicit.strategy` 是策略名非 capability 名,不算引用点。扫描面与 `apps/web/src/domain/capabilities.test.ts` 静态保证同源。
- **机械适配(D21 先例)**:e2e/s2.spec.ts checks 名单 + UI 行数 7→8。
- **归后续**:`capability-schema-compatible`(spawn bind 与能力输入 schema 相容)——需 input schema 真实化,随 capability 沙箱专项。

## D24 append 效果合并源实例字段(2026-08-22,T14 Phase A;变更引擎语义)

- **背景(walkthrough 问题 #5)**:`paramsToFields` 只取请求参数——向导前序步骤经 set-field 落在实例上的字段(category/tags)在 publish 的 append 时静默丢失(post:walkthrough 实证无 category),B1 e2e 无字段保真断言故一直绿。
- **决定**:append 的新实体字段 = **源实例 fields ∪ 请求参数(参数覆盖同名)**,每字段保留各自 origin(铁律 4 不破:值皆有出处);`fields` 白名单语义不变(从合并集取)。机制层正解:「向导收集 → 后续动作消费」的自然写法天然正确。
- **兼容**:I5 重放消费事件载荷/快照语义,引擎在线语义变更不改既有日志重放(重放测试验证);B1 e2e 补「发布文章 category/tags 与向导所填一致」断言(agent/human 两路)。

## D25 LLM 配置外置 + DeepSeek T15 baseline(2026-08-22,T15 Phase A)

- **方向**:T15 改为 AI-first。生产 Assistant 的 provider 不是代码默认值；统一由 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 三项完整 profile 提供。Web、Worker、render、probe 与 story Eval 复用同一解析器；缺项在网络前结构化失败。D20 的 glm-5.3 缺省模型与 D22 的端点观测保留为历史，但不再是 runtime fallback。
- **本地传播**:根级 gitignored `.env.local` 是 `pnpm dev:all` 的本地配置入口，provider-neutral loader 将外部环境优先地传给 Temporal、Worker 与 Web；`.env.example` 只含空占位符。普通 Vitest 显式使用空 profile，防止本机配置意外触发真实调用；真实 LLM 只由门控 Eval 显式开启。
- **首个 baseline**:`deepseek-v4-flash` @ `https://cpa.styleofwong.cn/v1`(OpenAI-compatible Chat Completions)。真实 probe generateText×3 / streamText×3 均成功，6/6 返回 `exec` tool call；非流式 2.8–4.3s，流式全程 3.8–6.4s。SDK reasoning parts 为 0，但原始响应/stream raw chunks 提供 `reasoning_content`；流式 reasoning 与 tool call 接近同批到达。该观测只校准通用取数，不引入 provider 特判。
- **密钥口径**:真实 key 只存在于外部环境或 gitignored 本地文件，不进入源码、提交、日志、Eval 报告或 git notes。
