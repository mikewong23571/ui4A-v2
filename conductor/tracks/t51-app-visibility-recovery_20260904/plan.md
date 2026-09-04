# T51 新生应用可见性恢复链路 — Plan

> 执行纪律:严格 TDD(先红后绿);每任务完成即 commit + git note;Phase 结束跑
> Phase Checkpoint(workflow.md;审批点由编排 agent 按自治协议代行,验证证据记入
> git notes)。GR1–GR5 全程生效。**工作区隔离**:T50 有未提交改动
> (draft-action-schemas*、activate-application.ts、application-bundle*、create.ts、
> helpers.ts、views.ts、drafts.ts、chat route.meta-parity.test.ts、
> vitest.db-tests.list.ts)——本 track 不触碰这些文件,提交时显式圈定路径。
> 披露计算放路由组合层(exec 前后 snapshot 应用全集 diff),与 drafts 内部零耦合。
> **暂存状态(2026-09-04 设计复审后暂停)**:P1 Task 1 已提交(c045ba57,其 tsc
> 类型修正在暂存 patch 内);P1 Task 2 已实现未提交,完整备份 `/tmp/t51-p1-parking/`
> (patch 已验证可干净 apply);恢复时先 apply + 复跑 30/30 再收口。本计划已按
> 设计复审 F1–F3 修订(edge 白名单任务、e2e 独立文件、文档同步、relogin 判定泛化)。

## Phase 0 — 决定与 track 工件

- [x] Task: DECISIONS.md 落盘 D70(spec §3:披露口径/auth 平面控件/投影端点/刷新授权语义) [ad16630]
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: ad16630]（自治验收:决定先于代码;track 工件 b9ad3fc9 已注册;文档变更无代码测试需求）

## Phase 1 — F1 服务端:激活披露纯函数 + meta exec 响应

- [x] Task: `apps/web/src/auth/activation-disclosure.ts` 纯函数(测试先行:三分支 ×
  多应用混合 × local(undefined browserScopes)× 空 diff;US1.2) [c045ba5→334ff6c]（F2-3
  泛化修订(治理词或 `ui4a:policy:<app>` 任一 ∈ 登录 scope 表,+1 测试)随 Task 2 收口;
  tsc 类型修正由 T50 收口先行合入)
- [x] Task: meta exec route 接线(approve accepted 后 diff 应用全集 → disclosure 字段;
  合同测试:production-auth 注入 config 覆盖 relogin/idp 分支,local 覆盖 immediately;
  现有 route 测试回归;US1.1/US1.4/US1.5) [334ff6c]（恢复自 /tmp/t51-p1-parking;31/31
  绿,tsc 绿;patch 中测试文件类型修正与 T50 先行修复冗余,已丢弃）
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: 334ff6c]（自治验收:meta+auth 179/179 绿、tsc 绿、governance OK;改动文件均有对应测试）

## Phase 2 — F2/F3 会话授权面板与刷新授权

- [x] Task: `GET /api/auth/session` 路由(production-auth 测试:200 投影形状含
  governance 展开来源、401 结构化;local 模式 self-reported;US2.1/US2.2/US2.4) [acda3c2]（4/4;非治理不泄露全集/治理展开回显/local/401 结构化）
- [x] Task: `/session` 页面 + 顶栏系统区「我的授权」入口 + 「刷新授权」动作(组件
  测试;local 渲染冒烟;US2.2/US2.3/US3.1) [877aa25]（SessionPanel 4/4 + site-nav
  断言;刷新授权仅 credential 模式,href /auth/login?returnTo=/session）
- [x] Task: edge 路由白名单(设计复审 F1,阻断级):`/session` 入
  `@ui4aPublic` 页面 GET 名单,`/api/auth/session` 入 `@ui4aAuthenticatedRead`
  组(`deploy/compose/edge-routing.caddy`);caddy 配置测试/校验;部署侧
  restart-edge 步骤并入 F6 合同;US2.5 [1cf83ba]（t22 declared-surface 守卫
  TDD 23/23）
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: 1cf83ba]（自治验收:api/auth+components/session+site-nav+auth+t22 共 476 绿/3 skip、tsc 绿、governance OK）

## Phase 3 — F1 前端渲染 + F4 措辞诚实

- [ ] Task: ExecClientResult ok 分支扩展 + execMetaAction 透传 disclosure +
  MetaActivationDisclosure 组件(三分支文案 + 恢复动作链接 + requires-idp-grant
  双路径文案快照;US1.1/US3.1/US7)
- [ ] Task: situation-bar「全部已授权应用」措辞修正 + 应用目录授权出口(测试更新;
  US4.1/US4.2;发现文档过滤回归绿,US4.3)
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 4 — 验收与收口

- [ ] Task: e2e 扩展(设计复审 F2-1:**新建独立 `e2e/t51-*.spec.ts`**,不碰
  `e2e/t48-application-genesis.spec.ts` 避免并行冲突;approve 断言披露渲染;
  /session 页浏览器冒烟;US3.3/US1.3)
- [ ] Task: DEPLOYMENT.local.md §7/变更记录合同更新(F6;US6;含 edge 白名单变更的
  restart-edge 步骤与 /auth/login scope 参数检查;git-excluded 本地文件,不入 commit)
- [ ] Task: 文档同步(设计复审 F2-2):AGENTS.md 系统图补 auth 平面控件与
  /api/auth/session;GOAL.md 修订判定显式记录(参照 T49 收口先例)
- [ ] Task: 全量门禁:`pnpm check`(governance:strict)+ `CI=true pnpm e2e` +
  `CI=true pnpm e2e invariants`;T50 工作区隔离终核
- [ ] Task: Track 收口(archive、registry 状态、DONE 摘要;部署站复核由用户按
  DEPLOYMENT 流程另行裁定)
