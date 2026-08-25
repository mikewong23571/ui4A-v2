# UI4A 领域对象清单(meta 平面与 infra 级)

> 范围:平台自身提供的领域对象——meta 平面(定义层)与支撑全域的 infra 级对象,含前端
> 呈现层对象。**不含业务层对象**(post/comment/articles 等由应用定义,不在此列)。
> 依据:代码现状(engine siren 投影、db 表结构、render 词汇表),2026-08-25 梳理。

## 一、Meta 平面领域对象(`/_meta` 合同站,rel 前缀 `meta/`)

Meta Human Control Plane 呈现与治理的全部对象;人类与 agent 读同一份 Siren 合同,
写操作(编辑动词/激活审批)经同一裁决器,human-only 约束由机械层强制。

| 对象 | rel | 实质 | 代码位置 |
| --- | --- | --- | --- |
| Flow Definition | `meta/flows` / `meta/flow:<name>` | 流程定义 + 定义生命周期(draft→active→deprecated);子实体:node-definition、action-definition、definition-version(版本历史摘要,内嵌定义全文,无独立版本 rel) | `packages/engine/src/siren.ts` `projectFlowDefinition` |
| Application | `meta/applications` / `meta/application:<name>` | 应用定义:打包 flows/capabilities/policies 的 definition bundle;六个已装应用(default/publishing/community/development/editorial/governance) | `siren.ts` `projectApplication` |
| Activation | `meta/activations` / `meta/activation:<id>` | 定义激活请求;pending 挂 approve/reject(**human-only**,投影无 actor 上下文 fail-closed);已决策为审计视图(无动作) | `siren.ts` `projectActivation` |
| Capability Definition | `meta/capabilities` / `meta/capability:<name>` | 能力声明:name/title/kind/extract|effect/intent/input/output/schema/scope/executor | `siren.ts` `projectCapability` |
| Governed Draft | `meta/drafts`(+ `draft:<id>`) | 治理草稿:SHA-256 内容寻址、CAS、事务性接受;agent 产出的候选定义只能进 Draft,只有人类可激活 | `apps/web/src/engine/drafts.ts` |
| Agent Definition | `meta/agent-definitions` / `meta/agent-definition:<ref>@<version>` | 专业化 agent 定义注册表:内容寻址、精确版本、birth-pinned 派发;定义即提案,激活走 Draft 治理 | `apps/web/src/engine/agent-definitions.ts` |
| Definition Lifecycle(自举) | `meta/self` | lifecycle 常量自身的只读视图 + 种子 guard 集(引擎自举证据) | `siren.ts` `projectSelf` |

## 二、Infra 级领域对象(支撑整个应用,跨业务)

### 2.1 事件与投影底座

| 对象 | rel / 存储 | 实质 |
| --- | --- | --- |
| Event Log | `events` 表(append-only) | 唯一真相源;domain 分 business/presentation/draft/agent-definition 等;一切现状(含本表全部对象)都是它的可重建投影 |
| Confirmation | `confirmation:<id>` | 人类确认闸;effect 挂起 → 人类 approve/reject,approval 不可委托(铁律) |
| Inbox | `inbox` | pending 确认集合(含通知送达标记) |
| Delegation | `delegations` / `delegation:<workflowId>` | Temporal 持久执行的事件投影(worker 是第二写者);读路径零 Temporal 依赖 |
| Agent Run | `agent-run:<id>`;`agent_run_projection` / `agent_run_payloads` 表 | 唯一 run 模型(canonical),出生钉死定义版本 |
| Chat Session | `chat:<sessionId>` | 消息/turn/导航完成/呈现回执全是事件投影;聊天是 agent 入口,不是旁路命令通道 |
| Flow 实例别名 | `flow:<name>` → 实例实体 | 服务层投影补全(向导类 flow 别名解析到当前实例) | `apps/web/src/engine/flow-entry.ts` |
| Bootstrap / Migration | `ui4a_bootstrap_state` / `ui4a_schema_migrations` 表 | 种子与 schema 演进状态 |

### 2.2 呈现平面(可重放 sidecar,永不是业务真相)

| 对象 | rel / 存储 | 实质 |
| --- | --- | --- |
| User Sidecar | `sidecar:<fingerprint>`;`presentation_user_sidecars` 表 | 用户级呈现侧车;durable key = principal/policyScope/subject/intent/deviceClass(不含 sessionId);pin/revert/patch/promote 人类生命周期 |
| Application Recipe | `render-recipe`(coordinator 注册表 + `render-recipe-promoted` 事件) | sidecar 参数化晋升的应用级呈现配方(promoted 候选 fastpath) |
| Render Spec | `render-specs` / `render-spec:<concern>` | 较早的渲染声明通道(frozen collection 消费) |
| Presentation Request / Receipt | `presentation:<requestId>` 事件族 | 薄边界:chat 只提交 subject/intent/constraints/delivery 并保留回执引用;catalog/surface/binding 不出呈现平面 |

### 2.3 身份与部署运行时

| 对象 | 实质 |
| --- | --- |
| OIDC Credential | Keycloak(ui4a realm)签发的 application credential;scope = `ui4a:read/write/approve` + `ui4a:policy:<scope>` |
| Browser Session | 单副本进程内私有 store,opaque 完整性保护 cookie;Web 重启即失效(D35 已接受) |
| Delegated Token | token-exchange 委派凭证(human granted ∩ agentScopes 收窄,剥离 `ui4a:approve`);canonical 委派身份校验 |
| Deployment Config + Secrets 合同 | `ui4a-deployment-secrets`(settings/secrets JSON);preflight 强制,含 LLM 合同(baseUrl/model/apiKeyRef)与 executor profiles |

## 三、前端(呈现层对象)

| 对象 | 实质 | 代码位置 |
| --- | --- | --- |
| Surface Tree / A2UI Message Bundle | 声明式表面(binding-only,零事实值)→ 编译 + hydration 注水 | `apps/web/src/render/presentation/` |
| Catalog + Catalog Adapter | 渲染词汇表协商(`catalog.json` + fingerprint 校验) | `render/presentation/catalog-adapter.ts` |
| Words(词汇渲染器) | `chart / detail / diff / entity-link / flow / form / kanban / markdown / stat / table / timeline` | `apps/web/src/render/words/` |
| Canvas | surface 宿主:action gate(每个功能控件过合同裁决)、sidecar 控制条(pin/设为团队默认/为什么这样展示) | `apps/web/src/components/canvas-body.tsx`、`render/canvas/` |
| Meta 控制台组件 | sitemap 驱动发现、class renderer registry 选视图、跨平面链接保 scope;原始合同仅审计用 | `apps/web/src/components/meta/` |
| Chat Panel | assistant-ui 适配 + SSE(thinking/step/final 帧);clientView 上报(客户端路由/可见主体——合同平面归属由它决定) | `apps/web/src/components/chat-panel.tsx`、`chat/client-view.ts` |

## 分层一句话

- meta 平面对象定义"应用是什么"(定义、打包、激活、草稿、agent 定义);
- infra 对象回答"真相在哪、谁在执行、谁批准了"(事件日志、投影、确认、委托、会话、身份);
- 前端对象只负责"把授权事实呈现出来"(binding-only,行动作闸)。

## 根与相互作用

### 两个根

1. **真相之根:append-only 事件日志**(`events` 表)。唯一权威;所有对象都是它的
   可重建投影——投影可丢弃(sidecar stale 重建、chat 重放、web 重启),日志在则世界在。
2. **语义之根:定义生命周期自举**(`meta/self`)。"定义如何被起草、激活、废弃"本身
   被建模为一个 flow definition(`DEFINITION_LIFECYCLE_FLOW` 常量)——治理所有定义
   的机器与被治理对象共享同一套语义,引擎用自己定义自己,无需外部权威启动治理。

贯穿脊椎:一切执行都过 **declaration → guard → schema** 同一裁决顺序,无旁路。

### 四个闭环

- **闭环一:定义 → 行为。** Flow Definition 经 Activation(人类批准)激活后,立刻成为
  业务平面 exec 的裁决依据——同一份定义,人类 UI、agent 合同读取、引擎 guard 三方共用。
  定义不是文档,是可执行的边界。
- **闭环二:行为 → 定义。** Agent Run(经 Delegation 在 capability 平面执行)产出的候选
  定义只能进入 Governed Draft;人类审查机械 diff、批准激活 → 定义更新 → 回到闭环一。
  agent 可以写定义,但只有人类能让它生效——agent 生产力与人类治理权共存而非互斥。
- **闭环三:呈现 ↔ 会话。** Chat 发起薄 Presentation Request(只有 subject/intent),
  Broker 重新授权、解引用实时事实、规划 Surface;canvas 渲染后把 clientView(用户在看
  什么)回报给 chat,成为下一轮 agent 决策的上下文——用户所在位置决定回合的合同平面
  (2026-08-25 修复)。呈现永不反向污染事实(binding-only 旁路)。
- **闭环四:确认闸。** 带 effect 的执行可在 Confirmation 挂起进入 Inbox,只有人类
  approve 才继续;审批同样是日志事件——"人类在场"是日志事实,不是 UI 约定。

### 相互成就的关节点

- **同一份合同,两个读者。** 人类 renderer 与 agent driver 读同样的 Siren entity/action/
  guard;meta 平面每定义一个新能力,人类与 agent 同时获得,无需分别为 UI 和 API 建设。
- **日志让投影廉价,投影廉价让治理敢做。** 一切可重放,因此 Draft 可拒绝、sidecar 可
  stale、定义可废弃——治理动作零沉没成本。
- **Draft 让 agent 可信,agent 让定义进化。** Draft 闸把 agent 产出变成系统自我演进的
  安全供给。
- **human-only 不变量是自动化的信用来源。** approve 拒绝 agent、executor 选择服务端
  拥有、sidecar key 绑定已认证 principal——机械约束不可谈判,上层才敢把更多操作开放
  给 agent。

**一句话:根是"日志 + 自举生命周期",成就来自闭环——定义产生行为,行为(经 agent)
产生新定义,呈现与确认把人类始终留在回路上。**
