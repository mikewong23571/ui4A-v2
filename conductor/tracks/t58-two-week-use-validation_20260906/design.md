# T58 准备期设计与工程边界

## 1. 一条真实目标的体验闭环

```text
交代目标/来源/验收边界
    → 判断已知与缺失信息
    → 合法执行或明确等待
    → 用户离开/返回，恢复同一事实
    → 查看变化/证据/未验证项
    → 人类决定或接受结果
    → 留下可继续、可追溯的工作线
```

任何环节如果要用户查产品源码、补数据库、猜运行状态或重写内部规则才能继续，都是准备期GAP。
不能用“动作调用成功”替代整条路径的目标达成。首页/本线/材料/助手的具体基础复用T56/T57，
本 track 根据真实摩擦修整，不预先推倒其结构。

## 2. 先查能力，不许用 UI 承诺掩盖缺口

P0 建立 capability-matrix，逐项写 actual/unsupported/needs-fix 与证据：

- 当前部署可以执行哪些真实开发/调研/评审任务，所用profile/Runner是否真实可用。
- inline 与 durable delegated 的不同保证：关闭网页、失去SSE连接、worker重启后如何继续。
- 暂停/取消/停止显示/恢复分别对哪一执行对象起作用，何时有服务端确认回执。
- 工作线、Agent Run、Flow与confirmation的状态来源；处理等待输入/等待批准/失败/终局。
- 当前可用通知/状态到达通道，记录送达含义；应用内事件不等于外部通知。
- 来源/验收标准/产物怎样关联；编码结果接受是否只代表proposal，merge/push/deploy是否另需授权。

首批真实目标从已交付的能力范围选，但产品声称支持的路径必须实际跑通。
因集成尚未配置而失败，要在准备期完成合法配置/修复，不能让正式期用户天天搭环境。
禁止用另一聊天工具偷偷执行完、再在UI4A手工写“完成”冒充承接成功。
正常外部执行器可用，但须由产品合同启动、结果回流可追溯；人工正常领域工作与产品救援明确分开。

## 3. 三个有界探针与 GAP 单据

### S1 持续执行与状态同源

隔离测试环境先跑一条代表性真实能力的端到端目标。记录thread/Flow/AgentRun/Temporal/产物映射，
关闭浏览器、断流、执行器可恢复中断、重试，确认没有重复effect/孤儿运行或永久“运行中”。
暂停/取消只有服务端确认后才显示相应结果；无该能力则诚实展示而非假按钮。
输出最终runtime/profile/状态与恢复合同、常驻测试位置、部署准备缺口。故障注入只在隔离环境。

### S2 知情决定、目标验收与授权

从当前合同复核D78.4 thread确认门差异与现有决定回执；以规范的声明→guard→schema/确认路径修正
声明与执行承诺不符，先写DECISIONS。不得通过移除策略、伪造human或把需求改成低风险来让测试通过。
覆盖过时/重复/越权决定；产物有依据但未达验收标准时必须仍待验收；用户驳回后能继续修补。
编码proposal不自动等于merge/deploy；目标若要求发布，必须先核实已有合法发布能力与授权，不事后缩为产出patch。
输出来源、验收标准与回执的真实存放位置，以及正/负例和必要变更边界。

### S3 真人使用成本与呈现

至少三个准备期真实目标/一次隔日返回，观察发起、追状态、恢复、找依据、决定和回到工作所需动作。
记录实际点击、强制机器字段、重复上下文、需要维护者提示的点，不以AI给界面打分替代用户。
问题归类到：字段/合同缺失、状态/恢复链路、选择器/表单宿主、信息层级/导航、提醒与回执。
再选择最小通用组件/语义或runtime修复；不按照应用名补一套专页。

### 每个 GAP 必填

```text
gapId / linkedStory / humanFeedbackHypothesis:
evidence / reproduction / expected vs actual:
severity / humanCost / rootCause:
allowedFiles / nonGoals / decisionRequired:
RedCommandAndFailure / proposedFix / GreenCommand:
browserOrRuntimeEvidence / reviewer / fixedCommit:
trialImpact: blocks-freeze | acceptable-observation-with-reason
```

先修权限/假成功/丢失与阻断，再修反复高成本交互；外观调整不能替代功能闭环。
每项仍遵循原workflow的有限修复/失败升级纪律，不无限“再调一下Prompt”；
出现无法解释的架构分叉时先重新诊断，不额外造平台。

## 4. 允许触碰的模块

| 需要修整                | 主要落位                                                                                       | 验证重点                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 目标/引用/状态/确认语义 | packages/shared/src/；packages/engine/src/projection/、execution/                              | 纯不变量、状态/来源、权限、拒绝/确认、replay              |
| HTTP装配/回执           | apps/web/src/engine/、app/api/                                                                 | 同源、fresh read、并发、实际作用对象，无第二writer        |
| Durable工作             | apps/worker/src/workflows.ts、activities/、runtime-backends/；apps/agent-runner/src/按必要范围 | 确定性、重试/取消/恢复、真实profile，零客户端provider选择 |
| Chat上下文              | packages/agent/src/与apps/web/src/chat/、components/chat/                                      | 真实LLM/会话分离/指代/断流；无规则替身                    |
| 页面/组件               | T56/T57完成后的canvas/stage/actions/words/Presentation链                                       | binding-only、责任不丢、草稿/焦点、宽窄屏                 |
| 定义/呈现候选           | 激活Application/Agent定义、Recipe与现有Draft流程                                               | 人类治理、来源和版本，冻结前完成，不直接改历史快照        |
| 证据/通知               | 现有events/audit/notify合同与最小只读导出                                                      | 送达语义真实、有限读取、用户授权、无重复骚扰              |
| 存储                    | packages/db/src，仅必要读投影/原事件边界                                                       | 幂等、事务、历史重放，不造任务/试验第二业务真相           |

修改限于已复现或冻结前必须消除的范围内风险。新能力/数据shape先比较相邻实现，
两域故事验证通用性；GR3超限在变更时拆解，不能删功能或测试/恢复债务登记。
保留完整人类/CLI/Siren通路；试验导出只读，观察ledger不反向写业务状态。

## 5. 候选冻结前工程门禁

从仓库根执行，使用与其他执行者分离的TEST_DATABASE_URL；DB/Temporal集成遵循现有kits：

```bash
pnpm governance:strict
pnpm vitest run apps/web/src/engine/service-tests/service.restart-replay.test.ts apps/web/src/engine/service-tests/delegation.kill.integration.test.ts apps/web/src/engine/service-tests/service.notify.integration.test.ts
pnpm vitest run apps/worker/src/workflows-delegation.test.ts apps/worker/src/delegation/working-context.test.ts packages/db/src/replay.test.ts
pnpm check
CI=true pnpm e2e
CI=true pnpm e2e invariants
pnpm --filter @ui4a/web build
```

按GAP最终修改补具体测试命令/用例路径，不把上述回归基座当新故事已覆盖。焦点、状态、回执与
真实执行边界需要对应组件/HTTP/集成/E2E证据。精确Prettier和适用新代码覆盖率>80%按原workflow执行。
复用常驻eval，保证实际使用的能力/执行器也有真实运行证据：

```bash
RUN_LLM_EVAL=1 RUN_LLM_E2E=1 \
DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_t58_eval_test \
TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_t58_eval_test \
pnpm eval:llm --project=working-context --project=t16-real-llm
```

provider从已授权安全环境提供，不写秘密值；测试skip/无配置不是通过。
模型问答通过不等于真实coding/delegated执行通过，S1所选实际任务必须额外留完整运行与产物验证。
浏览器覆盖1440×900、1080×820、768×1024、390×844、200%缩放；试用默认桌面真实日常使用，
窄屏/键盘可用性可在冻结前结构化验收，不用它们替代真人两周。

## 6. 发布与冻结准备

本轮不发布。实施到发布阶段时，依据已明确的目标环境/版本与实际授权，先重读 `DEPLOYMENT.local.md`。
若执行环境缺少该非仓库runbook，须先取得当前运维合同，不能凭本track里的概要猜部署步骤或开始T0。
默认目标是既有home-compose+aliyun-sz-edge，不自建新的生产体系。候选可在另一checkout准备，
试用实例的镜像/有效配置保持固定；不影响其他未获授权的数据和运行任务。

标准步骤：精确SHA/digest与备份→原runbook的preflight/up/status→公网/live/version与真实浏览器登录、
账户/授权/退出→代表性目标与执行器实测→同步本地及home运维文档并核对SHA-256→冻结manifest。
CLI/API健康不能代替浏览器真实登录/责任决定，也不代表已具备需要的执行profile。
发现发布失败或配置漂移时留在准备期，不能开始T0。

冻结前必须做一次实现review和必要修复/复审，核对所有GAP、原愿景及实际任务结果。
发布到使用环境后的最终接收测试不得注入破坏性故障；故障/越权/取消负例在隔离环境完成。
正式期的缺陷修复不再延续旧窗口，按trial-protocol保留FAIL并建立新attempt。
