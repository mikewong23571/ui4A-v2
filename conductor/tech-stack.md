# 技术栈 — UI4A v2

> 来源:`docs/UI4A-技术选型.md`(2026-08 检索验证)。
> 原则:全部用社区轮子,不自造;UI4A 的增量只留在没人做过的那一层(Siren 投影 + 三层裁决 + 平面组装)。
> 约束:GOAL.md 明确"技术栈严格按选型文档,不自造轮子"。
> 当前协议以本文件与 `DECISIONS.md` 为准；原始选型文档中的 rule fallback、render capability/tool-rendering 和 concern cache 已 supersede。

## 总栈决定

**TypeScript 全栈**(原 demo 为 Clojure,按选型迁 TS,架构经验 1:1 平移;全栈同语言,谓词共享免费)。

## 选型总表(架构概念 → 轮子)

| 架构概念 | 选型 | 备注 |
|---|---|---|
| 流程真相源(状态机) | **XState v5** | machine config 是纯 JSON,运行时 `createMachine(config)` 构造;snapshot 可持久化;Stately 可视化 = BIOS 定义查看 |
| 合同格式(超媒体实体) | **Siren** | `actions`(method + href + fields)是"agent 要做事"的最佳格式 |
| Schema 与校验 | **JSON Schema (draft-07) + Ajv**;内部类型 **Zod** | 合同格式必须语言中立;RJSF 直接吃 JSON Schema |
| 引擎 / API 承载 | **Next.js (App Router) API 层** | 备选:独立 Hono 服务(见"待定项");AI SDK 与 RSC 原生集成 |
| 事件溯源 | **PostgreSQL append-only 表** | demo 级可 SQLite 起步;规模化迁 KurrentDB |
| 能力平面(job/租约/超时/重试/补偿) | **Temporal(TypeScript SDK)** | durable execution 吞掉整个"能力宿主协议"设计;委托即 workflow |
| 信任线(策略/风险分级/确认) | **Cedar** | 策略即数据,可作 meta 实体存取 |
| 认证与委托链(actor/principal) | **Keycloak 26.2+** | RFC 8693 Token Exchange 正式支持,`act` claim 链即信任线 |
| 确认通知 | Temporal activity + Web Push / SMTP | 重试/超时免费 |
| 哑表单 / BIOS 编辑器 | **RJSF(react-jsonschema-form)v6** | JSON Schema 直接渲染;field-definition 即输入 |
| UI 组件库 | **shadcn/ui**(Base UI 底层) | 骨架五面全用现成组件拼 |
| 聊天 + 生成式 UI | **Vercel AI SDK 5 + assistant-ui** | tool-rendering / UI state 一等公民;`generateObject` 即 clarify 机制 |
| 机械 diff | **deep-object-diff**(备选 TerminusDB JSON Diff & Patch)+ **react-diff-view** | diff 是纯数据 → 渲染零 AI |
| 流程图渲染 | **React Flow** | XState 图谱可直接喂 |
| 渲染协议(画布) | **A2UI(Google, v0.9)** | 数据与组件分离;我们侧强制 binding-only + action 拦截 |
| LLM Assistant | AI SDK + OpenAI-compatible Chat Completions | AI-first;真实 LLM 是产品智能主体，scripted/mock driver 仅用于协议测试 |
| Presentation Plane | UI4A semantic Surface kernel + A2UI runtime + PostgreSQL projection | Application Recipe 预生成；用户级 Sidecar/版本/patch/promotion 独立事件重放；Chat 只见薄 request/receipt |
| 外置 App Authoring | 外部 Agent + UI4A meta HTTP contracts | Agent 起草 Bundle；UI4A 负责机械校验、diff、human approval、激活、审计和 replay；不进入产品 Chat runtime |
| Agent CLI | TypeScript/Node `apps/cli`，native fetch + `tsc` | `ui4a` 是 HTTP/Siren/meta 的稳定 JSON 参考客户端；无内置 LLM、无 Web 内部依赖 |
| Coding Capability Executor | `@openai/codex-sdk@0.149.0` + Temporal + Git worktree | Codex 是首个真实 reference adapter；Provider/Workspace 分层，Hermes 仅作设计参考 |

### 渲染词汇表组件(注册为 A2UI 扩展目录,MVP 前十词)

`table`(TanStack Table)/ `chart`(shadcn Charts, Recharts 3)/ `stat`(Tremor)/ `timeline`(react-chrono)/ `flow`(React Flow)/ `form`(RJSF)/ `diff`(deep-object-diff + react-diff-view)/ `kanban`(dnd-kit)/ `markdown`(react-markdown / Streamdown)/ `detail`(shadcn Sheet/Card);后期:`calendar`(FullCalendar)、`map`(MapLibre)。

## LLM Provider 接入(外部配置)

运行时只接受完整的 provider-neutral profile:`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`。代码不内置供应商 endpoint、模型名、key 或隐式默认 provider；Web、Worker、render、probe 与 Story Eval 复用同一解析口径。开发环境由根级 gitignored `.env.local` 经 `pnpm dev:all` 传给 Web/Worker，外部环境优先。

T15 首个真实 baseline 是 OpenAI-compatible `deepseek-v4-flash` profile；具体 endpoint/model 值属于部署配置。后续可切换其他被测模型，并可单独引入廉价 LLM judge，但 judge 不替代机械 safety gate。

## Agent 侧接口(不自造线协议)

1. **协议结果/动词**:T15 将区分只读 `answer(content,sources)`、导航/澄清、业务 `exec/exec-plan`、副作用完成 `done` 与诚实 `fail`;阅读/总结/比较/解释不是 application capability;
2. **每状态动态生成的动作工具**:当前实体 `actions[]` 逐个生成工具,字段 schema 内联,guard 求值结果嵌进 description(拒绝即教育);`navigate` 的 rel 从实体 `links` 生成枚举;
3. HTTP 合同是唯一真相,tools/MCP 是投影;同一合同可再包一层 MCP server 供外部 agent 零成本操作。

## 自己写的部分(UI4A 真正增量)

1. **Siren 投影层**:rel → 实体(properties/actions/links/guard-results 组装);
2. **三层裁决的 exec 端点**:动作声明 → Cedar 策略 + JSON Schema 校验 → XState 转移;
3. **效果词汇表**:set-field/transition/append/spawn 映射到 XState context 更新 + Temporal activity 启动;
4. **guard 注册表桥**:谓词求值结果(Ajv/自定义)投射进实体 guard-results;
5. **meta 平面 definition-lifecycle flow**:用 XState 自举,激活 guard 调结构不变式校验。

## 待定项(实现首个切片前敲定,记入 `DECISIONS.md`)

| 项 | 选项 | 建议 |
|---|---|---|
| 引擎承载 | Next.js API 层 vs 独立 Hono 服务 | Next.js API 层(AI SDK/RSC 原生集成,demo 单体最简) |
| demo 级事件存储起步 | PostgreSQL(docker)vs SQLite 起步 | PostgreSQL(GOAL 口径即 PostgreSQL,I5 可重放从第一天就验真) |
| 包管理 / 仓库形态 | 文档未指定 | pnpm workspaces monorepo(app + worker + shared 三包,谓词共享免费的前提) |

## 实况注记(2026-08-21,T8 收口;实际安装版本)

next 16.3.1 / react 19.2.8 / xstate 5.32.5 / ajv 8.20.0 / zod 4.4.3 / pg 8.23.0 / @temporalio/* 1.22.0 / @cedar-policy/cedar-wasm 4.12.0 / ai 7.0.71 + @ai-sdk/openai 4.0.45 / @assistant-ui/react 0.15.16 / @rjsf/* 6.8.0 / @a2ui/web_core 0.10.6 + @a2ui/react 0.10.2(D12:官方 SDK) / @tanstack/react-table 8.21.3 / recharts 3.10.1 / @tremor/react 3.18.7 / react-chrono 3.3.3 / @xyflow/react 12.11.3 / @dnd-kit/core 6.3.1 / react-markdown 10.1.0 / deep-object-diff 1.1.9 / react-diff-view 3.3.3 / typescript 5.9.3 / tailwindcss 4。测试:vitest 4.1.11 / @playwright/test 1.62.1 / fast-check 4.9.0。运行时:node 24 / pnpm 10 / PostgreSQL 17(docker)/ temporal CLI 1.8.2(start-dev)。

T16 没有新增 workspace 或基础设施依赖：pure kernel 仍在 `packages/engine/src/presentation/`，LLM adapters 在 `packages/agent`，PostgreSQL/Broker adapters 与 A2UI host 在 `apps/web`。

T17 新增 `apps/cli` workspace，但没有新增第三方运行时依赖：Node native `fetch` 访问合同，
`tsc` 生成可安装的 `ui4a` binary；Draft 继续复用 PostgreSQL append-only `events`，并增加
immutable payload 与 rebuildable projection 表。

T18 在 worker 增加官方 Codex SDK 作为唯一真实 Coding Executor 依赖；CLI JSONL 与
Claude/Gemini-style streams 只做 adapter fixtures。Git worktree、Temporal、PostgreSQL 和现有
artifact/Siren 基础继续复用，不引入 Hermes、Agent gateway 或新基础设施。
