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
