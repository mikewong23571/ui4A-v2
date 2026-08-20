# T1 工程基建 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD:每个实现任务先写失败测试)。状态:`[ ]` 待办 / `[~]` 进行中 / `[x]` 完成(附 commit 短 SHA)。

## Phase 1: Monorepo 骨架与共享通路

- [ ] Task: 搭建 pnpm workspaces 根骨架
  - [ ] 写 `pnpm-workspace.yaml`、根 `package.json`(scripts: check/dev/e2e)、`tsconfig.base.json`(strict)、`.gitignore`、`.env.example`
  - [ ] 验证:`pnpm install` 成功且根脚本可执行
- [ ] Task: 建立 packages/shared(TDD)
  - [ ] 先写 vitest 失败测试(占位函数 `APP_NAME`/`VERSION` 等)
  - [ ] 实现 shared 包使测试转绿;package.json 导出类型与入口
- [ ] Task: 建立 apps/web(Next.js 壳,接入 shared)
  - [ ] create-next-app 非交互脚手架(App Router / TS strict)
  - [ ] 首页占位(标题含 "UI4A"),import shared 的 VERSION 渲染在页面
  - [ ] vitest:shared 引用断言测试
- [ ] Task: 建立 apps/worker(空壳心跳进程,接入 shared)
  - [ ] 先写失败测试(心跳函数纯逻辑:间隔计算/退出信号处理)
  - [ ] 实现 tsx 入口:启动打印心跳(含 shared VERSION),SIGINT 干净退出
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase 2: PostgreSQL 与运行环境

- [ ] Task: docker compose 提供 PostgreSQL(TDD:连通性测试先行)
  - [ ] 先写失败测试(用 pg 客户端对 compose 库执行 `SELECT 1`)
  - [ ] 写 `docker-compose.yml`(postgres alpine 稳定版、healthcheck、固定端口)、`.env.example` 补 `DATABASE_URL`
- [ ] Task: `/api/health` 端点含 db 检查(TDD)
  - [ ] 先写失败测试(route handler 单测:有库时 `{status:"ok",db:"ok"}`,无库时 `db:"error"` 不抛 500)
  - [ ] 实现 health route(pg 池 + `SELECT 1`,失败降级)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase 3: 质量门、E2E 基座与文档

- [ ] Task: 质量门(typecheck + lint + 聚合脚本)
  - [ ] eslint flat config + prettier;`tsc --noEmit` 全 workspace;根 `pnpm check` 聚合
  - [ ] 验证:`pnpm check` 在有 lint 违例样例时失败,清理后全绿
- [ ] Task: Playwright E2E 骨架与首页 smoke(TDD)
  - [ ] 初始化 playwright(webServer 配置复用 dev server,CI=true 单次)
  - [ ] smoke 测试:访问 `/` 得 200 且标题含 "UI4A";访问 `/api/health` 得 `status: "ok"`
- [ ] Task: 文档落地
  - [ ] 根 `README.md` quickstart(3 条命令:install / compose up / dev)
  - [ ] `conductor/workflow.md` Development Commands 替换为真实命令
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)
