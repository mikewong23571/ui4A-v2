# T50 定义提案合同自披露 — Plan

> 执行纪律:严格 TDD;每任务 commit + git note;Phase 结束跑 Checkpoint(workflow.md
> 自治代行);GR1–GR5 全程生效。红线现状:`apps/web/src/engine/drafts/views.ts` 496/500
> ——本 track 再触碰必须先拆解(D53);`definition/bundle/` 与 `definition/` 目录余量
> 已核对。验收纪律:governance 显式 EXIT 核验,禁止 pipe 吞码(T48 教训)。

## Phase 0 — 决定先行

- [ ] Task: DECISIONS.md 落盘 D69(spec §3 全文:注解落位/有界 schema/拒绝数据化/守卫/语法糖)
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 1 — engine:有界 schema 与 example 派生(纯)

- [ ] Task: `applicationBundlePayloadSchema()` + example(definition/bundle/,新文件)
  - [ ] 红测:结构层覆盖(顶层必填键/类型/seed 条目四必填);深层区域开放;序列化尺寸上限断言;example 可被 parseApplicationBundle 接受(自洽)
  - [ ] 绿:实现 + barrel 导出;`CI=true pnpm vitest run packages/engine/src/definition/bundle`
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 2 — shared+engine:拒绝数据化

- [ ] Task: `DraftValidationIssue.expected?`(packages/shared)+ 形状类解析错误携带期望数据
  - [ ] 红测:seed 条目形状错误 issue 含 expected 结构;顶层必填键缺失同理;机械 message 文案不变(断言原文)
  - [ ] 绿:实现(adapter 层从 parse 错误映射 expected);shared/web/db typecheck
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 3 — web:动作注解落位(views.ts 触碰前先拆解)

- [ ] Task: views.ts GR3 拆解准备(若注解装配使 views.ts >500,先沿功能边界抽出 action-schema 装配模块)
- [ ] Task: create/revise 动作 payload 字段挂 `x-ui4a-payload-schemas` 注解
  - [ ] 红测(web 合同):`meta/drafts` create/revise fields 含注解,application-bundle 分支含 schema+example;flow/agent 分支宽松如旧;RJSF 消费面零变化(component 测试)
  - [ ] 绿:实现
- [ ] Task: chat 工具面证据(meta-parity 测试扩展)
  - [ ] 红测:action_create 工具 schema 的 payload 字段携带同一注解(逐字节等值)
  - [ ] 绿:预期免改(投影保留原字段 schema),测试固定
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 4 — 守卫(GAP-4)

- [ ] Task: application-bundle target 裸名守卫
  - [ ] 红测:`--target application:foo` guard-failed + rejectionEvent 留痕;非法字符同判;裸名不受影响;激活重验同判(竞态路径)
  - [ ] 绿:实现(IDENTIFIER 常量与 flow genesis 共用提取)
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 5 — CLI 语法糖

- [ ] Task: `drafts schema [--kind]`
  - [ ] 红测:单测(fetch meta/drafts → 打印注解 schema/example;--kind 过滤;无注解时诚实空输出)
  - [ ] 绿:实现;HELP 更新;CLI 测试全绿
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 6 — 双门验收与复盘

- [ ] Task: US1 外置 Agent 自足起草(e2e:隔离配置 CLI,仅用 `drafts schema` 输出构造 payload,create ≤2 次迭代达 ready;对照基线 12 次记录于 evidence)
- [ ] Task: US3 拒绝可行动(合同测试 + e2e:错误 Draft 的 issue.expected 在 CLI envelope 可见)
- [ ] Task: Playwright/browser 门:RJSF 渲染零变化 + 注解在 raw 合同视图可见
- [ ] Task: 愿景对齐评审(spec §6.2 四条;grep 无友好模板字符串拼接)→ evidence 记录
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 7 — 收口

- [ ] Task: 全量门禁:`pnpm check` + `CI=true pnpm e2e` + `CI=true pnpm e2e invariants`(全部显式 EXIT)
- [ ] Task: 文档同步(AGENTS.md drafts 模块行如有新文件;ops 侧 BUNDLE-FORMAT.md 收缩为指针属发布后跟进,登记遗留)
- [ ] Task: 里程碑可运行验证(dev:all 起服实测 US1/US2,证据入 git notes)
- [ ] Task: Track 收口(archive、registry、DONE 摘要引用 evidence)
