# T8 验收收口 — Spec

> Track ID: `t8-acceptance_20260821` · Type: Chore · 状态: approved(编排 agent 代行验收)
> 上下文:GOAL.md DONE 定义(B1–B4/S1–S5/I1–I6 全自动 + 一次人工 demo 走查)。

## Overview

把散在各 track 的验收收拢为**持续运行的不变量套件**(I1–I6 一个命令可跑)、**双执行者口径套件**(同一场景两种执行者、同一份日志)、**I5 全量重放**(整条日志从空库重放 hash 一致)、**人工 demo 走查清单**(用户醒后按单走查)、文档同步(README/tech-stack 实况)、**终审 review(T3–T7 全量)**。

## 任务

1. **不变量套件** `e2e/invariants.spec.ts`(或聚合 runner,报告形态):显式命名 I1–I6,逐条引用/复用既有断言并补缺:
   - I1:keyless 断言(e2e 进程无 GLM_API_KEY——已是缺省;显式 env 清除 + B1–B3 agent 路径 + 表单版 S1(human 挂起→approve 全 RJSF/renderer 路径)+ 哑渲染(态势/事件流静态绑定)全过;
   - I2:S5 已有(property + e2e 对拍)——引用跑通;
   - I3:i3.spec 已有——引用跑通;
   - I4:s1 agent approve 拒——引用跑通;
   - I5:**新增全量重放**:跑完整场景序列(B1–B4+S1+S2+S3+S4+S5 的 e2e 或其压缩版)后,取全部实体快照 hash → TRUNCATE events → 原序重放(fold)→ hash 一致;
   - I6:拒绝事件带原因可作下一步上下文(s1/s2/s3 已断言)——引用跑通 + 一条显式"查询最近拒绝→agent 下一步决策上下文含原因"断言;
   - 产出:`CI=true pnpm e2e` 一条命令全含;README 记录"不变量持续运行"口径。
2. **双执行者口径套件**:B1–B3 每场景 agent(合同)+ human(renderer)两路径在同一条日志断言(actor 分布正确);S1 双视角已有——收拢进一个命名 describe。
3. **人工 demo 走查清单** `conductor/demo-checklist.md`:醒后 15 分钟走查单(起栈命令[postgres/temporal/dev/worker]、每场景逐步预期[含截图锚点]、人工评估点四项[GOAL:确认疲劳/澄清收敛/diff 可读性/渲染凝固]、已知限制清单[D8 自报身份/D10 Keycloak 排除/carrier 偏差等]);README 增链接。
4. **文档同步**:tech-stack.md 补实况注记(A2UI SDK 实装版本、fast-check、词条组件版本——从 lockfile 提取,简短);README quickstart 校对(dev 端口/worker/Temporal 启动)。
5. **终审 review**:conductor-review 协议跑 T3–T7 全量(revision range T2 review fix commit `33802f1`..HEAD);发现按协议处置(Apply Fixes/记录)。
6. **DONE 报告**:对 GOAL 逐条(B1–B4/S1–S5/I1–I6/约束/范围)出最终对照表,写入 `conductor/done-report.md`;tracks.md 全 [x]。

## Out of Scope(Non-goals)

- 新功能;性能优化;生产化(显式排除);修 review 之外的架构问题。

## Acceptance Criteria

1. `CI=true pnpm check` 全绿;`CI=true pnpm e2e` 全过(≥36,含不变量套件);
2. I5 全量重放测试通过(整日志 hash 一致);
3. demo-checklist.md 存在且可执行(命令逐条验证过);
4. done-report.md 覆盖 GOAL 全部条目,每条附证据(测试名/commit);
5. review 完成且发现处置完毕;
6. tracks.md 八条全 [x]。
