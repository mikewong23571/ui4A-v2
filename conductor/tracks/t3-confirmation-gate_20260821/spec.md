# T3 确认门切片 — Spec

> Track ID: `t3-confirmation-gate_20260821` · Type: Feature · 状态: approved(编排 agent 代行验收)
> 上下文:`conductor/refs/arch-brief.md` §3(guard 第三语义:通过/拒绝/挂起;requires-confirmation 是策略标注)、§9.1(确认门切片构成与 S1 断言)、§11 铁律 5(审批不委托)。

## Overview

实现确认门:agent 执行高风险动作 → **挂起为 pending 确认实体(动作不生效)** → notify(Temporal activity)→ 人类在收件箱 approve(actor=human)→ 动作生效;日志含 actor/principal/信道。**S1 + I4 全链路自动化通过。**

构成(README):guard 挂起语义 + pending 确认实体 + notify(Temporal activity)+ 收件箱 + Cedar 风险策略 + actor/principal 入日志(T2 已有,自报口径见 D8)。

## 架构决定

1. **挂起语义位置**:exec 三层裁决通过后、效果应用前,插入**确认裁决**(第四步,策略层):action 声明 `requires-confirmation` 且策略判定该 actor 需要确认 → 不应用效果,产出 `confirmation:<id>` 实体(pending),事件 `confirmation-requested`(含原请求、提议者 actor/principal、信道);exec 响应 202 形态(挂起,非拒绝)。
2. **确认实体**:`confirmation:<id>` Siren 实体,properties 含目标 rel/action/params/提议者/时间;actions:`approve`(guards: **actor-is-human**)、`reject`(必填 reason,同 guard)。approve → 应用原效果 + 事件 `confirmation-approved`(链:proposed-by agent, approved-by human)+ `action-executed`(actor=human,principal 同提议者 principal——委托语义);reject → `confirmation-rejected`,原动作不生效。**I4:agent 身份 approve 被 guard 层拒绝且留痕。**
3. **Cedar 风险策略**:`@cedar-policy/cedar-wasm`(官方 npm);策略即数据(文本存 `apps/web/src/domain/policy.cedar` 初始版):high 风险动作 + actor==agent → 需要确认;human 直接执行。裁决调用 `isAuthorized` 求值,决策与原因入事件 detail。**策略文本后续可挪 _meta(T4+),T3 以文件常量起步。**
4. **Temporal**:apps/worker 从心跳壳变真 worker(@temporalio/worker);web 侧 exec 产出 `spawn-requested`(capability: notify)事件后,通过 Temporal client(startWorkflow `notifyWorkflow`,taskQueue `ui4a`)派发;worker 跑 activity:notify(inbox 写入——demo 口径:Web Push/SMTP 以后加,先收件箱+日志事件 `notification-delivered`)。worker 与 web 共享 @ui4a/engine fold(通知落库走同一事件日志——通知也是提议,过裁决)。**双写者问题(service.ts 头注与评审 Low #2):通知事件写入收敛为 web 侧单写——worker 完成后回调 web 的内部端点?不——worker 直接 appendEvent 到同一 PG(appendEvent 是幂等插入,不碰内存快照;web 下次 fold/增量由事件流驱动)。设计:web 启动时 fold 全量,exec 增量;对 worker 追加的事件(confirmation/inbox),web 在读路径(entity 查询)时按 seq 检查新事件增量 fold(事件驱动失效)。报告最终方案并记录。**
5. **收件箱**:`inbox` 集合实体(confirmation 实体的 pending 视图,guard-results 注入 actor-is-human 求值);UI:RJSF 渲染(复用 T2 通用实体页 + 首页入口)。
6. **种子域调整**:`post-status` 的 `archive` 已带 `requires-confirmation: "high"`(T2 预埋,生效于本 track);B 场景回归不受影响(human 直接 archive 不挂起)。

## Acceptance Criteria

1. `CI=true pnpm check` 全绿;`CI=true pnpm e2e` 全过(既有 12 + S1 新增);
2. **S1 E2E(agent 走合同)**:agent exec archive post-welcome → 响应挂起形态、文章仍是 published(动作未生效)、`confirmation:<id>` 实体存在(pending)、事件链 confirmation-requested(actor=agent);human approve(经 /api/exec,actor=human)→ 文章 archived、事件 confirmation-approved + action-executed(actor=human)、日志含 actor/principal/信道;
3. **I4 E2E**:agent exec approve on confirmation → guard 拒绝(actor-is-human),事件留痕,confirmation 仍 pending;
4. **notify 链路**:confirmation-requested 后(≤数秒)inbox 实体可见该确认(notification-delivered 事件存在);worker 进程活着(`pnpm --filter @ui4a/worker dev` 需在 temporal dev server 上运行);
5. **Cedar**:策略文本变更(如 medium 也需确认)能改变裁决行为(策略即数据测试); Cedar 求值原因入事件;
6. **B1–B3 回归**:人类路径与 agent 路径全部仍过(human archive 不挂起);
7. reject 路径:human reject 带 reason → 原动作永不生效,事件 confirmation-rejected。

## Out of Scope(非目标)

- Keycloak/token 交换(移至 T5,记 DECISIONS D9;S1/I4 验收不依赖);
- Web Push/SMTP 物理送达(notify activity 先收件箱+日志,demo 口径);
- _meta/定义平面(T4);渐进信任账本(trust-ledger,T4+ policies 实体);
- 舰队页/多委托(T5); Cedar 细粒度 scope DSL(policies 实体化时做)。
