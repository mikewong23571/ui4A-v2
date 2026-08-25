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
