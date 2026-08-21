# T6 plan-exec 切片 — Spec

> Track ID: `t6-plan-exec_20260821` · Type: Feature · 状态: approved(编排 agent 代行验收)
> 上下文:`conductor/refs/arch-brief.md` §9.4(一次决策输出整段计划,引擎一次事务里逐步模拟——每步仍做完整三层裁决,通过则提交,被拒则分步报告;"不是信任计划,是批量裁决计划");GOAL S4:六步向导在一次决策内完成,轨迹为一条批量裁决记录,每步裁决可见。

## Overview

agent 一次决策输出整段计划(向导三步填充 + publish 等),引擎**单事务批量裁决**:每步完整三层裁决,通过则提交,被拒则分步报告(已提交步骤不回滚——append-only 日志语义,报告从拒点截断)。**S4 全链路自动化通过。**

## 架构决定

1. **计划协议**:`POST /api/exec-plan` {steps: [{rel, action, params}...], actor, principal, channel}(或 /api/exec?plan=——独立端点更清晰,报告);每步是标准 ExecRequest 形状。
2. **批量裁决器**(engine):`executePlan(requests, snapshot, deps)`——串行逐步:每步完整 executeWithGates(三层+确认门);挂起步(confirmation)→ 该步记挂起、**后续步停止**(计划依赖前序);拒绝步 → 该步记拒绝,**停止后续**,返回已到当前的分步结果;全部通过 → 全部提交。结果 `{kind:'plan-completed'|'plan-rejected'|'plan-suspended', results: [{step, outcome, entity?, rejection?}], snapshot, events}`——**一条批量裁决记录**:日志事件 `plan-executed`(detail=steps 摘要)+ 各步伴随事件(现有 action-executed/rejected 族照常)。
3. **事务语义**:单写者队列内一次入队执行(串行 atom 既有);"每步裁决可见"= results 逐步层/reason/entity 齐全。
4. **driver 侧**:LLM driver 的 plan 模式(一次 generateText 产多步 JSON plan → exec-plan);rule driver 的 plan 生成器(goal.fields + sitemap 推导向导序列——确定性);T6 主用 rule driver(S4 断言六步一次决策);LLM plan 模式留接口+单测 mock,真实冒烟可选(报告)。
5. **六步口径**:GOAL"六步向导"——demo 域向导 3 步 next + publish = 4 次业务 exec;S4 用"三篇评论审核"或"发布+下线组合"补足六步:计划 = next(3×) + publish + unpublish + …构成 6 步序列(具体场景在 e2e 定,断言:6 步、一次决策、一条 plan-executed、每步裁决可见)。

## Acceptance Criteria

1. `CI=true pnpm check` 全绿;`CI=true pnpm e2e` 全过(既有 25 + S4 新增);
2. **S4 E2E**:agent 一次决策(单次 exec-plan 调用,无逐步循环)完成六步计划 → 全部生效;`/api/events` 恰一条 `plan-executed`(detail 含 6 步);每步伴随事件可见(逐层裁决:成功步 action-executed ×N);**一次决策断言**:e2e 计 agent 的 exec 类 HTTP 调用次数 = 1;
3. 拒绝截断:计划含非法步(如第 4 步 guard 拒)→ 前 3 步已生效保留,第 4 步带原因,第 5/6 步未执行,响应 plan-rejected 分步报告;
4. 挂起交互:计划含 requires-confirmation 步(agent)→ 前序生效,该步挂起(confirmation 实体产生),后续停止;
5. engine 级:executePlan 单测矩阵(全过/中拒/中挂/空计划/重复步);重放:plan 事件族入 fold,重放一致(I5 保持);
6. 回归:既有 25 e2e 全过。

## Out of Scope(Non-goals)

- 计划编译/优化/回滚补偿(append-only:不回滚,分步报告);多计划并发合并;LLM plan 真实冒烟为可选;
- UI(计划结果在聊天/轨迹呈现——沿用 trail 投影,report-only);舰队页不动;
- Cedar 策略不变(确认门逐步生效)。
