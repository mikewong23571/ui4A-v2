# T26 工作线投影 — Plan

> 遵循 `conductor/workflow.md` 的 Story TDD、任务提交、Git notes 和 Phase Checkpoint 协议。
> spec:`./spec.md`(含代码锚点与 spike 五问候选,实施前以仓库现状复核)。
> TDD 顺序:每 Task 先 Red(fold/投影/合同测试),再 Green。每 Phase 结束复跑
> `pnpm check` 与 `CI=true pnpm e2e invariants`。
> Phase B–D 的具体形状以 Phase A 的 DECISIONS 条目(D44)为准;若 spike 结论
> 改变任务内容,先按 Task Correction 流程修订本计划再施工。

## Phase A: Spike → DECISIONS(分歧先于代码) [checkpoint: 8d9145e]

- [x] Task: spike 五问决断,落 DECISIONS.md D44 e79d352
  - 按 spec.md Phase 0 五问逐一给出:候选、约束、采纳、否决项与理由;
    核心抉择:成员资格显式引用的载体(线实体 attach/detach action vs
    exec/goal 携带 thread 字段 vs turn 继承)、生命周期事件界定、
    policy scope 归属(`relCoveredByPolicyScope` 对跨应用 rel 的放行方式)
  - 可用纯函数原型验证成员资格 fold 语义(不提交或提交为 spike 测试);
    锚点:spec.md"现状事实"节
  - 验收:DECISIONS.md 新增条目,编号顺延(当前最新 D43);五问各有明确
    采纳/否决;否决项写明理由(防复辟)
- [x] Task: spec/plan 回改对齐 D44 8d9145e
  - 若 spike 结论改变"最终形态"表述或后续 Phase 任务形状,同步修订
    spec.md 与本 plan;tracks.md 无需动(本 Track 已登记)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) 8d9145e

## Phase B: 事件与 fold 内核(纯投影) [checkpoint: f9d4eb8]

- [x] Task: thread 事件 schema 与双 union 登记 53d579d
  - `packages/shared`:D44 四种事件 detail 类型(`thread-created`/
    `thread-reference-attached`/`thread-reference-detached`/
    `thread-status-changed`;goal 原文/来源、显式 category+rel、生命周期状态;
    字段白名单、尺寸有界——参照
    `MAX_PRESENCE_VALUE_LENGTH` 的口径定上限)
  - 双 union 同步:引擎 `LogEventKind`
    (`packages/engine/src/projection/fold/log-event.ts`)+ web `EventKind`
    (`apps/web/src/db/events.ts`);core domain,`readLog`/`toLogEvent` 直过
  - Red:非法 kind/超界载荷/缺锚引用一律拒绝的解析测试
- [x] Task: `apply-thread.ts` + fold case + snapshot 表 4c4d510
  - `packages/engine/src/projection/fold/apply-thread.ts`(参照
    `apply-confirmation.ts`);`fold()` 新 case(显式,不静默);
    snapshot 新表恒携带(`initial.threads ?? {}`,样板:delegations 合并)
  - 成员资格 fold 严格按 D44 主规则:只消费事件中的显式 thread 引用,
    零 `if type === …` 分支;未知 kind 仍抛错
  - Green:fold 单测(建线/四类挂载/幂等 detach/状态迁移/归档/owner 拒绝);
    重放测试:重建与增量
    fold 一致,空日志 → 空表(合法态);乱序/迟到 seq 容忍
    (worker 第二写者形态,参照 service.ts:316-333 交换性论证)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) f9d4eb8

## Phase C: 合同暴露(实体/sitemap/授权/I5) [checkpoint: 832d33d]

- [x] Task: 闭式 sitemap 断言开放化(前置纠偏,spec"误导性验收排查") 9a6b3c6
  - `e2e/s2-meta.spec.ts:297-310` 与 `apps/web/src/app/api/contract.test.ts:204-211`
    的精确 toEqual 改开放断言(存在性/可导航);保绿即禁止 threads 暴露 =
    方向错误,本任务是纠偏原则的首次执行,必须先于 threads 入 sitemap
- [x] Task: `thread:<id>` 与 `threads` 实体投影 eae3573
  - `packages/engine/src/contract/siren/project.ts` `project()` 新分支
    (解析顺序文档见 spec 现状事实);class 参照 `['collection','inbox']`/
    `['delegation', status]` 模式;实体内容按 spec 最终形态 2
    (goal/上下文包/进行中/待批准/事件切片;成员来自 fold,当前状态指针只从
    同一 EngineSnapshot 的 canonical 投影解析,不可解析引用保留 dangling)
  - Red→Green:Siren 形状合同测试(class/links/actions/guard-results)
- [x] Task: sitemap 与授权覆盖 6584bba
  - `apps/web/src/engine/service-sitemaps.ts` `extraSurfaces` 加 `threads`
    (与 inbox/agent-runs 同法,contentVersion 缓存自动生效)
  - `relCoveredByPolicyScope`(`apps/web/src/auth/application-scope.ts`)
    按 D44 第 3 问把 `threads`/`thread:*` 视为 Application-neutral;
    HTTP exact/list/exec 另按可信 principal 校验 owner,credential 模式
    再按当前 policy scope 过滤成员链接
  - 测试:sitemap 出现 threads surface;credentialed 客户端 GET
    `thread:<id>` 不 403;越权 principal 仍被拒
- [x] Task: I5 枚举扩展 832d33d
  - `e2e/invariants.spec.ts` `enumerateEntityRels` 纳入 `threads`/`thread:*`;
    在线/重放 hash 一致(除新增投影表外与现状等价)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) 832d33d

## Phase D: 锚定接线(形状以 D44 为准) [checkpoint: e71689e]

- [x] Task: 线实体动作经正常 exec 裁决 d6f1e4e
  - `threads#create` 与 `thread:<id>` 的 attach/detach/pause/resume/complete/
    archive 走 declaration → guard → schema 正常裁决链;human/agent 同权
    (I4 不受影响:approve 仍 human-only),可信 principal 固定 owner
  - 测试:action 合同测试 + 拒绝留痕(I6 口径)
- [x] Task: chat/exec 入口的 thread 显式记录 e71689e
  - presence.thread 仅为当前 user message 选择一条已存在且同 owner 的线;
    另写独立 `thread-reference-attached(category=context)` core 事件并记录
    resolved id/source,不让 turn 后续副作用继承;不修改 chat detail wire 形状
  - 测试:无 clientView 的 exec(CLI 形态)显式锚定落库;有 presence 的
    chat 回合落库事件携带同一显式锚
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) e71689e

## Phase E: 端到端验收与收尾

- [x] Task: CLI 对照全流程 30edab0
  - 经 CLI(显式 thread 锚,无 presence)完成建线/挂载/查态/审计;
    同一场景人类经 chat + presence 锚跑一遍(GOAL.md 双执行者口径);
    两侧投影一致
- [~] Task: 全量验收
  - `pnpm check` 全绿;`CI=true pnpm e2e invariants` 全绿;chat 套件
    (`e2e/chat.spec.ts`)全绿;I5 含 threads 通过
  - 系统可运行验证:`pnpm dev:all` 实际启动走查(里程碑约束)
- [ ] Task: Track 收尾
  - `conductor/tracks.md` 状态流转;track 目录按 GR5 处置(无 bespoke
    脚本/配置残留);metadata.json 归档

## 验收标准(Track DoD)

1. spike 五问落 DECISIONS.md(采纳与否决项齐全),spec/plan 与之一致;
2. `threads`/`thread:<id>` 为纯 fold 投影:重放可重建、终态 hash 一致、
   未知 kind 不静默、多写者乱序容忍;
3. 成员资格只由事件显式引用聚合,零每类型/每应用特判;presence 仅入口默认;
4. 合同暴露:sitemap 含 threads surface;credentialed 客户端 scope 覆盖;
   I5 枚举纳入;CLI 无 presence 完成全流程,人机两侧投影一致;
5. 除新增投影表外重放 hash 与现状等价;`pnpm check` +
   `CI=true pnpm e2e invariants` + chat 套件全绿;系统实际可运行。
