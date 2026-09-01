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

- **历史观测，生产默认值已由 D25 废止**。当时测试 profile 使用 `glm-4.7`；当前 runtime 必须从外部完整 profile 读取模型，不得把本条型号当 fallback。
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

## D20 [历史，D25 已 supersede]曾用默认模型升级 glm-5.3(2026-08-22)

- **历史决定，已被 D25 supersede**。当时曾把代码默认模型从 glm-4.7 升至 glm-5.3；T15 已删除生产默认 endpoint/model/key，当前不得恢复 `DEFAULT_LLM_MODEL` 或任何隐式 provider fallback。
- D7/D20 的端点兼容与时延观测仍可作为历史探针证据，但不再定义部署配置。

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

- **方向**:T15 改为 AI-first。生产 Assistant 的 provider 不是代码默认值；统一由 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 三项完整 profile 提供。Web、Worker、render、probe 与 story Eval 复用同一解析器；缺项在网络前结构化失败。D20 的历史模型选择与 D22 的端点观测仅保留为探针记录，不再定义 runtime 配置。
- **本地传播**:根级 gitignored `.env.local` 是 `pnpm dev:all` 的本地配置入口，provider-neutral loader 将外部环境优先地传给 Temporal、Worker 与 Web；`.env.example` 只含空占位符。普通 Vitest 显式使用空 profile，防止本机配置意外触发真实调用；真实 LLM 只由门控 Eval 显式开启。
- **首个 baseline**:`deepseek-v4-flash` @ `https://cpa.styleofwong.cn/v1`(OpenAI-compatible Chat Completions)。真实 probe generateText×3 / streamText×3 均成功，6/6 返回 `exec` tool call；非流式 2.8–4.3s，流式全程 3.8–6.4s。SDK reasoning parts 为 0，但原始响应/stream raw chunks 提供 `reasoning_content`；流式 reasoning 与 tool call 接近同批到达。该观测只校准通用取数，不引入 provider 特判。
- **密钥口径**:真实 key 只存在于外部环境或 gitignored 本地文件，不进入源码、提交、日志、Eval 报告或 git notes。

## D26 T15 AI-first Assistant 边界与可解释副作用(2026-08-23)

- **生产智能主体**:default/auto 与显式 llm 都解析为真实 LLM。rule driver 退出产品公共面，只能从显式 testkit 子路径用于循环协议测试；缺少配置、端点失败或超时都返回可恢复失败，零业务副作用，renderer/审批/人工合同操作保持可用。
- **会话是真实日志的投影**:user/assistant 原话携带 role、session/turn、message id 与顺序 append-only 保存；下一轮同时消费有界近期原文和从日志重建的 `activeGoal`、focus、referents、constraints、pending clarification、authorized effects 与最近结果。结构化投影可修订，原话不可改写；刷新、重连和 delegated 恢复不依赖进程内 session 真相。
- **认知与能力分界**:读取当前 principal 已授权的合同事实，以及临时回答、总结、比较、解释，是 LLM 原生能力，不注册认知 action/capability。需要持久化、共享、重试、schema、成本或审计的模型输出才物化为 capability artifact；写回业务字段或改变状态必须另走 action、guard/schema 与必要确认。
- **effect authorization 与解释**:每次 agent `exec/exec-plan` 必须引用 append-only user `sourceMessageId` 和逐字 quote，并与目标 rel/action 对齐。成功事件保留 declaration、guards、schema、confirmation policy 与授权索引；human decision 和最终事件继续同链。执行解释只从事件投影生成，授权缺失或伪造时标记 `authorization-error`，不得补造理由。
- **正式模型工件**:外部 `LLM_MODEL` 在任何 action/spawn/artifact 业务事件写入前预检；缺项返回 503 且不产生半成品，禁止 `model: unconfigured`。provider profile 仍只有 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 三项外部部署数据，无供应商默认值。
- **验收纪律**:确定性测试只守权限、事实、授权、副作用、审计和重放；Assistant 动态用户故事必须使用配置的真实 LLM，scripted/mock 结果不能冒充语义能力证据。

## D27 T16 Presentation Plane、A2UI Surface 与用户级 Sidecar(2026-08-23)

- **平面边界**:Chat Agent 只发 versioned `PresentationRequest` 并消费
  `PresentationReceipt`，决定“是否呈现、呈现什么”；完整 catalog、Surface Tree、bindings、
  dependency DAG 和 hydration data 只进入独立 Presentation Plane。Chat answer 与
  Presentation planning 独立完成，展示失败不得改写已成立的 Chat outcome。
- **pure kernel 位置**:不新增 workspace package。serializable 协议放
  `packages/shared/src/presentation.ts`；纯 fold/validator/canonicalization/compiler/dependency/
  invalidation/patch-CAS 放 `packages/engine/src/presentation/`，但使用独立 export 与
  `PresentationSnapshot`，不得进入 Business fold/`EngineSnapshot`；PostgreSQL 与 Broker adapter
  分别位于 `apps/web/src/db/presentation.ts` 和 `apps/web/src/engine/presentation/`。
- **A2UI 边界**:持久化 UI4A 自有 normalized binding-only Surface Tree 与 dependency manifest，
  不持久化 SDK model 或 hydrated facts。运行时校验、重新授权、解引用后编译并 replay 新鲜
  A2UI v0.9 messages。SDK 没有 component delete、serializer 或独立 catalog version，因此
  catalog 以使用词条 schema 的内容 fingerprint 兼容；结构变化原子替换 Surface/子树。D18 的
  binderless 自定义词条在本 Track 先以受影响 Surface rebuild 保证正确性。
- **Recipe 生命周期**:Application/Flow 激活后由纯 Scenario Enumerator 按结构机械产生
  descriptor，再由独立 Presentation Agent 生成参数化 candidate Recipe。descriptor/Recipe
  禁止 principal、sessionId、用户偏好与 live facts；D28 删除摘要 capability/actions 后，
  `publishing@1` 当前机械清单为 13 个场景。
  candidate 只有通过 binding/catalog/dependency 校验才可作低优先级 fastpath；human-only
  promotion 产生 immutable promoted version，旧兼容版本继续服务，不兼容版本立即 stale。
- **Sidecar 真相与 fastpath**:仍以现有 append-only `events` 为唯一 durable truth，但
  Presentation event families 由独立 pure fold 重放，并服务于可删除重建的
  `presentation_user_sidecars` current projection。User Sidecar durable key 固定为
  `(principal, policyScope, subject, intent, deviceClass)`，没有 sessionId/turnId/route；Session
  只能持有 active receipt/pointer 和未提交 UI state。查找顺序为 user pinned → user cache →
  promoted Recipe → validated candidate → generic → runtime planner。
- **事件与并发**:`eventId` 保证单事件幂等，`commandId` 保证命令重试幂等；Sidecar version
  immutable，写入以 `baseVersion` CAS，回退只移动 active pointer。Presentation events 与派生投影
  可同事务提交；投影损坏由事件重建。Presentation 事件路由错误进入 Business fold 必须继续
  fail-closed，正确隔离时 Business Snapshot hash 字节不变。
- **依赖与层级**:fingerprint 区分值与结构。字段值、普通状态和集合 membership 走实时
  rehydrate；field/action schema、definition、catalog、policy 不兼容才 invalidate。Flow 使用稳定
  Shell + CurrentTask/Context/Output/History 子树，集合使用 shell + repeat/item Recipe，graph 父级
  只存 child reference/edge receipt，不复制子事实；完整新子树验证后才原子切 active pointer。
- **技术栈结论**:继续使用现有 PostgreSQL、`@a2ui/web_core@0.10.6` 与
  `@a2ui/react@0.10.2`，Phase A 未发现依赖或 runtime 选型偏差，因此无需先改
  `conductor/tech-stack.md`。
- **终审补充**:Application Recipe 不能只停留在 validator/内存 registry。live Broker 在
  User Sidecar miss 后必须先实例化 promoted/candidate Recipe，再进入 generic/planner；human
  promotion 事件保存去用户化 candidate，使新进程可重建共享 fastpath。否则“设为团队默认”只是
  装饰性交互，违反 S9/S27。

## D28 摘要保持 Assistant 原生认知，不进入应用工件模型(2026-08-23)

- **决定**:publishing Application 删除 `summarize` capability，以及 `generate-summary`、
  `save-summary` 两个文章 action。文章的“总结”始终由 Assistant 基于授权正文直接 `answer`。
- **边界**:当前应用不提供摘要持久化；用户要求保存、共享或写回摘要时，Assistant 诚实报告
  缺少对应 action/capability，零 artifact、零业务字段写入。未来若产品真的需要“文章摘要”字段，
  应先定义该业务字段及其写入治理，而不是把一次认知回答自动升级成通用工件。
- **UI 后果**:Entity/Canvas 不再显示“生成正式摘要工件”“保存正式摘要引用”及其参数表单。
  T15 U15/U16 的最新故事定义取代原先正式摘要工件实验；通用 artifact/capability 基础设施保留，
  但不再由摘要场景消费。

## D29 External Agent CLI 与 Governed Draft Ingress(2026-08-23,T17 Phase A)

- **协议边界**:`ui4a` 是 HTTP/Siren/meta 的 TypeScript/Node 参考客户端，不是第二协议，
  不含 LLM、prompt、业务关键词或 `improve` 黑盒命令。JSON envelope 固定
  `schemaVersion:1`，stdout 在 `--json` 下只含结果；诊断走 stderr；配置优先级为
  flag → `UI4A_*` env → XDG user config。命令退出码区分 usage/config/auth/not-found/
  judgment/conflict/network/protocol。
- **Draft 真相与存储**:Draft lifecycle 事件与 Business/Presentation 共用 append-only
  `events` 表，但使用独立 `draft` domain 和 pure fold；`draft_projection` 只是可删除重建的
  查询投影。payload 进入 immutable content-addressed `draft_payloads`，事件只存
  `sha256:<64hex>`；这避免每次 Flow revision 在日志重复整包，并保持 exact read 完整性校验。
  首期只收 JSON，canonical payload 上限 256 KiB、深度 32、节点 20,000、每 Draft 32 版、
  每 principal/scope 20 个非终态、同 scope 16 MiB，非终态 30 天后以事件过期。
- **SubmissionPolicy**:policy 随激活合同声明，最具体的 Entity/Action 可收紧父级；`none` 是
  吸收式拒绝，`direct` 只允许显式低风险 action 且仍需 schema/guard/授权；外部可写但未声明
  缺省 `draft`，衍生/聚合/审计/协议投影缺省 `none`。请求中的 actor/principal/mode 不能覆盖策略。
- **原子 apply**:首个 slice 只接受 `flow-definition` Draft。human approval 在同一 PG 事务内
  重新读取 core 日志、校验 base/current/registries，追加一个完整 validated change-set core event
  与 `draft-accepted` event；失败不提交任一事件。该事件必须能独立重放定义版本、审批 provenance
  与 active pointer，保证 birth version、sitemap bump 和失败零半激活。
- **身份边界**:T17 不引入 Keycloak。local demo 仍按 D8/D10 明示为 self-reported，CLI 禁止
  `--actor human`、`--principal admin`、`--no-draft`；服务端始终拒绝 Agent approval。生产 token
  verification 保留为部署 adapter，不把本地自报证据写成强认证。
- **可选 companion skill**:只在 CLI 合同稳定并通过独立 cwd smoke 后生成；skill 仅教授发现、
  修订、验证和安全顺序，产品/CLI 文档保持 agent-neutral，任何 Agent 不依赖该 skill 仍可使用。

## D30 Coding Capability Executor Host(2026-08-23,T18 Phase A)

- **本体边界**:`coding.execute` 是 effect capability；一次执行是独立
  `capability-run:<id>`，不是现有 Delegation。Delegation 继续表示 Assistant 经 UI4A contract
  操作应用；Capability Run 表示外部 executor 在授权 workspace 产出 artifact。Hermes 仅提供
  Runtime/Workspace/session/trajectory/双审批的架构启发，源码、依赖、配置与测试不得调用 Hermes。
- **Reference executor**:生产 reference adapter 使用 `@openai/codex-sdk@0.149.0`。真实 probe
  start 26.8s、resume 16.1s、SDK start 27.9s，均在 disposable Git repo 完成修改和测试；同一
  thread 可 resume。`codex exec --json` 仅作诊断/fixture。SDK structured final 仍从
  `agent_message.text` 二次 parse/schema validate；UI4A 自己汇总 normalized events/result。
- **Provider 失败与环境**:Claude Code 2.1.238 的 stream-json/session/permission/error 形状已 probe，
  但本机未登录，因此只作为 compatibility fixture，不冒充真实成功。Provider 缺失/未认证不得
  fallback。Codex 默认个人环境使微型任务输入约 93k tokens；生产必须使用专用受控 env/profile，
  不继承个人 plugins/skills。取消由 UI4A intent + child exit 合成，不能依赖 Provider terminal event。
- **Workspace ownership**:UI4A repository registry 以 stable ref 映射授权绝对路径/scope；请求只给
  ref/base。UI4A 创建唯一 branch/worktree、固定 base、allowed paths 与 lease，Provider 只收到已解析
  cwd。首切片保留 worktree 至 human decision，accept 只记 receipt，不 merge/push/deploy。
- **事件与载荷**:继续复用 `events`，新增独立 `capability` domain 和 pure fold；raw JSONL/stderr、
  result/patch/trajectory 使用 SHA-256 content-addressed payloads，projection 可删除重建。单 chunk
  64 KiB、单 Run 4 MiB/2000 events，超限摘要化并留 truncation receipt；Business hash 不变。
- **Temporal**:采用 prepare → execute/resume → finalize 三 activity workflow。execute 是 heartbeat/
  cancellation-aware 长 activity；重试从 Run projection 的 native session/workspace/cursor resume，
  不支持 resume 时记录 restart boundary 后重新观察 workspace。command/event/result 全部幂等。
- **Callback 与审批**:worker 通过受部署 secret 保护的 internal callback route 执行 source Flow 已声明
  `implementation-succeeded|failed` action，principal 为 `system:capability:<runId>`；guard 读取 principal
  fail-closed。Execution resource grant 与 human result accept/reject 是两条事件链，均不可委托给 Coding Agent。
- **激活与结果验真**:引用 executor capability 的 Flow 除 capability-registered 外，还必须通过
  `executor-profile-valid`（profile 存在且 class 匹配）；缺配置不能激活新版本。Provider 的 final
  tests/changedFiles 只是 claim，Run 结果只采用 UI4A 实际观察的命令 exit code 与 Git diff。人类
  accept 再做 base/path/hash/test CAS，并固定产生非 merge/deploy/activate receipt。

## D31 Specialized Agent Contracts(2026-08-23,T19 Phase A)

- **三层本体**:`CapabilityDefinition` 只表达 Application 要完成的业务工作；版本化
  `AgentDefinition` 表达专业 Prompt、Task/Result、Runtime features、Tool/Resource/Artifact/Eval
  policy；`RuntimeProfile` 是部署侧 Provider、环境和资源 backend。Application/任务不得选择
  Provider、endpoint、binary、credential 或扩大 profile grants。
- **特化与继承**:root Agent Definition 可独立存在；v1 只支持一个 exact-version parent，激活时
  flatten 为 immutable artifact。child 使用封闭 section replace allowlist 与 append-only unique
  Prompt blocks；拒绝 floating parent、arbitrary deep merge、mixins、缺父和 cycle。Run 固定 source/
  parent/flattened/prompt hashes，父定义后续升级不改变既有 child 或 Run。
- **Prompt 合同**:定义真相是 provider-neutral typed role/block/binding；动态 task/context 值占完整
  data block，以 schema pointer + JSON-delimited encoding 注入，不能进入 sealed system authority。
  拒绝 Mustache 字符串插值和 Provider-native template 作为持久化真相。Prompt 指导认知，不授予
  tool/resource/identity/approval；实际 provider-neutral messages 与实际发送 provenance 都要 hash。
- **Run 迁移**:不修改旧 `capability-run-*` 的 wire 语义，也不复制第二套永久 runtime。新增单一
  canonical Agent Run fold/projection：旧 T18 events 经 versioned legacy codec upcast，新 Run 写
  `agent-run-*` native events；旧 `capability-run:<id>` HTTP/Siren 与 `codingCapabilityWorkflow` 作为
  compatibility presenter/facade 保留。新 Run 固定 definition/prompt/runtime/task/result birth refs。
- **Specialization 边界**:CodingTask/CodingResult/Git worktree/test verifier 保留为 `coding-agent@1`
  adapter，不弱化成大量 optional generic fields。Writing Agent 复用同一 Agent Host、Codex streamed/
  structured transport 和 lifecycle，但使用独立 `document-workspace`、WritingBrief/WritingResult、
  source/citation/render verifiers。Writing 不需要新的 Provider transport。
- **Agent 创建 Agent**:Agent 可以起草 Prompt、schemas、runtime requirements、policies、examples 和
  Eval corpus，但结果只能进入 T17 Governed Draft；activation 需要全量 invariants、真实 Eval、
  mechanical authored/effective diff 和 human-only decision。Agent/system self-approval 永久拒绝。

## D32 Meta Human Control Plane(2026-08-23,T20 Phase A)

- **发现与路由**:`/_meta/.well-known/ui4a.json` 是人类控制台的入口真相；`/meta` 不再维护
  product rel 清单。canonical 人类深链为 `/meta/entity?rel=<encoded>&scope=<authorized>`，旧友好
  路由只保留兼容。Renderer 按 Siren class/shape 注册；冲突 fail-closed，未知合法实体走 generic
  collection/detail fallback。
- **Scope 口径**:URL scope 只是请求，服务端以 credential adapter 的 allowed scopes 重新求交并对
  sitemap/list/exact/exec 一致裁决。当前 demo 继续明示 D8/D10 的 self-reported identity，不冒充真实
  SSO；browser 不发送 principal/actor/authorization header，任意未知 scope 拒绝。
- **人类治理边界**:Application 保持只读；Agent Definition 与 Draft 只渲染当前 Siren actions。
  action 前重读 exact entity，internal callback/identity/scope 覆盖永不暴露。审批、diff、checks、Eval、
  provenance 和 replay 全部零 AI，Presentation Sidecar 不进入治理决定。
- **性能与增长**:collection 使用 embedded summary，禁止成员 N+1；exact tabs 共享 revision-aware cache。
  新 surface 自动进入 dashboard，特化体验只需 registry registration，不修改 shell/router。
- **技术栈**:复用 Next.js App Router、现有 shadcn/RJSF/React Flow/diff 组件和 Siren client；不增加
  package、state store、router、数据库表或事件族，因此无需改变 `conductor/tech-stack.md`。

## D33 Assistant 双焦点事实与 LLM 协议约束(2026-08-23,T21 Phase A)

- **三个位置概念**:`currentRel` 只表示本次 Agent 决策读取的合同实体，不再冒充客户端页面。
  系统独立保留最近成功 Agent navigation/Presentation 的 `lastNavigation`，以及当前 user message
  发送时某个客户端实际观察到的 `clientView`。两者携各自 provenance 同时进入 LLM；机械层不选择
  “更正确”的一个、不自动对齐，也不从冲突推导用户意图。
- **原子与重放**:`clientView` 作为可选字段与 user 原话同写一个不可变
  `chat-message-appended`；当前消息缺失就明确 unknown，不能沿用旧窗口观察或用最近导航猜测。
  成功 navigate 或 ready/fallback Presentation receipt 追加幂等 `chat-navigation-completed` core
  事件；失败/pending/superseded/exec refresh 不移动 `lastNavigation`。两项事实从同一 append-only log
  纯重建，Business fold/hash 不变。
- **客户端边界**:client instance 只在 hook 生命周期内稳定；每次发送同步读取真实
  `pathname + search`，仅从 `rel/focus/roots` 等协议参数机械解出 subject。客户端 route/subject
  不是授权事实，不能扩大 entity observation、tools、principal、action 或 effect authorization。
- **AI-first 决策**:合同 discovery 的 `resolveStartRel` 不被 client view 机械改写。LLM 同时看到
  contract location、`lastNavigation`、`clientView`，自主选择 answer/clarify/navigate/present；产品
  代码禁止按“看看/列表/详情”等关键词、正则、固定工具轨迹或 rule driver 复刻意图。
- **协议 envelope**:真实 `deepseek-v4-flash` disposable probe 证明 provider-native
  `toolChoice:'required'` 可用且未复现历史 GLM hang。生产每次 decision 使用 required；无调用、未知
  工具或非法参数最多进行一次相同事实/工具下的真实 LLM repair。拒绝文本永不由非 LLM 代码转换
  为 operation；第二次仍非法则诚实失败且零业务 mutation。
- **Presentation 顺序**:Chat answer 与 Presentation planning 继续独立。可用异步 receipt 必须先持久化
  completion 再对客户端可见；SSE 跟踪 jobs 到 settled，避免客户端已跳转而下一 turn 尚无可重放
  navigation。T21 不新增 package、数据库表、状态库或 Provider，因此不修改技术栈。

## D34 T22 生产形态、可信身份与双后端 Agent Runtime(2026-08-24,T22 Phase A)

- **范围与发布口径**：T22 同时交付 mothership K8s/Istio 与 Docker Compose all-in-one，两者消费
  同一配置语义、Git SHA、OCI digest 和核心用户故事 corpus。首个发布为
  `v0.1.0-experimental.1`，只声明已验证的内网实验范围；不声明 GA、SLA、LTS、多地域或当前
  两 Worker 集群具备 HA。
- **身份模式**：生产配置必须显式使用 OIDC，D8/D10 的 self-reported identity 只保留在显式本地
  demo mode。Keycloak 26.7.1 提供浏览器 Authorization Code + S256 PKCE、CLI/service Bearer 与
  confidential-client RFC 8693 Standard Token Exchange。请求 body/query/普通 header 不能覆盖
  actor、principal、scope 或 delegation。
- **委托事实**：live probe 证明 Standard Token Exchange 保留 human `sub` 和 Agent client
  `azp`；稳定输入记作 sub + azp。Keycloak experimental delegation 在 consent token 中产生
  `may_act`，但 exchange 后既没有 `act` 也没有 `may_act`。因此 UI4A 从已验证
  `sub + azp + scope/audience` 机械投影 canonical delegation/audit chain；不得宣称 Keycloak
  直接签发稳定 JWT `act`。可选 `may_act` 只属于显式 experimental profile。
- **授权分层**：Istio RequestAuthentication/AuthorizationPolicy 负责 issuer、signature、audience、
  Token presence、粗粒度 route/network policy。UI4A 应用层重新建立可信 request identity，并负责
  scope、delegation、human-only approval、Siren action、Cedar、guard、schema、CAS 和事件 provenance。
  Istio 放行永远不等于业务批准。
- **跨副本命令原子**：生产 Web 不再以进程内 Promise queue 作为唯一并发控制。所有写命令的
  refresh → declaration/guard/schema judgment → append → projection 在 PostgreSQL transaction 与
  transaction-scoped advisory lock 内完成；拒绝仍是事件。显式 versioned migration 使用独立锁和
  migration role，失败阻止 readiness。
- **状态拓扑**：mothership 实验形态采用一个 PostgreSQL 17 instance + static local PV，分别建立
  UI4A、Keycloak、Temporal default 与 Temporal visibility databases/roles。Temporal Server 1.31.2
  使用 namespace `ui4a`；官方 Helm chart 只部署 server components，数据库由 UI4A deployment
  提供。单实例通过命名备份和隔离恢复验真，不包装成 HA。
- **Agent Runtime**：新增 `apps/agent-runner`，同一 artifact 支持 K8s `oneshot` 与 trusted-host
  `daemon`。backend/profile/image/workspace/resources/network policy 全部由服务端 profile sealed；
  请求不能选择或覆盖。两个 backend 复用 canonical Agent Run、birth references、specialization
  verifier 和 human result decision；失败不得切换到更宽权限 backend。
- **真相与存储**：PostgreSQL event log 继续是唯一业务真相，Temporal history 是 durable execution
  history，Runner workspace 是受治理 artifact backend。Kubernetes state、container logs 和
  Keycloak sessions 都不成为第二业务真相。
- **仓库所有权**：UI4A 仓库拥有 generic images/config/Compose/chart/runbook；mothership-setup 只
  拥有 `deploy/ui4a/` overlay、集群路径和入口事实。两个仓库分别提交并在 evidence 中记录 SHA，
  不覆盖 mothership 已有 dirty/untracked 工作。

## D35 T22 v0.1 实验版收敛为单实例身份与部署主路径(2026-08-24)

- **覆盖关系**：本决定覆盖 D34 与原 T22 文档中“跨副本命令原子”、`act`/`may_act` 扩展、通用
  realm reconciliation 和可扩展副本形态作为 `v0.1.0-experimental.1` 发布门槛的部分；D34 的统一配置、可信凭证、
  双 Runtime、单一业务真相、仓库所有权和恢复边界继续有效。已完成的多副本、`act` 与 topology
  probe 只保留为历史可行性证据，不代表本版本承诺实现这些能力。
- **实验拓扑**：Compose 与 K8s 都以单个 Keycloak instance、单个 realm 和所有 stateful/UI4A
  workload 单副本作为验收形态，不声明 HA。两种部署消费相同 realm 文件、配置语义和镜像；
  PostgreSQL migration、readiness、重启和重放完整性仍是发布门槛。
- **最小身份面**：realm 只定义 `ui4a-web`、`ui4a-agent`、`ui4a-api` 三个 client。浏览器只实现
  Authorization Code + S256 PKCE；CLI 接受外部取得的 Bearer Token，不内建登录或 Token 管理；
  Agent 使用 Client Credentials 与 RFC 8693 Standard Token Exchange。canonical delegation
  只由已验证的 human `sub` 与 agent `azp` 构成，并受 audience/scope 限制；本版本不实现或要求
  `act`/嵌套 `act` 扩展。
- **最小 realm 生命周期**：首次启动仅在 realm 不存在时导入固定 realm 文件；realm 已存在时只
  做版本/client/redirect/audience 等兼容性检查并跳过。发现不兼容时 fail closed 并给出备份、
  人工替换或重建步骤，绝不在线修改、修复或 reconcile 已存在 realm。Compose 与 K8s 不维护两套
  bootstrap 实现。
- **认证验收边界**：Phase C 只要求 Golden Story 主路径及 CLI/Agent 合同端点建立可信 identity、
  human-only approval 和负向身份测试，并记录尚未纳入的 route/callback。全面 route 平台化和
  service-to-service OIDC 不阻塞实验版，但任何未覆盖入口不得宣称已受 OIDC 保护。
- **直接恢复**：根 CA/私钥、数据库和 realm 文件/数据采用命名文件与数据库级直接备份恢复，
  在隔离目标验真；不引入 secret manager、自动 rotation 或身份配置管理控制面。
- **明确延后**：多副本 Web/Session、跨副本 single atom、realm 在线升级、细粒度角色同步、自动
  Secret rotation、全面 service-to-service OIDC/全 route 认证平台化及 PostgreSQL/Temporal/
  Keycloak/storage HA 均延后到后续 Track，不阻塞 `v0.1.0-experimental.1`。

## D36 T22 K8s Agent Runtime 使用按 Run one-shot 拓扑(2026-08-24)

- **覆盖关系**：本决定澄清 D35“所有 stateful/UI4A workload 单副本”的 Runner 口径。K8s
  backend 的执行单元是每个 Run 恰好一个 one-shot Job/Pod；空闲时没有长期 Runner daemon、
  Deployment 或 Service。Runner image、ServiceAccount、workspace PVC、Worker RBAC 和服务端
  Runtime Profile 继续属于部署合同。
- **诚实 readiness**：K8s 模式的 Runner daemon 不接受 HTTP delivery，正确状态是
  `deliveryAvailable=false`。不得把仅存活的 daemon 冒充 Runtime ready，也不得用 `replicas: 0`
  隐藏一个无用途 workload。Phase H 验证长期服务、Worker delivery 配置/RBAC 和镜像 digest；
  Runtime 功能成功只由 U7 真实 per-Run Job 的 canonical result 证明。
- **Compose/Host 边界**：Compose container Runner 与可选 trusted-host Runner 仍使用受认证 daemon；
  本决定只删除 K8s 的冗余 idle daemon，不改变 Host backend、Runner artifact 或双后端等价语义。

## D37 v0.1.0-experimental.1 按现场证据作为已知风险内网实验发布(2026-08-25,T22 Phase J)

- **发布口径**：mothership K8s 已以 single-replica、non-HA 形态部署且可访问；认证、单 Web
  并发/重启/重放和十工件隔离恢复已现场验证。该事实不等于 T22 或任一 Phase 完成，也不产生
  GA、SLA、LTS 或 production-ready 声明；仓库不创建该版本 Git tag。
- **Runtime 证据**：最终 Compose 与 K8s U7 都以 `execute-failed` 诚实失败且没有 fallback；U8 与
  accept deferred。因此 Runtime matrix 固定为 `failed-honest`，不得提升为 passed。
- **已知风险与延后项**：最终镜像扫描为 50 Critical、241 High matches，作为 `known-risk` 只接受
  internal experiment。rollback 与 fault injection 未实测；不能从部署可访问推导升级/回滚或故障
  恢复已经验证。机器可读边界以 `release/v0.1.0-experimental.1/` bundle 为准。

## D38 生产人类浏览器路径可用性:scope 按 rel 归属选择、审计端点认证、401 跳登录(2026-08-25,T22 验证修复)

- **背景**：`v0.1.0-experimental.1` 现场实测发现 production profile 下人类浏览器路径不可用——
  未认证浏览器只有 401 静默失败而无登录引导；`/api/events` 不在 edge 白名单；浏览器不带
  scope 参数的请求落在 `development` 默认 scope，对 publishing/default 所属 rel 产生伪 403。
- **scope 按 rel 归属选择**：credential 模式下请求未显式携带 `scope`/`policyScope` 时，服务端在
  已授予且与 `authorizedPolicyScopes` 求交后的 scope 列表中，按顺序选择第一个覆盖目标 rel 的
  scope（覆盖判定 = rel 归属 Application 未知或包含该 scope；`/api/exec-plan` 要求一个 scope 覆盖
  计划全部 rel）。无覆盖时回退既有 default/granted[0] 行为，下游照常 403。显式 scope 参数语义
  完全不变。该选择不扩大授权：仍要求已授予 scope 覆盖该 rel，只消除伪 403。
- **`/api/events` 接入认证面**：production profile 下该审计端点经 `resolveTrustedRequestIdentity`
  建立 credential identity（Browser Session 或 Bearer，`ui4a:read`），principal 过滤不得超出
  credential（不等 → 403），无过滤时保持返回全部的审计语义，不做 rel scope 断言；local profile
  行为不变。Istio AuthorizationPolicy 与 Compose Caddy 的 GET 白名单同步加入 `/api/events`。
- **401 统一跳登录**：浏览器端对认证类 401 错误码（`credential_*` 与 `session_*` 失效族）统一
  跳转 `/auth/login?returnTo=<当前路径>`（returnTo 仍经服务端同源校验）；403/`scope_insufficient`
  不跳转——凭证有效而授权不足时登录无意义。接入点为合同客户端（entity/exec 读写）、sitemap
  version 取数与首页时间线取数，不发明旁路逻辑。

## D39 删除 legacy Capability Run 子系统,canonical Agent Run 成唯一执行路径(2026-08-25,T23 Phase B)

- **决定**：删除全部 T18 兼容层与 legacy Capability Run 子系统（事件双读、mixed 投影、
  `capability-run:*` Siren 资源、`codingCapabilityWorkflow`、`/api/internal/capability-callback`
  与 sitemap `capability-runs` surface)——项目未发布，窗口内允许合同收窄，不保留双路径。
- **理由**：未发布软件无需为从未进入生产的内部兼容面永久付双写者/双投影/双部署合同成本。
- **边界**：事件日志 append-only 语义与已存事件 payload 格式不变；callback token 机制
  (`UI4A_CAPABILITY_CALLBACK_TOKEN`)保留，继续服务 canonical `/api/internal/agent-run-callback`。

## D40 T23 大小基线中 T22 在途文件的延迟处置(2026-08-25,T23 Phase D)

- **决定**:`size-baseline.json` 保留 4 个 T22 在途条目(`apps/web/src/app/api/chat/route.ts`、
  `scripts/t22/` 目录及其中两个 >800 行的合同测试),带 note 标注归属;T23 不拆分,T22 关闭时
  由该 track 按 GR3/GR5 自行清偿并清空基线。
- **理由**:T22 正在这些文件上活跃提交,并行拆分必然冲突;治理门禁(新增违规失败、基线只许
  缩短)对它们同样生效,延迟不等于豁免。
- **边界**:除这 4 条外 T23 验收要求 size-baseline 为空;`pnpm governance:strict` 在 T22 关闭
  前不纳入 `pnpm check`(strict 会因这 4 条失败),默认模式即刻生效。

## D41 Assistant 分层披露与事实起点(2026-08-26,T25 Phase A)

- **覆盖关系**:本决定 supersede D33“合同 discovery 的 `resolveStartRel` 不被 client view 机械
  改写”这一句。`resolveStartRel` 删除后，起点固定为 T29 Situation 的 string focus → 当前
  `ApplicationDefinition.entry` → 站点兜底（business `articles` / meta `meta/flows`）；selection
  focus 跳过。整条链只消费结构化事实或约定入口，禁止词级猜测和可达性预探测。
- **D33 保留边界**:D33 的双焦点三个位置、原子写入与纯重放、AI-first 决策和 provider-native
  协议 envelope 等其余约束全部不变；事实起点只决定首次合同读取位置，不替代 LLM 对
  answer/clarify/navigate/present 的自主选择，也不扩大授权或副作用许可。
- **披露与公开合同**:scoped disclosure 只发生在内嵌 Assistant prompt 层，绝不窄化公开
  HTTP/Siren discovery 合同；`/.well-known/ui4a.json`、`/api/entity` 及 canonical meta discovery
  继续作为 CLI、外部 Agent 和脚本的完整发现面。
- **显式委托上下文**:delegated 路径的 scope 与 startRel 由派发侧显式传入；显式值是正典，
  presence 只作辅助，不得在 worker 内通过自然语言、标题或隐式漫游重新推断。
- **同源切片与预算**:inline 与 delegated 必须消费同一机械披露切片；能力 schema 在 prompt 中
  按 rel 引用、按需导航读取，不广播全文。每次 decide 的 prompt wire budget 固定为 32 KiB，
  包含 tools 投影；超限视为披露层缺陷，不以窄化公开合同规避。

## D42 Assistant Tool Choice 实验调整为 auto(2026-08-26,T25 Phase D)

- **覆盖关系**:本决定暂时 supersede D33“生产每次 decision 使用 required”。当前 NewAPI 上
  `deepseek-v4-flash` 的 thinking mode 对 Chat Completions `tool_choice: required` 返回 HTTP 400，
  而 `auto` 实测可产生工具调用；生产 driver 因此统一发送 `toolChoice: 'auto'` 以完成真实模型验收。
- **失败边界不变**:模型输出普通文本时仍判为协议失败，只允许一次相同事实与工具下的真实 LLM
  repair；第二次仍未调用工具则诚实失败且零业务 mutation。产品代码不把文本转换为 operation，
  请求端也不能选择 provider、model 或 tool choice。
- **实验口径**:接受 auto 带来的额外 repair、延迟与失败率；后续以真实 LLM gate 证据决定是否迁移
  Responses API 或恢复 required，不在本决定中引入 provider 特判或 fallback。
- **TODO(D42)**:另立后续 Track 验证 DeepSeek Responses API 的 reasoning/tool item 多轮回传，目标是
  在不引入请求端 provider override 的前提下恢复 wire-level `tool_choice: required` 保证。

## D43 Assistant SSE terminated 的同决策有界恢复(2026-08-26,T25 Phase D)

- **观测与决定**:真实 DeepSeek gate 三次出现错误消息严格为 `terminated` 的 SSE 断流；driver 对该
  已观测错误在相同 context/messages/tools 下最多尝试三次，不扩大到未观测的错误分类。成功工具
  envelope 仍须完整聚合并校验后才进入 Agent loop，因此断流重试不重复业务 mutation。
- **失败边界**:连续三次 `terminated` 后仍返回原样诚实失败；401、其他网络错误、协议 repair 与
  非法模型输出保持既有语义。重试选择与次数由服务端固定，请求不能覆盖。
- **时限**:单次流的硬总时限由 60 秒调整为 300 秒，避免 thinking 长 SSE 被过早终止；Agent 步数、
  Chat/Workflow 外层 deadline 继续提供整体有界性。本决定不引入新的 provider 或 fallback 路径。

## D44 Work Thread 是 principal-owned 的显式引用投影(2026-08-26,T26 Phase A)

- **成员资格主规则**:`threads#create` 与 `thread:<id>` 的 `attach`/`detach` 动作产生
  `thread-created`、`thread-reference-attached`、`thread-reference-detached` core 事件；fold 只消费
  这些事件中的显式 `threadId + category + rel`，不按实体类型、Application、chat session、goal 文本、
  rel 图或 presence 自动扩张。`category` 是封闭的通用投影角色(`context`、`active`、`approval`、
  `event`)，不是业务类型分支。既有 exec/goal 不统一增设 thread 字段；应用若要在同一业务命令中
  锚定，可显式追加同形 thread 事件，但 v1 正典仍是线资源动作。否决 turn 继承和 session 聚合：它们
  让 CLI 工作落在线外；否决 rel 图自动扩张：它既不可治理又会跨授权边界蔓延。
- **生命周期与标识**:只允许显式 `create/pause/resume/complete/archive` 转移；首次 attach 不隐式建线，
  未创建或已归档线的写入 fail-closed。状态为 `open | paused | completed | archived`，完成与归档不删除，
  审计链接永久可读。调用方提交 1–64 字符、匹配 `[a-z0-9][a-z0-9._-]*` 的全局 thread id；事件同时
  固定非空 owner principal，所有后续命令必须同 owner。线跨 session，任何 key、成员或动作都不含
  sessionId。否决首次引用即创建和 session key：前者隐藏生命周期，后者刷新即断线。
- **跨 scope 与授权**:`rel` 按现有 canonical 字符串原样保存，business/meta 前缀就是平面边界，
  不发明第二套 URI。`threads`/`thread:*` 是 Application-agnostic business resources，不新增伪
  Application 或第七个 policy scope；任一已授予 business policy scope 可发现入口，但 exact/list/exec
  必须按可信 principal 校验 owner。credentialed 读取只展示当前 policy scope 可覆盖的成员引用，
  切 scope 是同一条线的另一授权镜头；不得因线跨域而扩大目标 rel 的读取或动作权限。否决归入
  `default`（错误单属）、专门 `work` Application scope（把工作单位重新伪装成应用）和只靠 scope
  不验 owner（跨用户泄漏）。Sidecar 仍保留自身 policyScope 维度；未来以 thread subject 命中时也
  每次重授权，不把线提升为授权主体。
- **收编而非复制**:ThreadSnapshot 只保存 goal 原文及来源引用、owner、lifecycle 与分类 rel 集；
  flow instance、Agent Run、delegation、confirmation、Draft 和 chat message 的内容/状态继续由各自
  事件族与投影拥有。Siren thread 视图可在同一 EngineSnapshot 上把引用解析成当前状态指针和 links，
  这是纯投影组合，不写回副本、不查询第二存储；不可解析引用保留为可审计 dangling ref。`event`
  类成员使用 `event:<seq>` 显式索引且只保留最近 50 项。产品术语固定为 Work Thread；Conductor Track
  只是仓库施工单位，二者无运行时映射。
- **presence/chat 边界**:T29 `presence-thread-changed` 原样复用为“用户当前看哪条线”的辅助事实；
  presence 可为 chat 请求选择默认 thread id，但持久成员变化必须另写显式 thread core 事件，且事件
  记录 resolved thread id 与来源。不得把同一 turn 的后续副作用自动继承到线。删除整个 chat 子系统后，
  CLI 仍能经 Siren 动作建线、挂载、查态、审计并从空库重放，Work Thread 合同必须完整成立。
- **裁决与事件边界**:线资源动作复用 declaration → guard → schema 的纯裁决顺序和统一拒绝留痕；
  thread 事件 detail 在共享合同入口做字段白名单、长度与数量上界校验。事件日志仍是唯一业务真相，
  `EngineSnapshot.threads` 只是可删除重建的 fold 表；web 只做可信身份、串行 append 与 HTTP 适配。

## D45 Presentation 组合以虚主体声明退化到同一台 Surface 机器(2026-08-26,T30 Phase A)

1. **虚主体 wire 表示**:候选是保留字 rel 形字符串 `workspace:<id>`、新增结构化
   `RenderSubject` variant `{compose:<id>}`，或复用 `{selection:string[]}`。采纳字符串，其中 `<id>`
   必须为 1–64 字符并匹配 `[a-z0-9][a-z0-9._-]*`；`RenderSubject`、Sidecar JSONB、fingerprint 与
   thin request wire 均保持现形，既有禁键清单不变。`workspace:` 只由 Presentation Broker 解析到
   已注册声明；它不进业务 sitemap，`/api/entity` 对它保持 404，不能 exec、没有业务 actions，也不
   产生 core 事件。否决新 variant：它只为路由同一份声明增加 shared/parser/chat/tool 全链路形状；
   否决 selection：selection 表达临时 rel 集，没有区域、intent 或声明版本，必然把聚合规则散回
   调用方并形成第二真相。未知或非法 `workspace:` id fail-closed，不能回退为业务 rel。

2. **区域声明归属**:候选是内建 typed registry、Application bundle 贡献，或定义平面的
   `CompositionDefinition` artifact。采纳内建、严格解析、版本化的纯数据 registry：平台中立的声明
   类型与 parser 放 shared，纯组合语义放 engine，首个 app-neutral `my-work` 声明数据及 web 查找接线
   放 Presentation adapter；声明固定为 `id + version + regions[{region,source,intent,mode}]`，字段
   白名单、有界，`region` 唯一，引擎只遍历数据，禁止按区域、实体类型或 Application 分支。声明的
   canonical fingerprint 作为 `definition` dependency；同 id 内容变化必须换 version。否决 bundle：
   `my-work` 聚合 inbox/delegations/threads，错误归属于任一 Application；bundle 贡献应用级 workspace
   留待后续。否决本 Track 直接引入定义 artifact：目标方向正确，但会额外引入 Draft/activation/
   migration 生命周期。也明确否决 React props 中声明区域以及 service 函数内硬编码聚合规则；registry
   形状保持 meta-ready，后续治理迁移不得改变消费语义。

3. **Surface 区域与退化形态**:候选是复用既有 `layout + slot`，或新增带 source/intent 的
   `region` node；单区域又可统一保留 wrapper 或省略 wrapper。采纳零新 node：每棵 Surface 的 root
   都是 layout，每个声明区域是一个命名 slot，slot child 是该区域经既有 generic/Recipe planner 产生
   的子树；source/intent 在规划期消费，树内只留 binding subject、dependencies 与 provenance，机制
   说明进入 explain/why 抽屉。单主体也构造成一个 region=`subject` 的声明并产出
   `layout → slot(subject) → subtree`，不保留旧规划旁路；旧 node id/fixture 按 GR2 一次性迁移。
   单主体 surface id 仍为 `presentation-<subject>`，组合主体按同一 URL 编码规则生成，compiler 的
   `root`/`node:<id>` 约定保持确定。否决 `region` node：它迫使 node union、walker、validator、patch
   与 compiler 全部分叉；否决省略单区域 wrapper：它制造两种树形并让后续 walker 隐式识别组合。

4. **Sidecar key、Recipe slot 与 promotion**:候选 promotion 粒度是每区域一个 slot，或每个实时源
   实体一个 slot。采纳每区域一个稳定 slot：Sidecar key 的 subject 为 `workspace:<id>`，key.intent
   仍是一个组合 intent；区域 intent 只在声明中，不进入 key。`ApplicationRecipeKey.subjectShape` 按
   `composition:<declaration-id>@<version>[<region>:<kind>,...]` canonical 化，区域顺序取声明顺序且
   不含 principal、live rel 成员或事实值；单主体使用同算法的单个 `subject` 区域。Recipe slots 与
   区域一一对应，name 精确等于合法 region id，kind 取源合同形状，集合源首次实际产出
   `collection`；模板中所有该区域 subject 引用统一写作 `$slot:<region>`，`$slot:` 只允许出现在
   Recipe template，不得出现在请求、已实例化 Surface 或事件事实中。promotion/resolve 按完整有序
   slot `{name,kind}` 形状参数化和匹配，不再判断 `slots.length===1`；机械 diff 列出全部 slots，human
   promotion 边界不变。否决每源实体一个 slot：成员数量是实时事实，会令 Recipe key、promotion 与
   membership 漂移一起爆裂，并复制集合已有 repeat/item 语义。

5. **逐源授权、降级与失效**:候选是任一源不可见即整请求失败、静默省略该区域，或保留区域并放置
   diagnostic。采纳逐区域 fresh `getEntity` 重授权，并在每次 pinned/cache/Recipe 命中及重新规划时
   执行；请求、Sidecar 或声明均不授予权限。部分源在当前 credential policy scope 不可覆盖时，保留
   对应 slot，仅放无 binding、无目标 rel、无 policy 细节的 `diagnostic`，code 固定为
   `region-unavailable`；receipt 仍为 `ready` 且 reasonCode 为 `partial-authorization`。至少一个区域
   可见才允许 ready；全部区域不可见时整请求 `failed`，reasonCode 沿用 `authorization-failed`，且不
   生成可复用 Sidecar。否决单源失败拖垮整体：组合会因最小权限镜头失去其余合法价值；否决静默
   缺席：用户和审计无法区分空集合与无权查看。收据/diagnostic 只披露声明中的区域名和上述固定码，
   不披露被拒源 rel、存在性、成员数或拒绝细节。

   依赖是所有成功授权区域源的 `entity-contract`，集合源另加 `collection-membership`，再并入声明
   fingerprint 的 `definition`、catalog 与 policy；未授权区域只受 declaration/catalog/policy 约束，
   不把不可见源 fingerprint 写入客户端可见解释。membership 或值漂移按 `rehydrate` 实时解引用，
   entity contract 形状、声明、catalog 或 policy 不兼容按 `invalidate` stale 后重规划；声明的 region
   `mode` 只能在这两种既有语义中选择。任一 dependency 变化都必须重新逐源授权，再按其 mode
   rehydrate 或 invalidate，绝不复用旧授权事实。该降级只影响 Presentation，D41 的公开 HTTP/Siren
   合同和 D27 的 binding-only、用户级 Sidecar、独立 Presentation replay 边界均不改变。

## D46 Workstation 站点、首页、处境与跨站桥(2026-08-26,T27 Phase A)

1. **首页落地形态**:候选是(a)`/` 内嵌从 `canvas-body.tsx` 提炼的共享
   Sidecar 单树宿主，固定 subject=`workspace:my-work`；(b)`/` 重定向
   `/canvas?focus=workspace:my-work`；(c)为首页另造一套宿主。约束是 D45 的
   单一 Presentation 机器、内容面 binding-only、首页零区域/实体/应用 React
   特判以及 GR2 一次性迁移；壳、标题、导航、处境常显与 Chat 仍是舞台机械。
   **采纳(a)**:`/` 保留独立的“家”语义，与 `/canvas` 共用同一条
   `POST /api/presentation` → Sidecar → hydrate → action gate → 单树渲染链。
   **否决(b)**:首页语义被绑到 Canvas 调试/共同注视 URL，“家”没有自己的门；
   **否决(c)**:会复制取数、授权、水化与 action gate，形成第二条渲染真相。

2. **处境常显与显式声明**:常显项固定为 site/scope/thread/focus。数据源
   候选是(a)复用 `presenceObservationForLocation` 的当前客户端观察，与
   `PresenceReporter` 上报同源；(b)新增 GET situation 端点，把服务端装配结果回显。
   约束是处境仍只有 `assembleSituation` 一个服务端装配点，常显不得冒充授权
   裁决，不新增事件种类、端点、自然语言启发式或每实体类型分支。
   **采纳(a)**:常显语义明示为“你在 URL 中声明的处境”，不展示 granted
   scopes，也不在浏览器重算 Situation。切换 scope、进线、出线与跨站全部是
   URL 导航（`?scope=`/`?thread=`/`?focus=`）；PresenceReporter 自动留痕，Chat
   继续通过 clientView v2 消费同份观察。进线采纳通用链接规则：目标 rel
   为 `thread:<id>` 的导航统一携带 `?thread=<id>`；出线是常显条上删除
   `thread` 参数的显式导航。**否决(b)**:它增加往返和消费方，还会把含授权
   裁决的服务端装配暴露给不需要它的浏览器。否决壳级“设为当前工作线”
   作为第二套进线机制：链接本身已能同时完成进入与声明，另一个控件会产生
   两种时序和不一致处境。

3. **站点命名与 presence site 值域**:候选是保留 `{business,meta}`，或与人类
   站点语义对齐为 `{workstation,meta}`；raw 另有“第三站点”或“模式”两种定位。
   约束是 workstation=`/`、meta=`/meta` 的显式物理分隔，项目未发布且 GR2
   禁止新旧双路径，T28 才实现 raw 抽屉。**采纳 `{workstation,meta}`**，一次性
   替换 presence 推导、Situation defaults、起点链站点兜底及相关测试；raw
   不进入 site 值域。**否决 `business`**:它命名平面而不是人的工作场所，与
   已定三形态口径冲突；**否决 raw 作站点**:验钞灯只是随处可达的查看模式，
   不应拥有独立导航、presence 值或上下文起点。

4. **导航与零件表折叠**:候选是(a)顶栏按 workstation/meta 分区，收件箱、
   事件流、委托监控收进壳级“系统”区，保留全部原路由；(b)把这些零件
   折叠为首页内容区块。画布还有保留 workstation 顶级入口或只依赖 Chat
   present 跳转两个候选。约束是导航与系统区都属舞台机械，文案使用任务语言，
   所有新可点元素必须有 `data-nav`/`data-action`，raw 不得新增顶级入口。
   **采纳(a)，并保留画布为 workstation 顶级入口**:“我的事”与“共同注视”
   是人的主任务，meta 是显式越界的定义管理，系统区提供对底层队列/审计/执行的
   按需到达。**否决(b)**:它把舞台机械混入声明驱动的内容面，并复辟退役
   `home-body` 的硬编码页面。否决移除画布顶级入口：共同注视是协作核心，不应
   只有在 Chat 已成功规划呈现后才可达。

5. **跨站桥推导规则**:候选是(a)只使用 canonical rel 命名约定
   `flow:<name>` ↔ `meta/flow:<name>` 双向机械推导；(b)维护全局实例→定义映射表；
   (c)在 React 中按实体类型决定桥。约束是进入 meta 必须是显式意图，链接必须
   保留当前 scope，无可证明推导路径时诚实缺席，且不改 meta 治理视图内部。
   **采纳(a)并在 T27 同时落地双桥**:workstation 当前 focus 是
   `flow:<name>` 时显示“在 meta 中编辑此定义”，目标是
   `/meta/flow/<name>?scope=<scope>`；meta `meta/flow:<name>` 定义页在壳级显示
   “查看活实例”，目标是 `/canvas?focus=flow:<name>&scope=<scope>`。当前
   `resolveFlowRelAlias` 已为唯一实例 flow 提供该活入口；零实例或多实例依其
   既有诚实 404 语义，桥不改写为猜测。**否决(b)**:命名约定已是单一真相，
   映射表会漂移且需另建生命周期；**否决(c)**:它把合同命名逻辑泄漏到组件树，
   违反内容面零类型特判。其他实体不出桥，不因落地便利而降级为后续 Track。

## D47 一等交互、结构化引用、raw 镜头与 intent 裁剪(2026-08-26,T28 Phase A)

1. **动作控件与提交边界**:候选是(a)实体页、Canvas 与组合区域统一使用一套
   contract-driven `ActionRunner`/动作组，宿主显式注入各自 scope-aware 的 fresh-read →
   exec adapter；(b)把 React/RJSF 控件全部收编进 A2UI SDK `createActionGate`。采纳(a)：
   动作组只遍历当前 Siren actions，统一表单、两段式确认、guard reason 与图例；Entity 宿主
   注入 scope-aware exec，Surface 宿主注入 fresh entity → declaration → guard → schema →
   dependency recheck → exec，服务端继续作最终裁决。删除 `live` 与函数身份判断这类隐式分流。
   否决(b)：SDK gate 是 A2UI dispatch 白名单，不拥有 React 表单和确认状态；强行合并会扩大
   边界且仍不能代替提交前 fresh read。组级可见文案固定为“你和助手使用同一合同，由同一规则
   裁决”，不声称 actor 权限或结果完全相同，保留 human-only approval。阻断原因直接显示合同
   `guard-results.reason` 并以 status 语义暴露，tooltip 只可冗余，禁止实体类型或 action 名特判。

2. **chat 引用与点击因果链**:候选是(a)assistant 终局消息尾部结构化 citation chips；
   (b)把正文实体名改写成内联链接；(c)两者并存。采纳(a)：只消费 canonical
   `FactRef{rel,pointer}`，按 `(rel,pointer)` 首次出现去重且不截断；rel 是主目标，pointer 是
   可见的次级证据/无障碍说明，不额外解引用人话标题或事实值。live 从 final SSE sources 接线，
   history 按显式 turnId 从权威 `chat-message-appended.citations` 投影，禁止按文本匹配。
   点击只构造 `/canvas?focus=<rel>`，从当前 URL 保留非空 scope/thread；若 rel 是
   `thread:<id>`，它覆盖旧 thread。其他页面 query 与 pointer 不伪装成 Canvas 已支持的定位能力。
   chip 与 Canvas 都只从 URL focus 导出 active/`aria-current`，不新增全局选择态、事件或存储；
   点击后仍 fresh 授权。否决(b)：现有 FactRef 没有正文 span/sourceIndex，Markdown 拦截、正则或
   文本扫描都无法证明对应关系；未来内联必须先立结构化协议。否决(c)：继承同一不可证明映射，
   并制造两套点击和高亮真相。

3. **raw 是共享抽屉内容，不是第三站点**:候选是(a)共享 `RawContractDrawer`/
   `RawContractContent`，由实体页、Canvas focus 与 citation 落面后的实体入口使用；(b)全局 URL
   模式；(c)独立路由。采纳(a)：输入必须是当前 scope 新鲜授权得到的、未组装 Siren Entity，
   直接 JSON 序列化，不通过 self link 再取、不包含 hydrated facts、Surface、事件或 explain。
   EntityView 已持有 exact entity；Surface 宿主保留 exact focus entity 给同一内容组件。citation
   先聚焦 Canvas、再开 raw，满足两步；`workspace:*` 不是业务实体，不能伪造 raw，组合成员/source
   必须经 scope-preserving 链接落到实体后再开。迁移 why 抽屉现有 raw 区为共享内容，raw 触发器
   仍是 why 的同级局部控件；所有触发器具 i3 注记。否决(b)/(c)：它们把验钞镜头变成新的站点或
   导航状态。事件切片属于审计链接，provenance 属 why；本 Track raw v1 只展示原始 Siren JSON。

4. **generic intent 裁剪与依赖**:候选是(a)所有 intent 共用一个 role 优先级上限；
   (b)版本化 exact intent → role budget 声明映射。采纳(b)，以(a)仅作未知非空 intent 的固定
   `read` fallback。匹配只接受完整 intent 字符串，禁止 substring、regex、分词、自然语言分类，
   规则不得包含 entity class、rel、action 名、字段路径或事实值。空白 intent 沿用
   `generic-input-invalid`；默认属性预算是 identity:1、status:1、primary-content:1，其余为 0；
   actions、Siren links 与 collection members 始终保留，diagnostic 不可由字段或 profile 选择。
   同 role 内按 canonical path 字典序选取并去重，再按 `GENERIC_ROLE_ORDER` 排列。selector 只接收
   path/`FieldPresentationRole`，不接收实体或值；`GenericSurfaceOptions.intent` 为必填。
   `planRegion` 传声明 intent，单主体 broker 传请求 intent，Canvas fallback 传同一显式 `read`；
   不读取 class。policy version 作为 `definition:generic-intent-policy` dependency，版本变化使
   Sidecar invalidate/replan。否决仅(a)：无法证明 intent 真进入 generic；否决自由文本启发式：
   让机械层承担意图理解；否决 unknown 全量/空结果：分别保留旧缺陷或让合法自由 intent 不可用。

5. **诊断在位而细节退守 why**:候选是(a)首屏保留无机制词的最小状态，结构化细节进抽屉；
   (b)所有诊断进抽屉且 slot 留空。采纳(a)，以同时满足 D45 第 5 问“不静默、不泄漏”：
   `region-unavailable` 首屏只显示“此区域暂不可用”，其他诊断显示“部分内容暂时无法显示”；不得
   显示 code、node id、内部 message、source rel、policy 或 fingerprint。compiler 仍保留 Text
   占位，但其 data 只含上述固定人话；完整、去重的结构化 issues 由 Surface 宿主传入 why 抽屉。
   region-unavailable 的 why 细节也只允许声明 region、availability 与固定 code。否决(b)：空 slot
   无法区分合法空集合与授权/编译降级，违反 D45；否决首屏直接显示 code：泄漏机制信息并违反
   T24 诚实化口径。所有文案跨实体通用，禁止区域、Application 或实体类型特判。

## D48 T31 质量评审四个判断点的裁决(2026-08-27,T31 Phase A)

1. **R4 `thread-id-available` 层序归位**:候选是(a)前移 guard 层,在 schema
   参数校验之前执行重复创建检查;(b)重归类为 schema 后置检查并修正层序自述。
   **采纳(a)**:`declaration → guard → schema` 是机械裁决不变量,
   `work-thread-command.ts` 在 Ajv 校验后才以 `guard-failed` 拒绝重复创建,
   与自述不符。将 `thread-id-available`(需先 parse detail 取 threadId)移到
   guard 判定之后、参数 schema 校验之前执行;功能等价,层序与 `guard-failed`
   分类同时成立。**否决(b)**:用重定义检查位置的方式迁就实现顺序,会让
   "guard 先于 schema"的口径对后续读者失真。

2. **R8 `scopeFrom` 空 grantedScopes 口径**:候选是(a)fail-closed——
   `grantedScopes` 为空时抛错拒绝;(b)维持现状(空表放行首个非空候选)。
   **采纳(a)**:授权输入为空意味着"没有任何已授权 scope",此时接受任何候选
   scope 都是无授权放行。当前调用方均保证非空,但该函数是服务层唯一 scope
   收口点,fail-closed 使误用面变成显式错误而非静默越权,并配行为测试锁定。

3. **R9 clientView.presence 的优先级分层**:候选是(a)降 presence 同级,
   新增第三优先档;(b)记录 explicit 槽位的有意如此及理由。**采纳(b)**:
   `clientView` 是本次请求显式携带的视图信号,与 presence 上报同信任级但
   时间上最新、且随请求显式给出,放进 explicit 语义准确("显式"指请求明示,
   不指更高特权);scope 越权始终由 `grantedScopes` 收口,无安全暴露。
   T29 spec"显式是正典"指的正是请求显式信号的正典地位,不算字面分层偏差。
   该分层语义由行为测试锁定(改 explicit 值 → situation 同变,仍在授权集内)。

4. **R14 loop_exception/error 帧 LLM phrasing 边界**:候选是(a)补齐——兜底
   error 帧也接 LLM 表述;(b)记录 spec 边界,保持机械结构化 reason。
   **采纳(b)**:loop_exception 是循环壳异常的最后兜底,该路径必须零新增
   故障面(LLM 调用在异常兜底里可能再失败或悬挂,破坏确定性关流);T24 失败
   分层的 LLM 表述覆盖 final 帧全部失败来源,error 帧由客户端中性结构化展示,
   诚实呈现不缺位。此边界作为 T24 spec 的既定豁免登记,后续若补齐须新决策。

纯修复项确认:R5/R6/R7/R10/R11/R12/R13/R15/R16/R17/R18/R19/R20 无裁决分歧,
按 spec 直接进入实施;流程项 R21/R22 与归后续 R23–R27 按计划处置。

## D49 T32 质量评审两个判断点的裁决(2026-08-27,T32 Phase A)

1. **Q3 审计下钻落点是否 raw 镜头化(T31 R23 承接)**:候选是(a)豁免记录,
   维持 `thread.tsx` 的 `stepAuditHref` 指向 `/api/events?afterSeq=N` 的
   未组装 JSON;(b)把活动条目下钻改为 raw 抽屉的事件镜头。**采纳(a)**:
   D47 第 3 问明文"事件切片属于审计链接,provenance 属 why;raw v1 只展示
   原始 Siren JSON"——活动条目是审计链接,落点是事件切片(机械 JSON、
   零组装、零 AI),与 raw 抽屉(Siren Entity 合同镜头)是两个口径各归其位。
   **否决(b)**:事件切片不是 Siren Entity,塞进 raw 抽屉违反 D47 "raw 不
   包含事件"的否决项,且会让审计通道依赖 React 呈现(违背"raw 是验钞灯"
   的零组装纪律)。T31 R23 的关切(主任务路径落裸 JSON)按本条登记为有意
   设计;后续若要人话化审计视图,须新决策且不得动 raw 抽屉口径。

2. **Q6 单/组合依赖装配两套 id 方案**:候选是(a)单主体依赖统一经 compose
   内核产出;(b)注释锚定两套方案的对应关系。**采纳(b)**:`runtime.ts` 的
   `currentDependencies()`(单主体,`entity:<rel>` 方案)与 `compose.ts` 的
   canonical 产出(组合,`composition:<id>@<v>:<region>:…` 方案)虽形状不同,
   但 `dependencyDecision` 比对永远同主体同源(plan 时存入 sidecar 与命中时
   重算走同一装配),不存在跨方案失配;风险仅在未来单侧修改。锚定注释 +
   对应关系说明即可达成防御。**否决立即统一(a)**:须改 shrink-only 基线
   目录内核(`packages/engine/src/presentation`)且使全部既有 sidecar 依赖
   指纹漂移触发重规划,扰动大于收益;统一装配留待未来真正改 dependency
   语义的 track(届时按 GR3 净不增长纪律执行)。

纯修复项确认:Q1/Q2/Q4/Q5/Q7/Q8/Q9/Q10 无裁决分歧,按 spec 直接进入实施;
归后续 Q11–Q14 按计划处置。

## D50 读面姿态与责任点:读写分工及 D47.4 姿态细化(2026-08-27,T33 Phase A)

1. **带参数动作的呈现姿态(D47.4 细化,不推翻)**:候选是(a)read 意图下把
   actions 区域移出组合/单主体 surface;(b)actions 任何 intent 下始终保留且为
   一等控件,但参数表单全站单一默认收起,打开/关闭仍是零业务事件的 presentation
   interaction。**采纳(b)**:D47 第 4 问明文"actions、Siren links 与 collection
   members 始终保留",T28 验收"每个声明 action 有一等控件"——一等 = 可见 +
   同裁决,不是参数表单摊开;且 LLM 不可用的部署里 UI 按钮是唯一写通道,读面上
   移除动作等于在最需要 affordance 时拿走它。**否决(a)**:直接违背 D47.4 与
   T28 承诺,若要走须先立新决定推翻,无充分理由。单一默认收起适用实体页/画布/
   组合区域全部宿主(GR2 不留"某处展开某处收起"双默认);打开后 prefill/焦点/
   两段式确认行为不变。

2. **读/写通道分工(方向判断)**:复杂写的正典在 chat 原话授权(T15 仪式:执行
   引用 user message id 与逐字 quote),UI 保留的责任点写是一击零参数(批准/拒绝/
   确认)——依据 product-vision §一.1"AI 让你对工作保有完整认知,同时只做你
   明确要点头的部分"。责任点一等的实现形态是**成员决策卡**:集合成员携带已声明
   动作时渲染 identity + 一行结构化摘要 + 统一动作组(选择规则纯结构,零
   class/rel/action 名分支,继承 D47.1 统一动作组与两段式确认)。任务语言只来自
   合同数据(动作/字段定义 title、投影 identity、Siren link title)或 LLM 原生
   认知;渲染器只保留 D47.1 式通用固定框架("填写{action.title}参数"类),
   零 i18n 映射、零文案模板(文案滑梯)。

## D51 授权与注意力范畴分离:凭证集合裁决,presence 单点镜头(2026-08-27,T33)

- **背景**:生产事故链(chat present 跨应用 authorization-failed → 应急修复
  后 durable key 仍冻结 → 毒 sidecar 持久化 → canvas GET 按存储冻结 scope
  重审 404)暴露同一根因:`identity.policyScope` 单值字段同时被两个互斥
  范畴消费——授权裁决与认知镜头。product-vision §七 自诊断"scope 作为
  授权边界做了,作为认知边界没做";§六判据下,T22 式逐调用点补丁
  (D50/GR6)无法阻止同类问题随新增 application 再现。
- **决定**:
  1. **授权 = 数据受众谓词**:事实在 fold 投影时标注归属应用/属主;判定
     收敛为咽喉守卫(输入仅凭证的应用授予集合 × 事实归属);未知 rel
     fail-open 交既有三段裁决兜底。defaultPolicyScope/scopeCoverage/
     会话级选择/selectCoveringPolicyScope 全部退役;UserSidecarKey 剥离
     scope 维度,授予变化走依赖失效重规划。
  2. **失败语义分家**:授予内一切路径零可见授权事件;授予外与"不存在"
     均为结构化 denied 回执(reasonCode);HTTP 404 仅保留跨 principal 的
     存在性隐藏;越界工件创建期拦截。
  3. **注意力 = situation 单点装配**:优先序 显式 > presence > 未定位
     (一等态,不偷选默认);lens 只流向人类常显、agent 披露切片、导航
     落点三处消费者,类型上不可进入任何鉴权函数。
  4. **披露收窄只发生在 prompt 层**(CLI 三纪律重申):HTTP 合同恒按授予
     并集返回;agent 切片全量重建非累积,尺寸不变量成立。
  5. 结构化原因优先:机械层产 reasonCode 数据,回执条目用有界既定活动
     措辞(presentation-words 口径),对话内解释由助手生成,禁止模板扩写
     冒充理解。
  五条可执行不变量及其执法映射见
  `conductor/tracks/archive/t34-authority-attention-separation_20260827/architecture.md`
  §七;GR6 静态扫描随之退役,执法主体移交类型系统。
- **理由**:权限属于凭证与对象之间的关系,必须每次行为时就地判定且零语境;
  注意力属于工作台此刻的状态,只能决定先呈现什么。两者合流使"换一篇文章"
  变成"越权",任何修补都只是移动故障面;范畴分离后该错误类在定义上不可
  能发生,且满足愿景 §六 换 application 零改码的施工纪律。
- **影响**:取代此前的 route 级 scopeCoverage 口径(GR6 门禁与登记簿已随本条整体退役;
  被取代条目的原始记录仅存本地 git 历史);identity 携带 grantedApplications;chat/presentation/
  sidecar/meta/entity/exec 全部咽喉点换新谓词;应急修复 fix-0a36f20 中
  "durable key 冻结值"缺陷由 T33 Phase B 根除;诚实失败客户端分支随之落地。

## D52 T22 闭环:过期实机验证裁定与 scripts/t22 常驻晋升(2026-08-27,T22 收口)

- **裁定**(用户 2026-08-27 指令:已过期的验证不再重跑):T22 计划中剩余的实机验收项
  按过期处置闭环,不再补跑。依据是三重事实:(1) D37 已把 `v0.1.0-experimental.1` 的现场
  证据定格(单 Web 并发/重启/重放、十工件隔离恢复 RPO 0、auth negatives 100% 已验;
  Runtime matrix 固定 `failed-honest` 且明令不得提升为 passed;rollback/fault injection
  未实测如实登记为 known-risk 边界);(2) 发布后产品演进(T24–T34)全部发生在 mothership
  K8s 现场(T26 rev40–42、T34 rev52 生产走查)与当前 main,现在重跑 Compose story
  corpus 或 Runtime Run 验证的将是后续演进而非 T22 发布物 `d5557bf`;(3) 质量门已常驻化,
  由后续每个 track 的收口连续执行(T33 2026-08-27 全量 e2e 52 passed;T34 pnpm check
  终绿)。被裁定的项:Phase G Compose story corpus 与 restart/dual backends smoke 复跑、
  Phase I K8s/Host 双后端 Agent Run、Phase J 的 T22 专项全量门与最小三次 Runtime Run。
  未过期且不重跑即闭环的项:其验证在发布前已实际执行,结果(含 failed-honest 与
  known-risk)即为最终记录;`Critical/High=0` 按"无未登记的身份/数据一致性/恢复问题"
  口径以在案证据复核通过。本裁定不改变发布边界:该版本仍非 GA/SLA/LTS/生产就绪。
- **scripts/t22 考古裁决(GR5)**:整目录晋升为常驻部署合同套件,不删除——它守护的
  `deploy/compose`、`deploy/helm`、`deploy/keycloak`、备份/恢复与 realm bootstrap 合同
  均为常驻产物,runbook(`docs/t22-production-runbook.md`)与 `package.json`
  (`migrate:production`、`compose:t22`)持续引用;路径与命名保留原样以免破坏上述引用,
  "t22"自此只是目录名,不再是在途 track 标记。归档后 `conductor/tracks/archive/` 路径
  引用同步(`deploy/compose/acceptance-contract.json`、
  `scripts/t22/t22-compose-acceptance.test.ts`、`scripts/t22/t22-evidence-contract.test.ts`)。
- **覆盖 D40 的"清空基线"预期**:T22 所属 3 条 GR3 存量(`scripts/t22` 目录 14,425 行、
  两个 >800 行合同测试)按 2026-08-26 业务优先纪律不拆分、不裁剪,转为常驻登记债务
  (shrink-only,后续触及内容时收缩);`apps/web/src/app/api/chat/route.ts` 的收缩窗口
  与 T22 脱钩,改挂在下一次 chat 编排重构。基线条目注记更新归属,行数不变。
- **GR4 修正**:`governance:strict` 并入 `pnpm check` 的触发条件修正为"整个
  size-baseline 清空时"——T22 关闭时 baseline 仍登记 T24/T29/T31/T32/e2e 等后续
  track 授权条目,strict 不具备并入条件;AGENTS.md 同步改写,不再以 T22 关闭为触发点。

## D53 治理例外清偿完毕:strict 常驻并确立"膨胀即拆解"纪律(2026-08-29,T36 收口)

- **事实**:`size-baseline.json`(12 条 GR3 债务)与 `exceptions.json`
  `dependencyExceptions`(2 条 GR1 例外)经 T36 以重构与功能拆解全部清偿:
  hook/模块提取、测试 describe 分片、五处目录子域归档、`@ui4a/db` 抽包、
  kill 集成测试与组合根同宿。两登记文件保留空结构(登记机制不删,写入须新决策)。
- **strict 接线**:D52 设定的触发条件(整个 size-baseline 清空)达成,
  `pnpm check` 的治理段自本决定起改为 `pnpm governance:strict`。
- **GR3 处置纪律修订**:超限的默认处置从"登记例外后继续"改为**变更时沿
  功能边界拆解**(拆分必须沿领域;禁止为凑指标的机械挪动/任意对半切;验收
  证据只迁移不删减)。workflow.md 业务优先原则相应收窄:保留"不为凑行数
  裁剪代码/证据",退役"优先登记例外"逃生门——strict 下登记会使 check 失败,
  如确需登记须先修订本决定。
- **GR1 边界补充**:`packages/db` 为平台存储包(允许依赖 shared/engine;
  禁 Next/React/Temporal;web/worker 双端消费,apps 之间仍禁互引)。
  kill 集成测试与组合根同宿 web 服务测试层——不为单一测试下沉组合根或造
  harness 包(反膨胀裁决,retireWhen 两形态外的等价达成)。
- **附带清偿**:全量 e2e 自 T33 以来首次重跑,对齐 T34/T35 未同步的陈旧
  断言(D-3 动作语两段式/F-24 data-active/F-25 入口层/F-02 集合与结构化
  空态/D-2 links 降级与状态标题化/D-7 弹层化/站点标签汉化/todo+ideas
  scopes/芯片前缀);修复三处产品缺陷(thread-desk/selector 控件缺
  data-nav、F-31 烙版后缀泄入服务端 patch、处境条窄视口横向溢出)。

## D54 认知合同、Meta 单一路由、Application 图书馆与 Assistant 字节门(2026-08-30,T39 Phase A)

- **背景**:T39 现场审计与 disposable probes 证明四类结构性偏差:(1)canonical
  `/meta/entity` 与七条 richer 友好路由形成两套人类真相;(2)Application landing
  只按“全部 pageable collection + entry”拼装,无法表达任务语义且有 default 名称
  特判、跨 Meta entry、重复 entity/action;(3)Draft public schema 暴露 policyScope/
  commandId 等非 caller 字段;(4)真实 `meta/flows` 与 `articles` provider request 分别
  约 175 KiB/115 KiB,旧 32 KiB 小 fixture 门不能证明 D41,完整 Siren observations
  还会跨 step 累积。依据为
  `conductor/tracks/t39-meta-contract-driven-governance-ux_20260830/phase-a-spike.md`。
- **决定**:
  1. **认知语义派生优先、单源双投影**:action/SubmissionPolicy/Flow 归属与拓扑/
     field presentation 能推导的语义不得重复声明;不可派生的稳定语义使用版本化、
     封闭 `CognitiveSemanticsV1`。同一 pure projector 投影到 sitemap discovery 与
     exact `properties.presentation`;前者进入 sitemap content hash,后者进入
     entity-contract fingerprint。禁止平行 summary schema。
  2. **视觉策略不是真相**:table/card/decision-list、desktop/narrow density、sticky/
     inline、heading source、折叠、响应式、CSS/组件名永不进入 Application/Flow/Meta
     定义。Meta 由通用 Renderer policy 决定姿态;workstation 由既有 Recipe/Sidecar/
     generic Presentation policy 决定。HTTP/CLI 可见认知语义,Assistant 只消费显式
     allowlist;“同一扇门”不要求 Agent 消费像素策略。
  3. **action input ownership 单 wire**:JSON Schema property 可选 annotation
     `x-ui4a-input-owner: client`;缺省/`caller` 由协议调用方提供并对 human/Agent
     可见,`client` 由可信宿主在 caller schema 校验后注入再过完整 schema。server-owned
     值不得出现在 public `action.fields`/params,只来自可信 execution context。Draft
     create 删除请求 policyScope,kind 唯一决定时删除 schemaRef;commandId/观察到的
     baseVersion 为 client-owned。同一逻辑重试复用 commandId;变参是新提交。RJSF、
     Agent tools、CLI、Siren 与 server judgment 原子迁移,无 hidden widget/字段名 fallback/
     双 schema/兼容 wire。
  4. **Assistant disclosure 全量重建非累积并设运行时硬门**:扩展 D41/D51,“非累积”
     包括 entity observations,不只 sitemap/tools。每个 decision 从 immutable full sitemap
     重建 scoped cognitive slice、一个 current sanitized entity、current actions/tools 与
     有界 `rel/action/result-ref` trail;禁止旧完整 Siren snapshot、raw bundle/payload/
     definition、Recipe/Sidecar/Surface 与视觉策略进入 prompt。最终 provider request
     `UTF-8 JSON <= 32768 bytes`;以发送前完整 body 为权威,超限在 fetch 前结构化诚实
     失败,零网络/exec/mutation。公开 HTTP/CLI 不因该门窄化。
  5. **Meta canonical 单一路由且 unlocated-first**:扩展 D51 并 supersede D32 的“旧友好
     路由兼容”及 D46.5 的 `/meta/flow/*` bridge。先删除 canonical/old view/Situation
     中 publishing/first-grant 默认 lens,缺 lens 是一等态且不参与授权;再以一个 cutover
     注册 Flow/Activation/Capability specialization,切换全部内链/presence bridge,删除
     七条友好 route、fetch wrappers 与硬编码 lists。无 redirect/rewrite/flag/compat test;
     回滚是整体 revert。成功 Meta 写失效当前授权 Meta exact/collection/dashboard 依赖,
     不只 executed rel。
  6. **Application 是图书馆,Work Thread 是书桌**:新增纯投影、只读、零 action/event/
     storage 的 business `application:<name>` Siren entity,从 active ApplicationDefinition
     投影 title/intent/最小 traits/entry descriptor,按 name × grantedApplications 判权,
     供 `workspace:app:<name>` binding;禁止 workstation 偷读 `meta/application:*`、复制
     Surface literal 或给虚主体造事实。Application landing 只说明/发起能力,不聚合
     principal 待批/进行中/最近事件;`/` 与 Work Thread 保持工作单位。
  7. **Application/collection 最小语义与不变式**:当前仅需 Application
     `system-fallback`,entry `{target,role}`(primary-create/primary-task/primary-collection/
     resume),surface role(work-queue/review-queue/output-catalog/task-history/
     human-responsibility/audit-only)。普通 entry 必须指向自身 business surface,禁止
     `meta/`/`_meta`/`workspace:` 隐式 entry;collection owner 优先 Flow.collections、
     次 append,歧义拒绝,extra surface 不发明归属。source 授权/alias 解析后按 canonical
     rel 仅在 view 去重,完整 membership 仍入 dependency fingerprint。composition version
     随声明内容变化,role 经通用 policy 对齐既有 exact intent,无 per-app intent 表。
  8. **延期 Application shelf pin/recent**:现有 Sidecar pin 不是书架偏好;新增偏好需要
     新事件/投影且非当前故事必要。T39 只使用 discoverability、定义顺序与当前 lens 轻强调,
     不引入个人排序真相。
- **影响**:T39 保留一个 Track,Phase B 为共享前置;Meta(C–F)与 Application(G)是可独立
  运行/回滚 milestone,H 只做共同注视与最终 E2E。完整 Draft authoring 继续由外部 Agent/
  CLI/Assistant 原话授权承担,Meta 人类主路径从 validation/diff/checks/provenance 与责任
  decision 开始。不新增 package、数据库、事件族、UI framework 或页面 DSL。

## D55 实体读面预算修订与详情状态回退链(2026-08-31,T40 Phase C)

- **背景**:T40 走查(findings F-02/F-03)证明 D47.4 的默认预算
  `identity:1、status:1、primary-content:1,其余为 0` 在深路径实体页上产出两类
  系统性读面缺陷:(1)详情层状态回退绑 `properties.node` 裸枚举(英文状态词直出),
  而列表成员绑节点中文 title,同一实体两个状态词来源;(2)声明过 presentation role
  的业务字段(metadata/第二个 primary-content,如备注)永远进不了详情层,而 generic
  候选生成又用"全部 fields→primary-content、全部属性→metadata"的循环发明未声明
  字段——声明分层与"未声明不发明"原则同时被破坏。
- **决定**:
  1. **修订 D47.4 默认预算**:`read` intent 预算改为 identity:1、status:1、
     primary-content 放量(不限席)、metadata:1,其余 role 仍为 0;同 role 内选取/
     去重/排序规则不变,`GENERIC_INTENT_POLICY` version 随预算语义升 v3(sidecar 失
     效重规划走既有机制)。未知 intent 固定 read fallback、selector 只接收 path/role
     等 D47.4 其余约束不变。
  2. **详情状态回退链**:有 node 时绑 `properties.title`(节点中文 title,与列表成
     员同源)→ `properties.status` → `properties.node` 裸枚举;纯结构判定,零
     entity class/字段名特判。
  3. **字段只来自显式声明**:删除 generic 候选生成中"全部 fields/属性自动入层"的
     发明循环;未声明 presentation role 的字段不进入读面,已声明未填的字段不渲染空
     壳。React 侧字段名→文案字典(FIELD_DISPLAY_LABELS 模式)仍为禁止项。
- **影响**:实体页首屏三问(是什么/状态/能做什么)由同一合同数据源回答;预算变化
  经 policy version 触发既有 sidecar 重规划,无兼容双路径。后续如需更多 metadata 席
  位,在本条预算上继续修订而非在渲染层加分支。

## D56 广域披露降为导航级:无 scope 不等于全量细节(2026-08-31,T40 Phase E)

- **背景**:T40 S7 实测,线程书桌等「无 scope 且 currentRel 非 sitemap surface」的
  chat 起点(如 `thread:weekly-report`)使 `sliceSitemapDisclosure` 落入广域模式并
  全量复制 8 应用 × flows/actions/guards/edges 与全部 capability 的 I/O 描述,首次
  decide 的 provider wire 达 38,345B,超 D41 固定的 32 KiB 预算,chat 首步即死。
  D41 已明言「超限视为披露层缺陷」,故修复落在披露层,不动预算、不窄化公开合同。
- **决定**:广域模式(scope 缺省且 exactSurfaceScope 落空)的披露一律降为导航级——
  1. applications:全量保留 name/title/intent/entry 路由信号;flows 只留
     `{name, title}`,actions/guards/edges 属执行细节,导航进入 scope 后由 scoped
     切片与当前实体合同披露;
  2. surfaces:全部为 `{rel, title, app?}` 导航入口(原「无 app 的 surface 全量
     复制」行为废止);
  3. capabilities:全量保留 name/title/kind/intent/scope 路由信号,I/O 描述
     (input/output)留到 scoped 切片;schema 永不进 prompt 的纪律不变。
  scoped 切片(explicit scope 或 exact surface rel 推导)内容零变化;D41 的 32 KiB
  wire budget、同一披露函数服务 inline/delegated、公开 HTTP discovery 合同完整,
  全部不变。
- **边界**:披露层不做词级 scope 猜测(既有测试纪律保留);线程是跨应用上下文,
  广域导航级是其诚实形态——assistant 先导航落点再获得 scoped 细节。真实制品回归:
  `walkthrough-prompt-budget.test.ts` 广域切片 ≤10 KiB(固定开销余量口径),
  `prompt-budget.test.ts` 含 tools 的全 wire 广域用例 ≤32 KiB。

## D57 Application 发现分为首页缩略与完整目录(2026-09-01,T41)

- **背景**：应用书架全量展示用途会随新增应用撑高首页，挤占“我的事”。用户明确要求
  缩略形态、独立目录，以及首页最多 9 个入口。
- **决定**：`/` 按授权 business sitemap 声明顺序展示最多 9 个中文名缩略入口；
  `/applications` 展示全部已授权业务应用及用途并提供搜索。顶层导航只增加稳定的
  “应用”入口，不按安装应用增长。9 是通用视觉预算，不窄化 HTTP/CLI 发现合同。
- **单源边界**：两处复用 reader、`system-fallback` 成员过滤与 canonical landing；
  目录不读取 Meta application，不建立新业务实体、授权范围、收藏/最近使用存储，
  不复制 `workspace:app:<name>` 工作区。目录搜索只是已披露集合的本地筛选。
- **上下文**：首页到目录保留显式 scope/thread 与安全 returnTo，移除旧对象 focus；
  目录到应用仍由 `applicationLandingHref` 生成，scope 只代表注意力。
- **验收**：合成 30 应用时首页恰好前 9 个，完整目录可发现全部 30 个；
  新名字无需改前端或顶层导航。D46 的工作站首页、D51 授权与 D54 的图书馆语义不变。

## D58 共同工作上下文与中立发现起点(2026-09-01,T42)

- **背景**：a6f8e1cf 会话在客户端 scope/thread/focus 均为空时，由 articles 兜底
  推导出 publishing 并宣称“主应用”。Situation 的工作线没有进入 Agent 披露。
- **决定**：
  1. 新增只读、零 action/event/storage 的业务 `applications` 集合，由现有 active
     Application 定义派生；按 grants 过滤成员、按 system-fallback trait 排除系统地板。
     它成为未定位业务起点，替代 D41 的 articles 兜底；扩展 D57 的“不新增业务实体”
     仅至这个同源发现投影，不新建目录真相。Meta 未定位起点为 meta/applications。
  2. 当前对象优先；无对象而有有效且 owned 工作线时，从 thread 起步；其次应用
     entry，再到中立目录。显式 null 清空阻止旧 presence 回填。应用偏好不再由
     Agent 观察对象反推；观察应用仅决定详情披露，其他应用仍保留导航级摘要。
  3. Agent/后台只传出生时固定的 `contextRel` 工作线引用。每次新决策经授权 HTTP
     重读工作线及最多四个显式 context/active/approval 引用；无递归、无自动 attach、
     不保存业务事实副本。Prompt 只含有界认知摘要，主实体独占 action tools。
     工作线拒绝不可恢复旧事实，已完成步骤幂等重试仍返回原回执。
  4. scope 仍是已有 URL/Presence 的应用选择字段，本次不改事件 wire 或 OAuth/Draft
     scope。人类标签改为“应用”并使用合同标题；复用处境弹层展示有限引用，不
     增加帮助段落或配置中心。临时问答不要求建线。
  5. 授权继续 D51；Thread 根、内嵌成员、相关链接和派生落点都不得泄漏授予外事实。
     后台 service 凭证不能读取人类工作线时诚实拒绝，不用请求 principal 冒充用户。
     本地 Chat 处境按与工作台相同的 local-user 主体装配；生产主体始终来自凭证。
- **验收**：T42 S1–S8、真实 LLM 只读故事、32 KiB wire、HTTP/浏览器同源、重放、
  后台新步重读与幂等恢复；不以旧默认测试限制故事，不放松权限/审批/来源不变量。

## D59 Capability Port 以 Native Function Adapter 扩展执行边界，不新增 Run(2026-09-01,T43 Phase A)

- **背景与覆盖关系**：当前 Web 只允许带 exact `agentDefinition` 的 executable Capability，
  `spawn-requested` 后一律创建 canonical Agent Run。T43 probe 证明现有 Temporal 单 Activity、
  bounded retry、SIGKILL recovery、cancellation 与 non-cancellable finalize 已足以承载本地
  Native Function。D59 只 supersede D39 的“所有 executable Capability 都只能走 Agent Run”现状；
  D39 删除 legacy Capability Run、Agent executor 只使用 canonical Agent Run、callback token 保留
  三项继续完全有效。
- **Port/Adapter 分界**：Application Capability 只声明 intent/kind、input/output JSON Schema、
  scope 与 `{class:'native-function', profile}` requirement；Flow 只声明封闭 input binding 与
  on-done/on-error。handler/module/endpoint/credential/Temporal 参数属于部署侧 Profile/registry，
  请求、人类、Assistant、CLI 与 Bundle 均不能选择或覆盖。Function executor 不带
  `agentDefinition`；Agent executor 的 exact Definition、birth references 与 canonical Run 不退化。
- **单一执行记录**：已持久化的 `spawn-requested` 同时是不可变 birth record 与 transactional
  outbox；executionId/workflowId 由 source seq + capability/profile/input birth hash 确定性派生。
  Web immediate start 加 boot/有界周期 reconciliation 关闭 DB commit 后、Temporal start 前崩溃
  窗口。Temporal history 只负责编排，`function-execution-finalized` 只作 capability-domain 终局
  回执；不新增 Function/Capability Run table、aggregate、projection、Siren resource 或页面。
- **最小披露与执行纪律**：纯 binder 只接收已过 Action schema 的 params、source entity 显式
  fields 与已授权显式 artifact refs；V1 禁 wildcard/spread/JSONPath/expression，受字段数、深度、
  节点与 bytes 硬门，绑定后再过 input schema。Handler 只收 payload、executionId 与 AbortSignal，
  不收 EngineSnapshot、Work Thread、Sitemap、credential、DB/Web handle 或 callback 选择。首个本地
  Adapter network denied，只承诺 payload/timeout/attempt 与 cooperative cancellation，不虚称同进程
  CPU/内存硬隔离；外部 effect 的幂等协议延期。
- **受治理回流与原子性**：Activity 校验 output contract/hash/bytes，Web protected finalize 按 birth
  再校验并重读 exact spawn/current source；on-done/on-error 使用受控 system principal，全部 params
  `origin=effect`，重新经过 declaration → guard → schema，不能绕过 confirmation/human-only。
  capability terminal receipt 与 callback core events 在同一 PostgreSQL transaction 提交；
  executionId partial unique index + advisory lock 裁决 retry，重复 key 必须比较 invocation/outcome
  hash，碰撞 fail closed。Business fold 只吃 callback core events，Temporal/receipt 不是业务真相。
- **呈现与扩展**：source Application state 表达进行中/完成/失败，Work Thread 只显式引用 source
  entity；普通 Workstation 不显示 handler/profile/attempt/Temporal/raw output，机制回执只进
  raw/audit。通用 dispatcher 只按 executor class 组合，不按 capability/Application/业务名分支。
- **技术栈**：零新增 runtime dependency、workspace 或基础设施；复用现有 shared/engine/db、
  PostgreSQL events、Temporal SDK、Next.js internal route、Ajv 与 callback token。详细 wire、事务与
  模块落位见
  `conductor/tracks/t43-capability-boundary-native-function_20260901/architecture.md`。

## D60 Compose 公共 Origin 与内部 TLS Listener 分离(2026-09-01,T44)

- **背景**：T22 Compose 把 Keycloak `KC_HOSTNAME`、证书 host、Runner 内部 origin 和宿主 published
  port 一起固定为 mothership `:8443`。`home` 已有服务占用宿主 `8443`，而现有 Tailnet Caddy 在
  `443` 提供入口；仅改 port mapping 会使 OIDC issuer/callback 与浏览器实际 origin 分裂。
- **决定**：canonical settings 的 `service.publicOrigin` 与 OIDC issuer 是公共 origin 单一真相；
  Compose input generator 在严格解析后派生 Web/Keycloak host，拒绝环境覆盖不一致。宿主只允许
  一个 operator-owned、非特权 loopback published port；容器内部 UI4A edge `8443`、Keycloak admin
  `9443` 与两个 Runner delivery listener `8443/9444` 保持不变。TypeScript renderer、静态 YAML、
  operator preflight 与合同测试原子迁移，不保留第二套 home Compose。
- **入口边界**：外层 Caddy 可以在公共 `443` 终止证书，但必须 TLS 回源 UI4A edge、校验持久化
  public CA、保留两个独立 host，并继续由 edge route allowlist 决定可达路径。禁止 path-prefix、
  `tls_insecure_skip_verify`、直接代理 Web/Keycloak 或公开数据库/Temporal/admin listener。
- **影响**：mothership 默认 public origin 与 `8443` 行为不变；新环境只贡献 operator settings、
  Secret、image inventory、published port 与外层入口事实。零新增 runtime dependency、数据库、
  权威状态或应用级分支。

## D61 公网 Origin 与 Compose 内部 TLS Host 分属两层入口事实(2026-09-02,T45)

- **背景与修订**：D60 已分离公共 origin 与宿主 published port，但仍把 public origin hostname 强制
  等同 `settings.tls.*Host`。该假设只适用于外层代理与 Compose 同机。`aliyun-sz` Caddy 经 Tailscale
  回源 `home` 时，浏览器/OIDC 使用 `*.styleofwong.cn`，内部 TLS/SNI 继续使用 home 已持久化证书
  `*.home-linux.tail.styleofwong.com`；强制相等会迫使无意义地轮换 CA/leaf inventory。
- **决定**：`service.publicOrigin`、OIDC issuer/callback 与 `keycloak.host` 是公共身份和浏览器 origin
  真相；`settings.tls.ui4aHost/keycloakHost` 只表示 Compose edge 内部 leaf certificate、network alias
  与 Runner delivery host。两组分别严格解析、各自保持 UI/Keycloak 两 host 不相等，但允许跨组不同。
  Operator generator 从 public settings 导出 public origins，从 TLS settings 导出 internal hosts；
  环境变量不能覆盖任一来源。
- **信任边界**：外层 Caddy 必须经私网/Tailnet 访问 edge，以内部 TLS host 做 SNI 并验证证书；它只
  改变浏览器入口，不直接代理 Web/Keycloak，不公开 home 新端口，也不改授权、issuer、audience、
  callback、Runner 或业务裁决。
- **影响**：同机部署的默认值与 D60/T22 行为不变；跨机入口无需轮换 home CA 或删除任何 volume。
  零新增依赖、协议 wire、数据库、权威状态或环境名称分支。
