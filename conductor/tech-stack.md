# 技术栈 — UI4A v2

> 来源:`docs/UI4A-技术选型.md`(2026-08 检索验证)。
> 原则:全部用社区轮子,不自造;UI4A 的增量只留在没人做过的那一层(Siren 投影 + 三层裁决 + 平面组装)。
> 约束:GOAL.md 明确"技术栈严格按选型文档,不自造轮子"。

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
| LLM driver | AI SDK `generateText/step` + 自定义 rule 循环 | 双 driver 架构不变;provider 无关 |

### 渲染词汇表组件(注册为 A2UI 扩展目录,MVP 前十词)

`table`(TanStack Table)/ `chart`(shadcn Charts, Recharts 3)/ `stat`(Tremor)/ `timeline`(react-chrono)/ `flow`(React Flow)/ `form`(RJSF)/ `diff`(deep-object-diff + react-diff-view)/ `kanban`(dnd-kit)/ `markdown`(react-markdown / Streamdown)/ `detail`(shadcn Sheet/Card);后期:`calendar`(FullCalendar)、`map`(MapLibre)。

## LLM Provider 接入(已定)

**Provider**:GLM Coding Plan(智谱 BigModel)。提供的端点:

| 协议 | Base URL | 是否使用 |
|---|---|---|
| **OpenAI Chat Completion** | `https://open.bigmodel.cn/api/coding/paas/v4` | ✅ **暂时只兼容这个** |
| Anthropic Message | `https://open.bigmodel.cn/api/anthropic` | ❌ 暂不兼容 |
| OpenAI Response | `https://open.bigmodel.cn/api/v1` | ❌ 暂不兼容 |

**API Key**:本地文件 `/Users/mike/.secrets/glm_coding_plan_key`(在仓库外;运行时读取,严禁把 key 拷入仓库、写入日志或提交)。

接入方式:AI SDK 用 OpenAI 兼容 provider(`createOpenAI({ baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4', apiKey })`);B4 场景(无效 API key 的 401 如实进入对话)即以这套端点为验证对象。

## Agent 侧接口(不自造线协议)

1. **固定协议动词**(≈5 个,全应用通用):`navigate(rel)` / `exec(action, params)` / `clarify(fields)` / `render(spec)` / `done(summary)`;
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
