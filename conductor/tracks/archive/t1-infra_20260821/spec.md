# T1 工程基建 — Spec

> Track ID: `t1-infra_20260821` · Type: Chore · 状态: approved(编排 agent 代行验收,见 workflow.md 自治编排协议)

## Overview

建立 UI4A v2 的工程地基。T1 结束时系统以"空壳可运行"状态存在:Next.js 壳可启动并连通 PostgreSQL、worker 进程可空转、测试与质量门全绿。后续所有 track(T2–T8)在此地基上施工。

布局遵循 `DECISIONS.md` D1–D4:pnpm workspaces monorepo(`apps/web` + `apps/worker` + `packages/shared`),PostgreSQL via docker compose,Temporal 本地 dev server(T3 才引入,本 track 不装)。

## Functional Requirements

1. **Monorepo 骨架**:pnpm workspaces;根级 `package.json`(workspaces 脚本)、`pnpm-workspace.yaml`、TS strict 基座配置(`tsconfig.base.json`)、`.gitignore`、`.env.example`;
2. **packages/shared**:TS 库,导出占位模块(如 `VERSION` 常量与一个纯函数),由 web 与 worker 双双引用——验证全栈共享通路(谓词共享的地基);vitest 单测;
3. **apps/web**:Next.js(App Router,create-next-app 脚手架,TS strict),含 `/api/health` 端点:返回 `{ status, db }`,db 为对 PostgreSQL 的 `SELECT 1` 连通性检查;首页为占位页(标题含 "UI4A");
4. **apps/worker**:独立 Node 进程空壳(tsx 运行),启动即打印心跳日志(间隔数秒),`Ctrl-C` 干净退出;import shared 以验证引用;
5. **docker compose**:`postgres`(稳定 alpine 版)服务,固定端口,healthcheck;`docker compose up -d` 即可用;
6. **测试基座**:vitest(web/shared 单测,`CI=true` 单次执行);Playwright E2E 骨架 + 首页 smoke 测试(200 + 标题断言);
7. **质量门**:`tsc --noEmit` 全 workspace;eslint(flat config)+ prettier;聚合脚本 `pnpm check` = typecheck + lint + test,全绿才算过门;
8. **文档**:根 `README.md` 增 quickstart(3 条命令);`conductor/workflow.md` 的 Development Commands 段落替换为本仓库真实命令。

## Non-Functional Requirements

- 所有命令非交互(`CI=true` / `--yes` 类标志),可无人值守重复执行;
- 依赖版本以脚手架当前稳定版为准,实际版本记录在任务总结(git note)中;
- 端口与连接串集中在 `.env.example` 文档化,代码不硬编码。

## Acceptance Criteria

1. `pnpm install` 成功;`pnpm check` 全绿(typecheck + lint + vitest);
2. `docker compose up -d` 后 `pnpm dev` 启动 web,`curl http://localhost:3000/api/health` 返回 `{"status":"ok","db":"ok"}`;
3. `pnpm --filter worker dev` 可启动,输出心跳日志,可正常退出;
4. `CI=true pnpm e2e`:Playwright smoke 通过(首页 200 + 标题含 "UI4A");
5. shared 包被 web 与 worker 同时 import,占位函数有单测覆盖;
6. `README.md` quickstart 与 `workflow.md` Development Commands 与实际命令一致。

## Out of Scope(非目标)

- 任何业务平面逻辑:引擎、事件日志、Siren 投影、裁决(T2);
- Temporal worker 实际逻辑与依赖(T3;worker 本 track 只是空壳);
- Keycloak / Cedar(T3);
- shadcn/UI 组件、骨架五面、聊天 UI(T7;首页仅占位);
- CI 平台接入(GitHub Actions)——本地 `CI=true` 脚本即可;
- pre-commit hooks(husky)——靠 `pnpm check` 质量门。
