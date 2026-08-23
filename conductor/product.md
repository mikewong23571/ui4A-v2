# UI4A v2 — 界面作为合同 (Interface as Contract)

## 使命

让所有软件 **chatable**——用户不必先理解操作文档、界面、菜单和快捷键,只需与自己的智能助手交流;外部 agent 通过应用自有协议理解并操作应用,应用负责事实与确定性执行治理。人和 AI 面对同一套业务流程、共享同一套流程知识;软件为 AI 操作而写,代码只是副产品。

HTTP 合同是唯一真相:renderer 给人、HTTP 给脚本、tools/MCP 给模型——三个投影,一套事实。验收方式遵循项目自身的论题:**每个场景由两种执行者各跑一遍——人类走 renderer,agent 走合同(tools/HTTP),同一套场景,同一份日志。**

## 产品本体:Agent 在应用之外

UI4A 不把 agent 定义成应用中的一个聊天组件、内置模型或有限功能集合。应用始终是应用:它拥有自己的业务事实、状态、flows、actions、policies、事件日志和确定性执行语义,并主动暴露可供人、脚本和任意 agent 消费的操作协议。

Agent 是应用之外具有独立认知能力的智能主体。产品视角可以把它理解为一个具有推理、记忆、规划、交流和跨应用协作能力的数字助手;它的能力不由某个应用穷举或限制,也不需要把“总结”“比较”“解释”“规划”等原生认知逐项注册成该应用的 action/capability。Agent 可以同时理解和操作多个应用,同一个应用也可以被不同 agent 使用。

仓库提供的 `ui4a` CLI 是该边界的可组合参考客户端：它帮助任意外部 Agent 发现、读取、
操作和审计应用合同，但不承载智能。外部候选先进入系统内 Governed Draft；只有通过同源校验、
机械 diff 与 human approval 后才成为 Active truth。CLI、Draft 与内置 Chat 都不能重新定义权限。

```text
人类 ↔ Agent(理解、推理、记忆、规划、交流)
             │
             │ UI4A protocol
             ▼
应用(事实、entity、action、flow、policy、event log)
             │
             ▼
      确定性裁决与真实副作用
```

UI4A protocol 是两种本体之间的边界,不是 agent runtime。应用只负责决定向当前 principal 披露哪些事实、允许提交哪些业务提议以及怎样裁决状态变化;它不负责规定 agent 能怎样思考。Agent 可以自由形成临时衍生知识和计划,但不能把推导当成应用事实,也不能绕过应用协议产生业务副作用。

仓库中的悬浮 Chat、`packages/agent` 和 Assistant runtime 是一种参考组合与验收客户端,不构成应用本体,也不是 UI4A protocol 的唯一入口。Chat 可以独立于应用部署;审批、通知和责任决定可以通过其他通道到达人类。

## 第一产品价值:让所有软件 chatable

> **用户不需要先理解软件怎样组织和操作;可以直接问它知道什么,或告诉它自己想完成什么。**

LLM 时代的主要生产力提升,不是把软件更快地写出来,而是让人不再承担软件操作员的工作。一个一天生成、却仍要求每位用户花数周学习导航、页面、按钮和操作手册的软件,没有把 coding 速度转化为用户生产力。Coding Agent 已经展示了这种交互转变:人不再需要熟悉编辑器操作,而是表达开发目标;UI4A 要把同样的变化带给所有应用。

**Chatable 不等于在应用旁边添加聊天框,也不等于应用预定义 Agent 的能力清单。**它意味着应用协议足够完整,使外部智能助手能够围绕应用自由理解、推理、交流和行动。下面只是用户故事示例,不是 Agent 的能力边界:

- **应用理解**:用户可以直接问“这个应用是做什么的”“它能帮我完成什么”;LLM 从 application intent、sitemap、flows 和当前 scope 解释应用目的、能力与边界,用户不必先读产品手册;
- **事实认知**:用户可以询问应用中的授权事实;LLM 基于这些事实回答、总结、比较、归纳和解释,并保留来源。临时衍生知识不要求业务 action/capability,也不反向成为业务真相。是否持久化必须先有明确业务字段和 action 合同；publishing 的摘要不物化为 artifact;
- **流程引导**:用户可以说“带我走一遍发布流程”;AI 按应用声明的真实 flow 逐步解释当前步骤、所需输入和后续影响,由 renderer 呈现结构化表单与选项,而不是凭 prompt 编造一份教程;
- **委托操作**:用户表达目标、约束和授权;AI 读取应用当前事实与能力、追问缺失信息、执行真实 action/flow 并报告结果;人类只在需要判断和承担责任的地方介入。

这些结果来自 Agent 的通用智力与应用披露的真实处境共同作用。聊天可以是入口,审批和通知也可以通过其他通道完成,业务真相始终属于应用。

传统软件把成本重复施加给每个用户:

```text
软件发布
→ 每个用户学习操作文档和界面
→ 把目标翻译成页面、筛选、表单和点击
→ 每次任务重复操作并自行确认结果
```

UI4A 将这条路径压缩为:

```text
应用用机器可读合同声明事实、动作、约束和完成条件
→ 外部 Agent 快速读取当前处境
→ 用户用自然语言询问应用,或表达目标、约束与授权
→ Agent 基于事实自由推理并产出衍生知识,或代为操作应用
→ 副作用由应用确定性裁决并执行,只在责任点寻找人类
```

因此,用户不需要先知道信息分散在哪些页面,也不需要学习怎样完成一串点击;用户只需要提出问题或表达自己想完成什么。LLM 负责从授权事实中形成衍生知识,或把自然语言目标映射到应用已声明的 entity/action/flow/capability;应用负责事实、权限、guard、schema、确认、事件和重放。更强模型可以改善理解与沟通,但不能重新定义业务动作、风险或正确性。

产品价值有明确的优先级:

1. **Chatable**:应用可以自我说明;一句问题直接获得基于应用事实的衍生知识;一句请求获得真实流程引导;一句目标表达替代学习软件和人工点点点。这是首要用户价值;
2. **Human-governed**:关键动作由应用确定何时、由谁批准,保证一句话操作软件仍然可控;
3. **AI-improvable**:应用从高频 prompt、拒绝、失败和结果中发现并改善用户故事,形成后续复利。

这里的“快速读懂”不是让模型猜测一份可能过期的操作手册。应用合同本身就是可执行说明书:

- Siren entity 声明当前授权事实;
- action/schema/guard-results 声明现在能做什么、需要什么以及为什么;
- flow 声明多步用户故事与完成路径;
- confirmation/policy 声明哪些责任必须由人承担;
- event log 声明实际发生了什么并提供重放依据。

应用改进飞轮服务于上述第一价值,不能取代它:高频 prompt、拒绝、失败和恢复轨迹可以暴露缺失或不好用的用户故事;分析 agent 可以据此提议新的 flow/action/capability 或定义修订,经不变量、历史轨迹回放、机械 diff 和人类批准后激活。优化结果进入应用本身,同时改善人类、脚本和所有 agent,而不是只让某个 agent 记住一份 skill。

产品效率以用户故事结果衡量,不以生成代码量、tool call 数或模型自述衡量。核心指标是:

- 用户主动操作时间、点击和页面切换数量;
- 用户理解应用目的和找到适用能力所需的时间,以及对外部操作文档的依赖;
- 从目标表达至可离开的时间;
- 回答/总结/比较对授权事实的覆盖率、来源完整性与事实错误率;
- 引导模式下的 flow 完成率、退出步骤和所需人工求助次数;
- 用户故事完成率、首次完成率和平均澄清次数;
- 人工介入是否只发生在责任点;
- 错误对象、未授权副作用和审批越权必须为零;
- 同一用户故事在 flow/definition 版本升级前后的成功率、成本和恢复率变化。

“数周学习压缩为秒级目标表达”是产品方向,不是未经实测的固定时延承诺;每个具体用户故事都必须用真实执行证据量化。最终目标是:**过去训练人类适应软件;UI4A 让软件向 AI 解释自己,再由 AI 适应每一个人。**

## 背景

- 架构设计已完成(见 `docs/UI4A-v2(重排版):界面作为合同,应用作为数据,能力作为边界.md`,架构正典);
- 技术选型已定(见 `docs/UI4A-技术选型.md`):全部用社区轮子,不自造——XState 定义业务流,PostgreSQL append-only 存事件,Siren 投影合同,Cedar 裁决权限,Keycloak(RFC 8693)发委托,Temporal 跑能力与委托,AI SDK + assistant-ui 聊天,A2UI 作渲染协议,RJSF 哑兜底,shadcn 拼骨架;
- 业务平面(引擎 + 三层裁决 + Siren 投影 + Agent 循环 + 悬浮聊天)源自原 Clojure demo；T15 已将产品运行时收敛为 AI-first LLM，旧 rule driver 仅保留为显式协议测试 fixture；
- 本项目 = 按图纸施工:从零实现完整应用。

## 成功标准(DONE 的定义)

以下场景套件、T15 U1–U23、T16 S1–S32、T17 U1–U24 与 T18 U1–U22 Story Eval 及不变量全部通过,外加一次人工 demo 走查。

### AI-first 用户故事

Assistant 的自然语言理解、多轮目标形成、授权事实阅读、总结/比较/解释、动态 action/capability 发现与副作用授权，以 `tracks/t15-ai-first-dynamic-assistant_20260822/user-stories.md` 为准。真实 LLM Eval 是动态能力证据；rule/scripted driver 仅用于协议测试。

### Presentation Plane

Chat Agent 只决定是否呈现、呈现哪个 subject 和 intent；完整 catalog、Surface、bindings 与依赖不进入 Chat 上下文。Application 激活后预生成参数化 Recipe，运行时按 user pinned/cache → promoted/candidate Recipe → generic → Presentation Agent 的顺序解析。Sidecar 只保存 binding-only 展示结构和 provenance，按用户跨 Session 复用；业务事实、guard 和 action 始终实时读取并由引擎裁决。

### App 创建边界

当前产品不在内置 Chat 中创建完整 App。候选方向是由应用外置 Agent 理解需求、整理用户故事并起草 Application Bundle，再通过 UI4A meta 合同提交；UI4A 负责机械 schema/invariant 校验、版本 diff、human approval、激活、审计和 replay。内置 `create-app` 向导、页面设计器和 rule-based App 生成器不属于当前 DONE。

### Coding Capability Executor

通用 Coding Agent 可以作为应用能力的执行器，但不成为 Application 的业务真相或第二条写路径。
`coding.execute` 由软件变更 Flow 的声明 action 启动；服务端 profile 选择真实 provider，UI4A
创建隔离 worktree，Temporal 保存 durable Run，事件日志保存有界 raw/normalized 轨迹和
content-addressed result。成功只把 Flow 推进到 `review-ready`。Agent 接受结果必被拒绝；人类
接受前重新验证 base、路径、tests 与 hash，首切片只记录 receipt，不 merge/push/deploy/activate。
Codex 是 reference adapter；Claude/Gemini 仅验证 SPI 兼容；Hermes 只作为分层设计参考。

### 参考 Assistant 组合合同

以下条目约束本仓库提供的参考 Assistant 如何消费 UI4A protocol,不定义外部 agent 的完整能力边界:

- LLM 可直接读取和处理当前 principal 已授权的 Siren facts，并用 `answer`/`clarify` 完成临时对话；认知动词不要求 application capability。
- 正式、可复用的模型产物进入带 source/model/schema/content-hash provenance 的 capability artifact；写回字段或迁移状态必须另走声明 action 与必要确认。
- 每条 user/assistant 原话 append-only 留痕；下一轮同时消费有界近期原文与从日志重建的活动目标、指代、约束、待澄清项和授权证据。
- effect authorization 必须引用 user message id 与逐字原话；执行事件记录 declaration → guards → schema → confirmation，解释从事件投影生成，缺少授权时不得补造理由。
- provider profile 仅由外部 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 提供。缺项、端点错误或超时都诚实失败且零业务副作用，不切换模型或 driver。

### 基线场景(业务平面,继承自已验证 demo)

| # | 场景 | 断言 |
|---|---|---|
| B1 | 委托发布:"帮我发布一篇文章" | 三步按 schema 填充 → 发布 → 文章真实落库 |
| B2 | 点名下线:"把 post-welcome 下线" | 经子实体链接直达,精确下线一篇,其余未受影响 |
| B3 | 审核队列:"审核所有待处理评论" | pending 清零,事件留痕 |
| B4 | 失败呈现:配置无效 API key | 401 如实进入对话,委托不崩溃 |

### 切片场景(v2 核心,每个对应一条架构主张)

| # | 场景 | 断言 |
|---|---|---|
| S1 | 确认门 | agent 执行高风险 archive → 动作未生效,挂起为 pending 实体 → 人类 approve(actor=human)→ 生效;日志含 actor/principal/信道 |
| S2 | 最小 meta | agent 经 `_meta` 提交"新增一条边":缺 guard 的非法定义被拒且留痕 → 修正 → 人类在机械 diff 上批准 → sitemap 重生成 → agent 下一步即可用新动作,无任何 prompt 改动 |
| S3 | 委托实体 | 两个 agent 并发操作同一资源:一个成功、一个拿到带原因的拒绝(裁决器即并发控制);杀掉执行中的委托,新 agent 从实体续跑 |
| S4 | plan-exec | 六步向导在一次决策内完成,轨迹为一条批量裁决记录,每步裁决可见 |
| S5 | 渲染 | 薄 Presentation Request → Recipe/User Sidecar fastpath → binding-only semantic Surface → A2UI 实时解引用；交互重新按当前合同裁决 |

### 不变量(铁律的自动化形式,持续运行,违反即迭代无效)

| # | 不变量 | 验证方式 |
|---|---|---|
| I1 | AI-first 动态助手 | 配置真实 LLM 后 U1–U23 达到 Story Eval 门槛；生产 Assistant 无 rule fallback |
| I2 | 事实不可发明 | property test:渲染 spec 解引用后的值与实体快照一致 |
| I3 | 交互必背书 | fuzz 所有可点元素:提交必映射到已声明 action,合同外按钮无法提交 |
| I4 | 审批不委托 | 以 agent 身份执行 approve 必被拒 |
| I5 | 可重放 | 从空库重放事件日志,实体状态 hash 与重放前一致 |
| I6 | 拒绝留痕 | 每个被拒动作在日志中带原因,且可作为下一步决策上下文获取 |
| I7 | 模型故障安全 | LLM 缺失/失败/超时时诚实失败且零业务副作用；人工 renderer、审批和合同操作仍可用 |

## 五条铁律(不可违背)

1. **AI-first、机械治理**:LLM 负责理解、对话与规划;机械层负责事实、权限、裁决、确认、审计和重放。模型不可用时诚实失败且零副作用,人工 renderer 保持可用;不以 rule driver 复刻智能;
2. **binding-only**:模型只发引用不发内容——渲染器从实体缓存解引用,模型发不出一个数字;
3. **交互必须 action 背书**:任何可点的按钮必须绑定到已声明 action,提交经引擎裁决;
4. **事实永不发明**:字段的值来源必须声明(默认/查找/引出/效果产出/意图/起草+选择),agent 猜只对价值载体字段合法且过选择门;
5. **审批不委托**:`approve` 永远 `actor-is-human`;审计渲染(事件流、机械 diff)路径零 AI。

## 施工顺序(五条垂直切片)

1. **确认门切片**:guard 挂起语义 + pending 确认实体 + notify(Temporal activity)+ 收件箱;Cedar 风险策略;actor/principal 入日志;
2. **最小 meta 切片**:flow 定义从代码挪进事件日志(XState machine-as-JSON)+ definition-lifecycle + 激活不变式 + 机械 diff + RJSF/Stately 做 BIOS;
3. **委托实体切片**:agent 执行迁入 Temporal workflow——崩溃续跑、N 路并行、舰队队列页免费获得;
4. **plan-exec 切片**:批量裁决计划,一次决策、机器速度执行;
5. **骨架与渲染切片**:widget 画布 + 渲染词汇表(TanStack Table / shadcn Charts / Tremor / react-chrono / React Flow / dnd-kit,注册为 A2UI 扩展目录)+ 主页态势投影。

**每个里程碑结束系统必须处于可运行状态**(切片化施工,任何时刻停下不留废墟)。

## 约束与协作规则

- 技术栈严格按 `docs/UI4A-技术选型.md`,不自造轮子;
- 违反任何一条铁律 = 该迭代无效;
- 实现与文档冲突时:先在 `DECISIONS.md` 记录分歧与决定,再动代码或文档。

## 范围边界

DONE = **demo 质量**。生产化(多租户、部署硬化、压测、真实 SSO 对接)显式排除在外。

人工评估点(不阻塞 DONE,单独记录观察):确认疲劳的真实感受、澄清对话的收敛体验、机械 diff 的可读性、渲染凝固后的稳定性。
