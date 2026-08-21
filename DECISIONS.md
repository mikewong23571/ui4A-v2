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
