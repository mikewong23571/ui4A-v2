# GOAL — 项目目标与验收标准

> 给持续迭代的 coding agent 的目标定义。验收方式遵循项目自身的论题：
> **每个场景由两种执行者各跑一遍——人类走 renderer,agent 走合同(tools / HTTP),同一套场景，同一份日志。**

## 使命（一句话）

构建一个"界面作为合同"的应用——人和 AI 面对同一套业务流程、共享同一套流程知识；软件为 AI 操作而写，代码只是副产品。

## DONE 的定义

以下业务与切片场景、T15 AI-first、T16 Presentation、T17 External Agent Draft、T18 Coding Capability、T19 Specialized Agent Contracts、T20 Meta Human Control Plane、T21 Assistant 双焦点一致性用户故事 Eval 及不变量全部通过，外加一次人工 demo 走查。技术栈与施工顺序见 `README.md` 与 `docs/`。

T26 进一步把“一件事”实现为 Work Thread 纯投影：`threads`/`thread:<id>` 聚合目标、显式引用、
进行中、待批准和近期事件；owner 绑定 principal 而非 session，Application scope 只充当授权镜头。
CLI 无 presence 与 Chat+presence 两条路径都必须产生同形显式 thread core 事件，且全量重放一致。

### v0.1.0-experimental.1 现场状态

该版本已在 mothership 内网以单副本、非 HA 形态部署并可访问；认证、单 Web 并发/重启/重放和
十工件隔离恢复已经现场验证。最终 Compose 与 K8s Runtime 均 `failed-honest`，没有 fallback；U8
与 accept 延后。镜像扫描仍有 50 个 Critical、241 个 High matches，按 `known-risk` 仅接受用于
internal experiment；rollback 与 fault injection 未实测。这份证据不把 T22 或其 Phase 标记为完成，
也不代表 GA、SLA、LTS 或生产就绪。详见 [release notes](./release/v0.1.0-experimental.1/RELEASE_NOTES.md)
和 [acceptance report](./release/v0.1.0-experimental.1/acceptance-report.json)。

### AI-first 用户故事

Assistant 的阅读、总结、比较、解释、多轮目标形成和动态能力发现，以 `conductor/tracks/archive/t15-ai-first-dynamic-assistant_20260822/user-stories.md` 的 U1–U23 为准。验收必须运行配置的真实 LLM；rule/scripted driver 只能证明协议机制，不能证明 Assistant 用户故事成立。

产品边界：

- **原生认知不是 capability**：读取已授权合同事实并临时回答、总结、比较、解释，由 LLM 直接完成；只有需要持久化、共享、重试或审计的模型结果才物化为 capability artifact，业务状态变化始终由 action 承担。
- **多轮上下文来自日志**：user/assistant 原话 append-only 保存，同时从日志投影有界的 `activeGoal`、referents、constraints、待澄清项和 effect authorization。T21 另保留最近成功导航 `lastNavigation` 与当前 user message 携带的客户端观察 `clientView`；两者同时进入 LLM 且不互相覆盖，刷新或恢复不依赖进程内会话真相。
- **副作用需要原话授权**：执行必须引用 user message id 与逐字 quote，并与目标实体/action 关联；事件链保留声明、guard、schema、确认和 human decision，Assistant 只能据此解释“为什么执行”。
- **配置即部署数据**：`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 由外部环境完整提供，产品没有供应商、端点、模型或 driver fallback。缺项/失败时诚实失败，正式模型工件也不得以占位模型部分写入。

### Presentation 用户故事

呈现以 `conductor/tracks/archive/t16-semantic-a2ui-sidecars_20260823/user-stories.md` 的 S1–S32 为准。Chat 只发薄 `PresentationRequest`；Application Recipe 和独立 Presentation Agent 产生 binding-only Surface；用户级 Sidecar 跨 Session 命中并重新授权、解引用。个人优化只有经参数化、机械 diff 和 human approval 才可晋升共享 Recipe。Recipe/Sidecar/patch/promotion 事件独立重放，不进入 Business Snapshot。

### Assistant 双焦点一致性

`conductor/tracks/archive/t21-assistant-dual-focus_20260823/` 的 U1–U8 约束参考 Assistant：`currentRel`
只表示本轮合同读取位置；最近成功 navigate/Presentation 作为 `lastNavigation` 重放，用户发送消息
时的实际 route/subject 作为不可变 `clientView`。LLM 同时理解两者并自主决定 answer/clarify/
navigate/present，机械层不得用关键词、URL 或 rule driver 替代意图。一个用户回合可有多个单工具
decision；Provider 用 required tool envelope，非法输出最多进行一次真实 LLM repair，禁止把文本解析
成 operation。

### App 创建边界

当前阶段**不在产品运行时内闭环“通过 Chat 创建一个全新 App”**。UI4A 应提供可被外部工具消费的 Application/Flow/Entity/Action/Guard/Policy 定义合同、机械校验、diff、激活和 replay 基础，但不增加内置 `create-app` 对话向导、页面设计器或业务关键词编排。

候选方向是由**应用外置 Agent**完成需求理解、用户故事整理和 Application Bundle 起草，再通过 UI4A 的 meta 协议提交候选定义；UI4A 继续负责确定性的 schema/invariant 检查、版本 diff、human approval、激活、审计和重放。外置 Agent 可以更换或独立部署，其认知能力不成为应用运行时的一部分。

在该方向形成独立用户故事和验收 Track 之前，DONE 不要求：

- 产品内创建、编辑或废弃 Application 的完整交互闭环；
- Chat 自动把一句需求扩写为完整 App/Flow/Policy 并直接激活；
- 为 App 创建过程内置固定表单、固定页面或 rule-based 生成器。

已有 publishing/community Application 的运行、发现、操作与呈现仍属于当前 DONE；“创建新 App”属于后续外置 Agent 集成范围。

该方向已由 `conductor/tracks/archive/t17-external-agent-cli-drafts_20260823/` 首切片闭环：可安装
`ui4a` CLI 是 HTTP/Siren/meta 协议的 agent-friendly 参考客户端；第三方 Agent 可参与受权
业务操作，并把 Flow 候选作为系统内 Draft 修订、校验、diff 和提交。Draft 是否适用由激活
合同的 `draft|direct|none` SubmissionPolicy 决定，Agent 无权在请求侧绕过；human approval
以同事务 core apply + Draft accepted 原子落地。创建完整新 Application 仍不属于当前 DONE。

### Coding Capability Executor

`conductor/tracks/archive/t18-coding-capability-executors_20260823/` 跟踪通用 Coding Agent 作为
`coding.execute` capability executor 的闭环：Application Flow 只声明业务节点与能力；UI4A
治理 executor profile、隔离 workspace、durable run、预算、轨迹、result artifact 和 human
accept/reject。Codex 是首个真实 reference executor；Hermes 只提供 Runtime/Workspace/session/
trajectory/approval 分层启发，不进入依赖或产品运行时。Coding Agent 无权直接 merge、activate、
deploy 或批准自己的结果。

### Specialized Agent Contracts

`conductor/tracks/archive/t19-specialized-agent-contracts_20260823/` 将业务 Capability、版本化
Agent Definition 与部署 Runtime Profile 分层。Coding 与 Writing 是同一 Agent Host 上的两个真实
specialization，但分别保留 Git/test 与 document/source/citation/render 合同。Agent Definition
Author 可以根据自然语言起草 Prompt、Task/Result schema、runtime/policy、examples 和 Eval corpus；
结果只能进入系统内 Governed Draft。无效但有界的候选保留为可修订 Draft，Agent/system 无权批准，
只有 human approval 能激活新版本；旧 Run 始终固定出生时 definition/prompt/runtime hashes。

### Meta Human Control Plane

`conductor/tracks/archive/t20-meta-human-control-plane_20260823/` 把 Meta sitemap、Application、Agent
Definition、Draft/Activation 合同投影为完整的人类治理控制台。`/meta` 动态发现当前授权面；
未知合法 class 走安全 generic fallback，Application/Agent Definition/Draft 使用任务优先特化视图。
Scope 由服务端重新裁决，所有功能控件来自当前 Siren action 并在提交前重读 exact entity；审批、
diff、checks、Eval、来源和 replay 全程零 AI。当前 local demo 身份仍按 D8/D10 明示为自报口径，
不冒充生产 SSO；完整 Application 创建仍在产品范围之外。

### 基线场景（业务平面，继承自已验证 demo）

| # | 场景 | 断言 |
|---|---|---|
| B1 | 委托发布："帮我发布一篇文章" | 三步按 schema 填充 → 发布 → 文章真实落库 |
| B2 | 点名下线："把 post-welcome 下线" | 经子实体链接直达，精确下线一篇，其余未受影响 |
| B3 | 审核队列："审核所有待处理评论" | pending 清零，事件留痕 |
| B4 | 失败呈现：配置无效 API key | 401 如实进入对话，委托不崩溃 |

### 切片场景（v2 核心，每个对应一条架构主张）

| # | 场景 | 断言（测主张本身，不是表面） |
|---|---|---|
| S1 | 确认门 | agent 执行高风险 archive → **动作未生效**，挂起为 pending 实体 → 人类 approve（actor=human）→ 生效；日志含 actor / principal / 信道 |
| S2 | 最小 meta | agent 经 `_meta` 提交"新增一条边"：缺 guard 的非法定义**被拒且留痕** → 修正 → 人类在**机械 diff** 上批准 → sitemap 重生成 → **agent 下一步即可用新动作，无任何 prompt 改动** |
| S3 | 委托实体 | 两个 agent 并发操作同一资源：一个成功、一个拿到带原因的拒绝（裁决器即并发控制）；杀掉执行中的委托，新 agent 从实体**续跑** |
| S4 | plan-exec | 六步向导在一次决策内完成，轨迹为一条批量裁决记录，每步裁决可见 |
| S5 | 渲染 | 用户目标经薄呈现请求得到语义 A2UI Surface；**Surface 中不含事实字面值，事实实时解引用，交互重新按合同裁决** |

### 不变量（铁律的自动化形式，持续运行，违反即迭代无效）

| # | 不变量 | 验证方式 |
|---|---|---|
| I1 | AI-first 动态助手 | 配置真实 LLM 后，U1–U23 canonical 全过、变体达到质量门槛；生产 Assistant 无 rule fallback |
| I2 | 事实不可发明 | property test：渲染 spec 解引用后的值与实体快照一致 |
| I3 | 交互必背书 | fuzz 所有可点元素：提交必映射到已声明 action，合同外按钮无法提交 |
| I4 | 审批不委托 | 以 agent 身份执行 approve 必被拒 |
| I5 | 可重放 | 从空库重放事件日志，实体状态 hash 与重放前一致 |
| I6 | 拒绝留痕 | 每个被拒动作在日志中带原因，且可作为下一步决策上下文获取 |
| I7 | 模型故障安全 | LLM 配置缺失、端点失败或超时时 Assistant 诚实失败且零业务副作用；人工 renderer、审批和合同操作仍可用 |

## 约束

- 技术栈严格按 `docs/UI4A-技术选型.md`，不自造轮子（渲染协议用 A2UI、宿主协议用 Temporal、策略用 Cedar、委托链用 Keycloak）；
- **AI-first**：LLM 是 Assistant 的智能主体；确定性代码负责事实、权限、裁决、确认、审计和重放，不复刻自然语言理解、总结、比较、解释或规划；
- 五条铁律见 `README.md`，违反任何一条 = 该迭代无效；
- **每个里程碑结束系统必须处于可运行状态**（切片化施工，任何时刻停下不留废墟）；
- 实现与文档冲突时：先在 `DECISIONS.md` 记录分歧与决定，再动代码或文档。

## 人工评估点（不阻塞 DONE，单独记录观察）

确认疲劳的真实感受、澄清对话的收敛体验、机械 diff 的可读性、渲染凝固后的稳定性。这些是洞清单里"只能实验"的距离，持续记录，不计入验收。

## 范围边界

DONE = **demo 质量**。生产化（多租户、部署硬化、压测、真实 SSO 对接）显式排除在外。
