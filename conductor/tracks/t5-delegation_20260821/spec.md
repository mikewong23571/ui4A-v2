# T5 委托实体切片 — Spec

> Track ID: `t5-delegation_20260821` · Type: Feature · 状态: approved(编排 agent 代行验收)
> 上下文:`conductor/refs/arch-brief.md` §9.3(切片主张:Temporal workflow 即委托实体;裁决器即并发控制;人类监控成本不随 N 超线性)、§3(Temporal 吞掉宿主协议:认领/租约/心跳/幂等/重试/补偿全内建)、§4(事件历史即轨迹);GOAL S3 断言。

## Overview

agent 执行迁入 Temporal workflow:**委托 = workflow,事件历史 = 轨迹,崩溃续跑 = 平台特性**。并发裁决(一个成功一个带原因的拒绝)、杀掉执行中的委托后续跑、N 路并行、舰队队列页。**S3 全链路自动化通过。**

## 架构决定

1. **delegationWorkflow**(apps/worker):args {goal, driverKind('rule'|'llm' 极小集——T5 主用 rule;llm 模式允许直传已有 llm driver 配置,行为与 inline 等价), startRel, principal, maxSteps};内部循环 = @ui4a/agent 的 driver 决策 + **每步一个 activity**(`execStep`:fetch 引擎 /api/entity+/api/exec——agent 走合同不变);workflow 代码保持确定性(driver 决策在 activity 内做以兼容 LLM 网络调用——rule driver 决策可留 workflow 内,统一走 activity 更简单,你定并报告)。
2. **委托事件入日志**:每步 activity 产 `delegation-step` 事件(rel=delegation:<workflowId>,detail=操作+结果摘要);首尾 `delegation-started`/`delegation-completed|failed`。**引擎投影 `delegations` 集合**(从事件 fold;properties:goal/status/steps/成功计数)——舰队页数据源之一。
3. **崩溃续跑**:kill worker(SIGKILL)→ 重启 worker → **同一 workflow 从最后完成的 activity 继续**(Temporal durable execution,S3"杀掉执行中的委托,新 agent 从实体续跑"的平台形态);续跑正确性 = 委托事件序列无缺口、目标最终完成。
4. **并发即裁决**:两个并行 delegation 对同一资源操作 → 引擎串行 atom 保证一个成功、另一个 guard/undeclared 拒绝**带原因**入各自轨迹(S3 主断言;引擎既有能力,workflow 层证明)。
5. **web 集成**:/api/chat 增 `mode:'delegated'`(现有 inline 默认不变,B 系测试零改动):dispatch workflow 返回 {delegationId, statusUrl};`/api/delegations`(列表:Temporal workflow list × 委托事件聚合;status/steps 摘要)+ `/api/delegations/[id]`(轨迹详情);**舰队页 `/delegations`**(极简表格:goal/status/进度;首页入口)。
6. driver 复用:@ui4a/agent 在 worker 进程可用(workspace 依赖);sitemap 上下文照旧(activity 内 fetch)。

## Acceptance Criteria

1. `CI=true pnpm check` 全绿;`CI=true pnpm e2e` 全过(既有 22 + S3 新增;Temporal 探活 skip-if);
2. **S3-并发**:两个 delegation 并发 approve 同一评论 c1 → 恰一个成功,另一个轨迹含被拒步骤与原因(guard/undeclared 层),两委托各自完整落日志;
3. **S3-续跑**:delegation 执行中途 SIGKILL worker → 重启 → workflow 恢复 → 目标完成,delegation-step 事件序列连续无缺口;
4. **S3-并行**:≥3 个不同目标 delegation 并行(发布×2 不同标题+审核)全部完成,互不串扰;
5. 舰队页:/delegations 列出并行中的委托(status/进度),e2e 断言可见;delegations 集合实体可经 /api/entity 查询;
6. /api/chat mode=delegated:dispatch 返回 delegationId,轮询 statusUrl 至 completed(轨迹消息投影与 inline 等价);
7. 回归:既有 22 e2e 全过(chat inline 默认不变;B1–B3/S1/S2 零回归)。

## Out of Scope(Non-goals)

- Keycloak(D10);plan-exec(T6);渲染词汇表/态势主页(T7);
- LLM driver 在 workflow 内的深度优化(rule 为主;llm 直传可用即可);
- workflow 取消/信号 UI;委托暂停恢复 UI;成本档;渐进信任;
- 不实现"新 agent 从头续跑同一委托"(续跑=平台恢复;实体状态续跑口径已有事件日志支撑,不重复建)。
