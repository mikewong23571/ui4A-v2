# T48 Application Genesis 产品内闭环与 Meta 人机同门 — Plan

> 执行纪律:严格 TDD(先红后绿);每任务完成即 commit + git note;Phase 结束跑
> Phase Checkpoint(workflow.md;审批点由编排 agent 按自治协议代行,验证证据记入
> git notes)。GR1–GR5 全程生效;GR3 红线现状:views.ts 483/500、execute.ts 434/500、
> drafts.test.ts 714/800——涉及文件变更时必须沿功能边界拆解,新测试放独立文件。
> 前置:工作区有未提交的 D65(CLI --scope)改动,Phase 0 开始前先核对并单独提交。

## Phase 0 — 决定与文档先行(先记录,再动代码)

- [x] Task: 提交遗留 D65 工作区改动并核对门禁 [b20982c]
- [x] Task: DECISIONS.md 落盘 D66/D67(spec §3 全文:载体/锚定/激活语义/授权推导补充/同门与文档修订) [e6af748]
- [x] Task: GOAL.md「App 创建边界」改写 + conductor/index.md 禁止复活清单修订 + T39 北极星修订注记(D67 记录,归档按 GR5 只读) [3de6142]
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: 3de6142]

## Phase 1 — 合同层:application-bundle Draft kind

- [x] Task: packages/shared + packages/db — kind 联合与 Draft 存储面扩展(测试先行) [a27c83]（shared 已含该值,db kind 无关;新增 lifecycle/重放幂等测试直接绿）
- [x] Task: apps/web engine/drafts/views.ts — create 动作与投影扩展 [13b4b8]
- [x] Task: apps/web engine/drafts/create.ts — application-bundle 校验与冲突 guard [13b4b8]
- [x] Task: revise/validate/diff 路径覆盖 application-bundle [13b4b8]（GR3 拆解 application-bundle.ts;engine 纯校验器 validateApplicationBundleDraft）
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: 13b4b8]（自治验收:20/20 复跑绿+governance OK;改动文件均有对应测试）

## Phase 2 — 激活事务:人类 approve → 原子 seed 事件

- [x] Task: packages/db — 多事件原子激活计划(测试先行) [75247a0]（AtomicCoreMutationPlan 数组合同统一,GR2 消除单/双形态;回滚/重试覆盖）
- [x] Task: apps/web engine/drafts — application-bundle 激活分支(execute.ts 沿功能边界拆出 activate-application/flow/agent) [75247a0]（449→352 行;锁内重验+planMetaBootstrap 原子落库;I4/竞态 stale 留痕）
- [x] Task: 重放与完整性 [75247a0]（applications/sitemap 生长;assertMetaBootstrapIntegrity;receipt 幂等重跑空;I5 全 log 重放一致）
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: 75247a0]（自治验收 27+4 绿;补救:definition/ GR3 超限→definition/bundle/ 子目录 [31d78f8]）

## Phase 3 — 授权推导:治理角色展开(D66.4)

- [x] Task: apps/web auth/request-identity.ts — credential 授予集合治理展开 [5b560a]
- [x] Task: meta exec/entity credential 合同测试扩展 [5b560a]（治理凭证激活后立即可达新 app+新 lens 写;逐 app 对照 422;空集合语义不变）
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: 5b560a]（自治验收 30/30;补救:db/src GR3 超限抽 src/drafts/ [650e707];验收纪律修正:governance 显式 EXIT 核验）

## Phase 4 — flow-definition genesis(D67.3)

- [x] Task: create.ts — target 不存在时允许新 flow 提案 [d84637]（名称/lens 校验+I6 留痕;修订路径零变化）
- [x] Task: 激活分支 — 新 flow 的 definition-seeded v1 事件 [d84637]（复用 planMetaBootstrap 提取的 flowSeedEvent,同种事件;sitemap/flow-entry 生长;I5 一致;竞态 stale）
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: d84637]（自治验收 27/27;补救:auth/ GR3 超限→auth/browser/ [863785f]）

## Phase 5 — Meta UI 人机同门(D67.1/D67.2)

- [x] Task: GenericCollectionRenderer 渲染集合级 actions [0a41ac]（复用 MetaActions;空集合零渲染;I3 合同驱动;T39 旧断言按 D67 修订）
- [x] Task: application-bundle 人类编辑 schema [0a41ac]（APPLICATION_BUNDLE_EDITOR_SCHEMA 对照解析合同;blocking-fields/merge 复用;零 AI）
- [x] Task: Draft 视图/创建流 kind 支持 [0a41ac]（view-model 天然通用,component 测试固定;创建→详情经 onChanged 刷新）
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: 0a41ac]（自治验收 meta 127/127;t22 脚本路径跟进 [9b61f9]）

## Phase 6 — 同门闭环验收(两门同跑;agent 双通道端到端)

- [x] Task: CLI application-bundle 全环(G3/US9,agent 门) [13ec06]
- [x] Task: Chat 同门故事(US6) [92c3a7]（P6b 结论(b)边界固定:同门/同裁决机械证明）+ lens 通道收口 [e19af6]（P6b-2:situation lens 注入 meta exec,D66 附录;US6 全链 draft-created actor=agent;presence 隔离修复含投毒 A/B）
- [x] Task: Playwright Golden Story(US1–US3 浏览器门;agent 验收路径的可重放回归镜像) [10b71f]
- [x] Task: agent 同门与不变量扩展(US5/US8) [13ec06]（批准即发现 apps/flows/activation/sitemap 4/4;I3/I4/I5/I6 断言在 P1–P4 合同测试）
- [x] Task: 端到端 agent 双通道验收(US10;编排 agent 代行,逐步留痕) [78903b]（浏览器门 agent-browser + CLI 门,14 步表+6 截图+事件链 552–563）
- [x] Task: 第一性原理路径审查(US10;spec §6.8 清单) [78903b]（八条全过,零产品缺陷,结论入 evidence）
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: e19af6]（自治验收:3/3+154/154+299/299+GOV=0）

## Phase 7 — 收口

- [ ] Task: 全量门禁:`pnpm check`(governance:strict)+ `CI=true pnpm e2e` + `CI=true pnpm e2e invariants`
- [ ] Task: 文档同步(AGENTS.md 模块图如新增文件;DECISIONS/GOAL 引用核对)+ conductor-review 修复环
- [ ] Task: 里程碑可运行验证:`pnpm dev:all` 起服,浏览器实测 US1–US3(自治验收,证据入 git notes)
- [ ] Task: 部署站双通道复核(按 DEPLOYMENT.local.md 标准升级流程;不阻塞本地 DONE,是否当次发布由用户裁定)
  - [ ] 固定 SHA 构建 linux/amd64 images → home preflight/up/status → 公网验收合同
  - [ ] agent 在公网站点重跑双通道走查(浏览器人类门 + CLI 设备凭证 agent 门),证据追加 evidence/
- [ ] Task: Track 收口(archive、registry 状态更新、DONE 摘要引用 evidence 文件与第一性原理审查结论)
