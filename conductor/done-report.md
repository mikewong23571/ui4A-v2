# UI4A v2 — DONE 对照报告

> 原报告生成于 2026-08-21(T1–T8)。2026-08-23 增加 T15 AI-first superseding addendum；旧测试数量与旧 I1 仅是历史快照，不再代表当前 DONE 口径。当前验收以 `GOAL.md`、T15 U1–U23 Story Eval 和最新命令输出为准。

## T15 AI-first superseding addendum(2026-08-23)

T15 修正了旧报告把“AI 可选”解释为“无模型也由 rule driver 自动完成同一自然语言任务”的方向。当前产品合同如下：

| 主题 | 当前口径 | 实现/证据入口 |
|---|---|---|
| Assistant runtime | default/auto/llm 均为真实 LLM；产品无 rule fallback，scripted/mock 只做协议测试 | `packages/agent/src/llm-driver.ts`、`runtime-governance.test.ts`、`e2e/chat.spec.ts` U22 |
| 多轮上下文 | 原始 user/assistant 消息 append-only；活动目标、focus、指代、约束、待澄清项和授权证据从日志有界投影 | `apps/web/src/chat/conversation.ts`、`packages/agent/src/types.ts` |
| 认知/能力边界 | 临时阅读、回答、总结、比较、解释是 LLM 原生能力；正式结果才成为 capability artifact，状态变化另走 action | T15 U1–U4/U15–U17；`packages/engine/src/capability-artifact.ts` |
| 副作用授权 | agent effect 引用 user message id + 逐字 quote；事件记录 declaration/guards/schema/confirmation，解释只从事件链生成 | `packages/agent/src/authorization.ts`、`packages/engine/src/execution-audit.ts` |
| Provider 配置 | `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL` 全部外置；缺项诚实失败且零副作用；正式工件不允许占位模型半写 | `packages/agent/src/llm-config.ts`、`apps/web/src/engine/service.ts` |
| 验收 | 安全边界确定性测试必须 100%；动态语义由真实 LLM Eval 验收，不以固定措辞、固定轨迹或 fake driver 冒充 | [T15 spec](./tracks/t15-ai-first-dynamic-assistant_20260822/spec.md) 的 Story Eval Contract |

本 addendum 同步产品方向与已实现机制，不单独宣称 T15 最终 Story Eval/walkthrough 已完成；最终结果与证据由 T15 track checkpoint 收口。

## 基线场景(业务平面)

| # | 断言(GOAL) | 结果 | 证据 |
|---|---|---|---|
| B1 | 三步按 schema 填充 → 发布 → 文章真实落库 | ✅ | `e2e/baseline.spec.ts`(agent 合同,零特权起点 articles→flow 入口);`e2e/human.spec.ts`(RJSF 三步表单);`e2e/dual-executor.spec.ts`(同日志双 actor);LLM 路径:llm-smoke 真实 GLM 曾跑通(T2 Phase E/验收 note) |
| B2 | 经子实体链接直达,精确下线一篇,其余不受影响 | ✅ | baseline B2(轨迹断言首步 `navigate post:post-welcome`)+ human B2 |
| B3 | pending 清零,事件留痕 | ✅ | baseline B3 + human B3 + dual B3 |
| B4 | 401 如实进入对话,委托不崩溃 | ✅ | `e2e/chat.spec.ts` B4(本地 401 桩确定性断言;真实 GLM 401 形态曾在 T2 Phase E 实测) |

## 切片场景(v2 核心)

| # | 断言 | 结果 | 证据 |
|---|---|---|---|
| S1 | 挂起→pending 实体→human approve(actor=human)→生效;日志含 actor/principal/信道 | ✅ | `e2e/s1.spec.ts`(agent/human 双视角、I4、reject、UI 走查、B 回归);Cedar 策略即数据(policy.cedar 文本变更改行为,T3 Phase B 单测+实机);notify 经 Temporal activity→inbox≤15s |
| S2 | 非法定义拒且留痕→修正→机械 diff 人批→sitemap 重生成→agent 零 prompt 用新动作 | ✅ | `e2e/s2.spec.ts` 五要素逐条映射(拒 to-exists 留痕→修正→BIOS diff 批准→version bump→同会话动态发现 pin);定义入事件日志(T4 Phase B);在途实例按出生版本 |
| S3 | 并发一成一拒带原因;杀掉执行中委托续跑 | ✅ | `e2e/s3.spec.ts`(同标题并发发布:title-not-taken 世界状态型 guard,载体偏差记录于 spec 头注;SIGKILL worker→Temporal 恢复→步事件无缺口;3 委托并行+舰队页);engine kill 集成测试(T5 Phase A) |
| S4 | 六步向导一次决策,一条批量裁决记录,每步裁决可见 | ✅ | `e2e/s4.spec.ts`(六步单次 exec-plan;恰一条 plan-executed;exec 调用计数=1;拒绝截断;挂起交互);真实 GLM 计划冒烟曾跑通(T6 Phase B) |
| S5 | 聊天→A2UI surface 图表;spec 零字面全实体引用 | ✅ | `e2e/s5.spec.ts`(官方 @a2ui SDK surface;validateSpec 零字面断言;数值与实体快照逐项对拍;凝固);渲染词汇表十词条 + 骨架五面 |

## 不变量(持续运行)

| # | 不变量 | 结果 | 证据(e2e/invariants.spec.ts 命名套件) |
|---|---|---|---|
| I1 | 配置真实 LLM 后 U1–U23 达到 Story Eval 门槛；生产 Assistant 无 rule fallback | 以 T15 最终 Eval 为准 | 旧 `I1 零智能完整` 已 supersede；协议 fixture 不再是 Assistant 能力证据 |
| I2 | 渲染 spec 解引用后的值与实体快照一致 | ✅ | property test(T7 Phase A,150 runs)+ `I2 事实不可发明 › 渲染 spec 解引用…`(生产 derefSpec 对拍)+ s5 e2e |
| I3 | fuzz 可点元素必映射已声明 action,合同外按钮无法提交 | ✅ | `e2e/i3.spec.ts`(七页全量 fuzz + 未声明按钮零 /api/exec)+ `I3 交互必背书 › 抽 2 页…` |
| I4 | 以 agent 身份执行 approve 必被拒 | ✅ | s1 + `I4 审批不委托…`(422 actor-is-human 留痕);meta approve 同口径(s2) |
| I5 | 从空库重放事件日志,实体状态 hash 一致 | ✅ | `I5 可重放 › 完整压缩场景序列 → TRUNCATE 回灌重放 → 全实体 hash 一致`(在线 hash=c341491028a5,22 rels/27 events,三轮确定);另有局部重放单测(T2 replay/s2) |
| I6 | 每个被拒动作日志带原因,可作下一步决策上下文 | ✅ | `I6 拒绝留痕 › …lastRejection.reason 逐字一致`;各 spec 拒绝断言遍布 |
| I7 | LLM 缺失/失败/超时诚实失败且零业务副作用；人工控制面可用 | ✅(机械安全面) | U22 route/unit/E2E；真实 LLM 质量仍归 I1 Story Eval |

## GOAL 约束核对

- 技术栈严格按选型:XState/Postgres/Siren/Cedar/Keycloak[^1]/Temporal/AI SDK+assistant-ui/A2UI/RJSF/shadcn(Tailwind4)全部实装;实际版本见 `tech-stack.md` 实况注记;唯一自造 = 选型 §3 列的五层胶(投影/裁决/效果映射/guard 桥/definition-lifecycle)。
- 五条铁律:T15 起第一条为 AI-first、机械治理；确定性系统不复刻认知，但继续守 facts/effects/approval/audit/replay。
- 每个里程碑可运行:T1–T7 各 track 收口时双门全绿(见各 track plan checkpoint)。
- 实现与文档冲突 → DECISIONS.md:D1–D12 全记录(含 Keycloak 延后、S3 载体偏差、A2UI SDK 采用)。

[^1]: Keycloak 按 GOAL"真实 SSO 对接显式排除"与 D10 不进入 DONE 验收面;信任线语义由引擎 actor-is-human + principal 委托链(自报口径 D8)承担。

## 范围边界

DONE = demo 质量 ✅;生产化(多租户/部署硬化/压测/真实 SSO)显式排除,未做。
人工评估点四项(确认疲劳/澄清收敛/diff 可读性/渲染凝固)= 醒后走查项,见 `demo-checklist.md`(不计入自动化验收,按 GOAL 单独记录观察)。

## 里程碑账目

| Track | 内容 | 状态 |
|---|---|---|
| t1-infra | monorepo/PG/测试基座/质量门 | [x] |
| t2-business-plane | 引擎+日志+合同+双 driver+聊天+表单(B1–B4,I1/I5/I6)+ 终审 review 通过 | [x] |
| t3-confirmation-gate | Cedar+确认门+Temporal notify+收件箱(S1,I4) | [x] |
| t4-minimal-meta | 定义入日志+lifecycle 自举+不变式+机械 diff+BIOS(S2) | [x] |
| t5-delegation | Temporal 委托实体+并发裁决+续跑+舰队页(S3) | [x] |
| t6-plan-exec | 批量裁决 executePlan(S4) | [x] |
| t7-rendering | 词汇表+binding-only+A2UI+骨架五面(S5,I2,I3) | [x] |
| t8-acceptance | 不变量套件+全量重放+双执行者+demo 清单+DONE 报告+终审 | [x](本报告) |

历史测试总量(T8 快照):821 单测 + 43 E2E(42 过 + 1 真实 LLM 门控)。当前数量与结果必须现场运行 `pnpm check`、`CI=true pnpm e2e` 及门控 Story Eval 获取，不复用本快照。
