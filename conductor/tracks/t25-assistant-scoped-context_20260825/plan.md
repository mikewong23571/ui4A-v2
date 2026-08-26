# T25 Assistant 上下文收窄 — Plan

> 遵循 `conductor/workflow.md` 的 Story TDD、任务提交、Git notes 和 Phase Checkpoint 协议。
> TDD 顺序:每 Task 先 Red(纯函数/源码门禁测试),再 Green。每 Phase 结束复跑
> `pnpm check` 与 `CI=true pnpm e2e invariants`。spec:`./spec.md`。

## 实施者读本(自包含;实施过程无此前聊天上下文,以此为准)

文档权威序(`conductor/index.md`):`GOAL.md` → `DECISIONS.md` →
`conductor/product-vision.md`(北极星,本 Track 的方向裁判:§一.2/§一.3/§五/§八)
→ `conductor/refs/arch-brief.md` → 本 Track spec/plan → 归档 Track(历史证据)。

依赖 Track 文档:T29 `conductor/tracks/archive/t29-presence-situation_20260825/`
(spec/plan 全读;处境装配与 clientView 协议 v2 是本的输入)、T24
`conductor/tracks/t24-presentation-honesty_20260825/`(失败分层对接点)。

代码锚点核对基线:HEAD `4e3e2ef`(2026-08-26);spec「现状事实」节列出全部
锚点,实施前以仓库现状复核(尤其 `apps/web/src/app/api/chat/route.ts` 行号
会漂移,按符号定位:`resolveStartRel` 调用点、`situationForChat` 调用点)。

施工约束(违反复工):派发 subagent 遵守 workflow.md「Subagent Prompt 合同」
四要素;治理门禁 `pnpm governance` 全绿,`route.ts` 为 shrink-only 基线(新逻辑
落新模块,确需超限由编排 agent 登记 `scripts/governance/size-baseline.json`,
subagent 不自行核算/裁剪);改动 Next.js app 前先读 `apps/web/AGENTS.md` 指向的
`node_modules/next/dist/docs/` 相关篇章;风格遵守 `conductor/code_styleguides/`。

## Phase A: 决策落档与起点即事实 [checkpoint: dc09427]

- [x] Task: DECISIONS.md 落档(新条目,先于代码) b1c110c
  - 修订 D33 条款"合同 discovery 的 `resolveStartRel` 不被 client view 机械
    改写":resolveStartRel 删除,起点链以处境事实(presence focus)为首级,
    属"上下文来自结构化事实"而非意图猜测;D33 其余条款(双焦点三位置、
    原子重放、AI-first 决策、协议 envelope)不动
  - 落档北极星 §八 CLI 纪律三本 Track 相关两条:披露收窄发生在 prompt 层、
    不窄化 HTTP 合同;delegated 起点/scope 经显式参数传入(显式是正典)
- [x] Task: 起点事实链测试(Red) 62bacd5
  - 新模块(建议 `apps/web/src/chat/start-chain.ts`,纯决策函数 + 薄调用):
    输入 `Situation`(`apps/web/src/engine/situation.ts`)+ 应用定义快照
    (`EngineSnapshot.applications[name].entry`,
    `packages/shared/src/definition/definition.ts:217` 首个消费方);
    链 = focus(string 形 RenderSubject → rel;`{selection}` 形跳过)→
    scope 应用 entry → 站点兜底(business `articles` / meta `meta/flows`)
  - 断言:不 import `match.ts`(零词级交集);全程零 `GET /api/entity` 预探测
    (探测请求数=0);各级缺失时顺序回退;meta 站点兜底 `meta/flows`
- [x] Task: 起点链切换与词级探测退役(Green) c6fc710
  - `route.ts` 两处调用点(inline 回合起步、delegated 派发前)切换到事实链;
    `resolveStartRel` 与 `isDiscoveryOnlyIntent`(已无生产消费方,仅测试引用)
    删除,`apps/web/src/chat/start.ts` 退役,`start.test.ts` 重写为起点链测试
  - `packages/agent/src/governance/t21-source-governance.test.ts` 的反向断言
    改写为新纪律(起点供给只消费处境事实,禁止词级猜测原语进入起点路径)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) dc09427

## Phase B: 分层披露与 prompt 预算

- [x] Task: 披露切片纯函数测试(Red) a8f60e9
  - `packages/agent` 新模块(建议 `src/contract/disclosure.ts`,inline 与
    worker 共用,GR1 方向内):输入 `SitemapSummary`
    (`packages/agent/src/types.ts`)+ scope(= application 名)+ 当前 rel;
    输出 = 当前 scope 切片(surfaces/flows 摘要)+ 其他 scope 导航入口
    (rel + title,无实体全形)+ capabilities 去 inputSchema/outputSchema
    全文(按 rel 引用)
  - 断言:零启发式(仅按 app 归属机械过滤);无 scope 输入时行为 =
    现状 inferEntityApplication 推断(CLI/独立 runAgent 形态不受收窄影响)
- [~] Task: prompt 分层改造(Green)
  - `packages/agent/src/llm/prompts.ts`:`## 当前 app/scope 的动态 sitemap 处境`
    块改发切片视图 + 其他 scope 入口清单;capability schema 全文移出 prompt
  - `packages/agent/src/loop/loop.ts`:inferEntityApplication 段由切片函数承接;
    navigate 工具 enum(`packages/agent/src/protocol/tools.ts`)= 当前切片
    surfaces + 其他 scope 入口 rel + 实体可导航 rel(跨 scope 显式导航可达)
  - chat 路由接线:`situation.scope` 经 runAgent options 传入(`options.app`
    语义对齐:scope 即 application 名,`grantedPolicyScopes` 同口径)
- [ ] Task: prompt 预算断言
  - 纯函数层:`buildLlmMessages` 返回值字节数;wire 层:scripted transport
    `RecordedCall.body`(覆盖 tools 投影体积,模式参照
    `llm-driver.test.ts` 的 `systemPromptOf(calls)`)
  - 典型处境三例:读文章(business scope)、走向导、定义治理(meta scope);
    单次 decide 请求 ≤ 32KB,超限即披露层 bug
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: delegated 同收窄与回合卫生

- [ ] Task: worker delegated 路径收窄(显式正典)
  - `apps/web/src/temporal/delegation.ts` `DelegationDispatchArgs` 增 `scope`
    显式参数(派发方经处境装配算出传入;`startRel` 现状已通,改由 Phase A
    事实链供给);`apps/worker/src/workflows.ts` `AgentStepArgs` 传递;
    `apps/worker/src/delegation.ts` DriverContext 构造应用 Phase B 同一切片
    函数(两路径同一实现,测试切面断言)
- [ ] Task: 单回合 sitemap 单读归并
  - resolveStartRel 的 sitemap 抓取已随 Phase A 删除消失;归并 runAgent 循环
    外抓取(loop.ts)与 `readSitemapTitles`(route.ts,step 活动标题索引,
    `apps/web/src/chat/step-activity.ts`)为单回合一次读取
- [ ] Task: 失败语义回归测试
  - 事实链起点实体不可得 → `start_entity_unavailable` 诚实失败路径保留;
    失败 code 集合不变(`apps/web/src/chat/failure-reason.ts`):
    `no_progress_loop / driver_fail / start_entity_unavailable / loop_exception`
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: 端到端验收

- [ ] Task: 回归用例与全量验收
  - "新增一篇文章…介绍操作流程"端到端完成且无 meta 越界(北极星 §一.2 反例;
    e2e 断言全程不出现 meta sitemap 导航)
  - 起点解析断言:presence focus 优先、探测请求数=0(e2e/路由测试口径)
  - `pnpm check` 全绿;`CI=true pnpm e2e invariants` 全绿;chat 套件
    (`e2e/chat.spec.ts`)全绿;T15 Story Eval 门槛(`pnpm eval:llm`,
    真实 LLM,opt-in)通过
- [ ] Task: Track 收尾
  - `conductor/tracks.md` 状态流转;track 目录按 GR5 处置(无 bespoke 脚本/
    配置残留);metadata.json 归档

## 验收标准(Track DoD)

1. 单次 decide 请求 ≤ 32KB(wire 级断言,含 tools 投影),典型三处境全过;
2. 分层披露:当前 scope 切片为唯一全形披露;其他 scope 仅 rel+title 入口;
   capability schema 全文不进 prompt;navigate 可达其他 scope 入口且留痕;
3. 起点即事实:focus → scope entry → 站点兜底;词级交集与预探测移除
   (探测请求数=0);D33 修订与 CLI 纪律已落 DECISIONS.md;
4. inline 与 delegated 两路径共用同一切片实现(测试切面证明);
5. 失败语义不变:code 集合不变,诚实失败路径保留,拒绝仍即数据;
6. 零每应用/每实体类型特判(代码扫描 + review);HTTP 合同对外行为不变;
   `pnpm check` + `CI=true pnpm e2e invariants` + chat 套件全绿。
