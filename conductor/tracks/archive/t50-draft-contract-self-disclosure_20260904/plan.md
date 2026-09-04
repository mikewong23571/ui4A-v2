# T50 定义提案合同自披露 — Plan

> 执行纪律:严格 TDD;每任务 commit + git note;Phase 结束跑 Checkpoint(workflow.md
> 自治代行);GR1–GR5 全程生效。红线现状:`apps/web/src/engine/drafts/views.ts` 496/500
> ——本 track 再触碰必须先拆解(D53);`definition/bundle/` 与 `definition/` 目录余量
> 已核对。验收纪律:governance 显式 EXIT 核验,禁止 pipe 吞码(T48 教训)。

## Phase 0 — 决定先行

- [x] Task: DECISIONS.md 落盘 D69 [1177f6](spec §3 全文:注解落位/有界 schema/拒绝数据化/守卫/语法糖)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [自治验收,见各阶段 git notes]

## Phase 1 — engine:有界 schema 与 example 派生(纯)

- [x] Task: `applicationBundlePayloadSchema()` + example [96a120](definition/bundle/,新文件)
  - [x] 红测:结构层覆盖(顶层必填键/类型/seed 条目四必填/封闭词表 enum);深层区域开放;序列化尺寸上限断言;example 可被 parseApplicationBundle 接受(自洽)
  - [x] 红测(防漂移):**fixture 回环**——派生 schema 结构化接受全部已安装 bundle 工件(todo/ideas/security/walkthrough,fixture 复制入 engine 测试,不 import apps/web)
  - [x] 绿:实现 + barrel 导出;`CI=true pnpm vitest run packages/engine/src/definition/bundle`
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [自治验收,见各阶段 git notes]

## Phase 2 — shared+engine:拒绝数据化

- [x] Task: `DraftValidationIssue.expected?` [96a120](packages/shared)+ 形状类解析错误携带期望数据
  - [x] 设计约束(review F1):**结构化 issue 在 engine 源头产出**——parse 内部错误改造为携带 {code,path,message,expected} 的结构化问题(path 精确到 seed.instances.<key> 等),validateApplicationBundleDraft 透传;**禁止 adapter 侧字符串匹配映射**
  - [x] 红测:seed 条目形状错误 issue 含 expected 结构且 path 指向具体条目;顶层必填键缺失同理;机械 message 文案不变(断言原文);抛出式 parseApplicationBundle 公共行为零变化(既有测试回归)
  - [x] 绿:实现;shared/web/db typecheck
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [自治验收,见各阶段 git notes]

## Phase 3 — web:动作注解落位(views.ts 触碰前先拆解)

- [x] Task: views.ts GR3 拆解准备 [c1a4e](若注解装配使 views.ts >500,先沿功能边界抽出 action-schema 装配模块)
- [x] Task: create/revise 动作 payload 字段挂 [c1a4e] `x-ui4a-payload-schemas` 注解
  - [x] 红测(web 合同):`meta/drafts` create/revise fields 含注解,application-bundle 分支含 schema+example;flow/agent 分支宽松如旧
  - [x] 红测(RJSF 承重墙,review T2):payload 字段从 `{}` 变带注解对象后,**create 表单的 payload 控件形态不变**(widget 选择不漂移,快照/行为断言);若 RJSF 对带注解对象改变 widget,以保持人类表单行为为准调整注解放置
  - [x] 绿:实现
- [x] Task: chat 工具面证据 [1a616c](meta-parity 测试扩展)
  - [x] 红测:action_create 工具 schema 的 payload 字段携带同一注解(逐字节等值)
  - [x] 绿:预期免改(投影保留原字段 schema),测试固定
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [自治验收,见各阶段 git notes]

## Phase 4 — 守卫(GAP-4)

- [x] Task: application-bundle target 裸名守卫 [c1a4e]
  - [x] 红测:`--target application:foo` guard-failed + rejectionEvent 留痕;非法字符同判;裸名不受影响;激活重验同判(竞态路径)
  - [x] e2e 一例(review T3):CLI 面前缀拒绝端到端可见(exit code + envelope + requestId)
  - [x] 绿:实现(IDENTIFIER 常量与 flow genesis 共用提取)
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [自治验收,见各阶段 git notes]

## Phase 5 — CLI 语法糖

- [x] Task: `drafts schema [--kind]` [9a48e8]
  - [x] 红测:单测(fetch meta/drafts → 打印注解 schema/example;--kind 过滤;无注解时诚实空输出)
  - [x] 绿:实现;HELP 更新;CLI 测试全绿
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [自治验收,见各阶段 git notes]

## Phase 6 — 双门验收与复盘

- [x] Task: US1 机械自足证明 [9a48e8]（e2e example 派生一次 create ready;1 vs 基线 12;a2b016 evidence）(review F2:机械证明)——e2e **从注解的 schema+example 程序化合成 payload**(读 required/类型/example 种子,不抄 repo fixture),一次 create 即 ready;步数对照(1 次 vs 基线 12 次)记录于 evidence
- [x] Task: US3 拒绝可行动 [96a120](合同测试 + e2e:错误 Draft 的 issue.expected 在 CLI envelope 可见)
- [x] Task: Playwright/browser 门 [a2b016]（现场验证+截图;RJSF 承重墙 19/19）:RJSF 渲染零变化 + 注解在 raw 合同视图可见
- [x] Task: 愿景对齐评审 [a2b016]（四条过;grep 空）(spec §6.2 四条;grep 扫描范围=本 track 新增/修改的错误面文件,无友好模板字符串拼接)→ evidence 记录
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [自治验收,见各阶段 git notes]

## Phase 7 — 收口

- [x] Task: 全量门禁 [f8a0d5]（check 3913/e2e 76/invariants 19 全 EXIT=0;presence 死锁修复后 golden 套件内绿）:`pnpm check` + `CI=true pnpm e2e` + `CI=true pnpm e2e invariants`(全部显式 EXIT)
- [x] Task: 文档同步 [待本提交]（AGENTS.md drafts 行;ops 收缩登记遗留）(AGENTS.md drafts 模块行如有新文件;ops 侧 BUNDLE-FORMAT.md 收缩为指针属发布后跟进,登记遗留)
- [x] Task: 里程碑可运行验证 [a2b016]（dev:all 现场实测 US1/US2）(dev:all 起服实测 US1/US2,证据入 git notes)
- [x] Task: Track 收口 [待本提交](archive、registry、DONE 摘要引用 evidence)
