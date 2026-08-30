# T39 Meta 合同驱动治理体验 — Specification

## 类型

Feature：Meta Human Control Plane 的合同驱动 UI/UX 收敛。

## Overview

当前 Meta 协议已经通过 Siren entity、links、actions、guard-results 和 JSON Schema
提供完整治理合同，但人的 canonical 展示仍存在三类偏差：

1. canonical `/meta/entity` 与 Flow、Activation 等旧特化路由形成两套体验；
2. 通用 Renderer 主要展示 class、rel 和字段键，任务信息、责任点和关系层级不足；
3. Draft 表单和 Scope 呈现暴露部分协议机械细节，未清楚区分人类输入、客户端生成字段、
   服务端字段和注意力镜头。

本 Track 不重做业务引擎，不创建传统的每类型页面。目标是引入可治理的“语义 Trait +
有界 Hint”合同，让 Meta sitemap、entity projection 和 Renderer 从同一声明决定：

- 什么是定义资产、候选、责任点或系统对象；
- 首屏应强调什么；
- 集合成员应显示哪些概览字段；
- 动作应以内联、普通或责任点姿态出现；
- 哪些字段由人填写、客户端生成或服务端注入；
- raw、合同细节和任务信息如何分层。

人类仍走 Renderer，Agent/CLI 仍走同一 Siren/HTTP 合同；Hint/Trait 是合同数据，
不是只给像素 UI 使用的第二协议。

## 北极星与硬门禁

以 `conductor/product-vision.md` 为最高裁决依据。

### 换 Application 判据

> 这段代码换一个 Application 是否需要修改？

如果需要修改 Renderer、页面、路由或硬编码文案才能支持新 Application，本 Track 即失败。

### 禁止事项

- 禁止新增每 Application、每实体类型的独立业务页面。
- 禁止在 React 中用 rel、Application 名、action 名或实体类型分支决定内容结构。
- 禁止在 Dashboard 中维护固定 Meta surface 清单。
- 禁止在 Renderer 中硬编码生命周期状态枚举、关系翻译表或应用文案。
- 禁止把 CSS、Tailwind class、像素、组件名、React layout 名写进业务定义。
- 禁止创建仅供人类 UI 使用、Agent 无法读取的平行展示协议。
- 禁止让 Hint/Trait 进入授权判断、业务 fold 或事件真相。
- 禁止通过 AI/LLM 生成审批事实、diff、checks 或治理决定。
- 禁止保留 canonical 与旧路由两套不同的实体展示真相。

## 合同设计原则

### Trait：稳定语义

Trait 表达对象承担的治理语义，不表达具体组件或布局，例如：definition asset、
editable candidate、governance decision、auditable、system definition、
collection summary、human responsibility point。

Trait 可以影响通用 Renderer 选择呈现词汇，但不得包含 Application 名、具体实体 rel、
action 名、CSS、组件名、像素尺寸或事实值。

### Hint：可替换的展示偏好

Hint 表达有界、可验证、可降级的呈现偏好，例如：

- 概览字段及顺序；
- 信息密度；
- 首页分组及顺序；
- 首屏优先级；
- responsibility 区域采用 inline 或 sticky；
- 合同细节默认展开或收起；
- raw 默认保持收起；
- collection 使用 table、decision-list 或 compact-card 等有限词汇。

Hint 必须是版本化白名单，只引用已声明字段、links、actions 或 traits；无效时产生结构化
诊断并退回安全 generic；不改变实体事实、权限、action availability 或执行结果；Agent/CLI
可从同一 sitemap/entity 投影读取。

### 字段输入归属

动作字段必须声明输入归属：

- `human-authored`：由人类表单展示并填写；
- `client-generated`：由可信客户端生成，如 idempotency key；
- `server-owned`：由服务端身份、授权或处境上下文注入，Renderer 不显示输入框。

具体 wire shape 由 Phase A disposable spike 定型，但上述三类语义是规格约束。

## Functional Requirements

### FR1 Trait/Hint 合同

- 在 shared definition/Siren projection 中增加版本化 Trait/Hint 类型。
- Meta sitemap surface 可声明治理分组、顺序、摘要角色和首屏优先级。
- Exact entity 可声明详情 traits、责任点姿态和披露 hint。
- Collection member 复用现有 presentation field role/overview 体系声明概览字段，避免平行机制。
- Trait/Hint 同时对 Renderer 与 Agent/CLI 可见。
- 无 Trait/Hint 的既有合法实体保持安全 generic fallback。

### FR2 单一 canonical Renderer 路径

- `/meta/entity?rel=...` 是所有 Meta exact entity 的唯一人类展示入口。
- Flow、Activation、Capability、Application、Agent Definition、Draft 通过 class/trait
  registry 选择通用或特化词汇。
- Flow canonical 页面具备拓扑、节点、动作、字段、版本历史和关系。
- Activation canonical 页面具备 checks、diff、来源和 human-only 决策区。
- Capability canonical 页面以业务 intent 和输入/输出边界为主，而非原始属性 dump。
- 旧 Meta 友好详情路由不再维护第二套视图。
- 新增已知 Meta class 只需注册通用词汇或提供 Trait/Hint，不修改壳与路由。

### FR3 任务优先的 Meta 首页

- `/meta` 继续完全从 Meta sitemap 发现内容。
- 首页依据声明数据组织为治理任务区域，而非七个等权资源卡。
- 至少表达“需要我决定、候选与异常、定义资产、系统自举”等语义组，但组名、顺序和成员来自声明。
- 无成员的责任点分组不占首屏主位，但入口仍可发现。
- 每个计数必须是“数词 + 对象 + 状态”，不得展示裸数字。
- exact surface 仍可通过搜索或 collection 关系到达。
- 不因首页聚合而窄化公开 Meta sitemap 或 entity 合同。

### FR4 Draft 创建与字段归属

- `policyScope`、actor、principal、authorization、Provider/profile 等服务端字段不得作为人类输入框暴露。
- `commandId` 等 client-generated 字段由宿主生成，并在提交前进入同一 action schema 校验。
- Draft payload 必须有明确可操作的编辑入口，不得出现“schema 必填但 UI 无控件”。
- target 与 sources 优先使用当前授权合同发现出的选择器，不得要求用户记忆 rel。
- 表单标签、说明、枚举标题来自合同声明。
- 创建、校验或提交失败时保留已填内容，并在对应字段附近显示结构化、可行动原因。
- 成功后原位反馈 Draft 身份、状态和下一步，不要求刷新或重新搜索。

### FR5 Scope/注意力语义

- UI 将当前 `scope` 呈现为“当前视角”或等价任务语言，不暗示它授予权限。
- 前端不得硬编码 `publishing` 等默认 Scope。
- 无显式视角是一等状态；服务端 sitemap 可以返回 effective lens，但不得扩大授权。
- “当前视角”和“可访问应用集合”必须在文案与视觉上分离。
- 切换视角只改变 URL/注意力落点；授权继续由 grantedApplications × audience 决定。
- Meta links、返回路径、表单成功和错误恢复均保留显式视角。

### FR6 Collection 与搜索

- Application collection 概览至少可声明 title、intent、version、Flow/Capability/Policy 数量。
- Flow、Activation、Draft、Agent Definition collection 通过同一 overview hint 决定列或卡片内容。
- 有责任点动作的成员可按 Trait 进入 decision-list；普通只读成员使用 table 或 compact-card。
- 搜索结果不得静默截断；若只显示前 N 项，必须显示总数与继续查看入口。
- 状态、类型等 facet 从声明或摘要派生，不在页面硬编码状态清单。
- 分页和筛选只跟随合同声明的 links/query traits，不在前端推算页码或发明值域。
- 不带参数的 HTTP discovery 合同继续保持全量承诺。

### FR7 人类责任点

- 带 human responsibility trait 的 pending entity，在详情首屏展示“需要决定什么”。
- 决策区可由有界 Hint 选择 inline 或 sticky，不由 action 名分支决定。
- diff、checks、风险摘要和 provenance 紧邻决策区。
- approve/reject 仍只来自当前 Siren actions，并在提交前 fresh read。
- guard 阻断原因必须可见，不得只存在 tooltip。
- 高风险动作保持两段确认。
- 成功后责任点原位转为已决状态，并从待决集合退出。

### FR8 任务、合同与 Raw 三层披露

- 首层回答：这是什么、当前状态、为什么需要关注、下一步是什么。
- 第二层展示：版本、schema、关系、SubmissionPolicy、checks、provenance。
- Raw 层展示：完整授权后的 Siren JSON、class、rel 和内部字段。
- `self` 等机械关系默认不占人类关系主区。
- 关系主标签优先使用合同 `link.title`；raw rel 作为次级审计文本。
- Raw 保持局部可展开，不成为独立站点或顶级导航。

### FR9 安全降级

- 未知合法实体继续使用 generic detail/collection fallback。
- 未知 Trait、未知 Hint 版本、非法字段引用或不允许的布局值必须结构化失败或忽略并留诊断。
- Hint 不得注入 HTML、CSS、URL、脚本或组件名称。
- secret-shaped properties 继续 redaction。
- Renderer 选择冲突继续 fail-closed。

### FR10 可执行治理

增加低误报、仓库内治理断言：

- 已知 Meta exact class 的 canonical Renderer 决策覆盖；
- 禁止公开 action schema 暴露 server-owned 字段；
- Trait/Hint 白名单和版本校验；
- 禁止 Trait/Hint 包含 CSS、组件名、Application/rel 特判；
- Meta 页面不得重新出现固定 surface inventory；
- canonical 与旧路由不得形成双实现；
- scope/attention 数据不得进入 authorization 函数签名。

## 用户故事与 UI/UX 验收

### US1 治理者进入 Meta 首页

作为治理者，我想一眼看到需要我处理的决定和异常，以便先承担责任，而不是先理解资源目录。

Given 存在待审批 Activation、invalid Draft 和多个定义资产；When 进入 `/meta`；Then：

- 首个视口优先出现“需要我决定”和“候选与异常”；
- 待审批数量使用“2 个候选等待决定”类完整文案；
- Application/Flow/Capability 位于“定义资产”区域；`meta/self` 位于弱化的系统区域；
- 视觉效果：责任点对比度最高，定义资产次之，系统自举最低；空责任点组不渲染大块空卡；
- 两次点击内可从首页到达任一待审批详情，默认无需打开 raw 即能判断下一步；
- 390px 下分组纵向排列，无页面级横向滚动；
- Dashboard 分组、标题、顺序均来自 sitemap Trait/Hint；
- Agent 读取同一 sitemap 能获得相同分组与优先级语义。

### US2 从 Application 进入 Flow canonical 详情

作为定义维护者，我想从 Application 查看关联 Flow，并看到完整拓扑和版本信息，以便理解定义而不进入另一套页面。

Given `publishing` Application 关联 `article-drafting`；When 从 Application 点击该 Flow；Then：

- URL 使用 canonical `/meta/entity?rel=meta/flow:article-drafting`；
- 页面不出现“未知类型通用合同视图”；
- 首屏显示业务标题、状态、版本和可用动作，随后显示拓扑、节点/动作摘要、版本历史和 Application 回链；
- 复杂 action/effect/schema 详情默认收起或局部滚动；
- 返回 Application 时保留当前视角；Application → Flow 不超过一次成员点击；
- canonical 与旧友好路由不存在内容差异；
- Agent 对同一 rel 读取的 nodes/actions/links 与页面消费一致。

### US3 人类提交一个 Governed Draft

作为定义维护者，我想通过明确的候选定义入口提交 Draft，以便不用填写身份、Scope 或幂等键等系统字段。

Given 当前视角为 publishing；When 展开“提交候选定义”；Then：

- 表单只显示 human-authored 字段；`policyScope`、actor、principal 不出现；`commandId` 由宿主自动生成；
- kind 使用带人话标题的选择器，target 从可达定义中选择，payload 有结构化编辑/粘贴/导入区域，sources 使用可搜索对象选择器；
- 视觉效果：基础信息先显示，高级 provenance 默认收起；
- 字段错误在对应字段附近显示，保留输入并自动聚焦首个错误；
- Esc/取消关闭表单并恢复焦点到触发按钮；
- 成功后原位显示 Draft id、状态和“继续校验/审查”入口；
- 390px 下字段、按钮和 JSON 编辑区无页面级横向滚动；
- Agent/CLI 从同一 action schema 读取相同字段归属，并可生成稳定 commandId。

### US4 当前视角不冒充权限

作为具有多个 Application grant 的维护者，我想切换关注应用，同时清楚知道这不会改变权限。

Given 用户可访问 publishing 和 governance；When 切换当前视角；Then：

- UI 使用“当前视角”而不是“当前 Scope”作为主标签；
- 可访问应用集合只在只读说明或“当前在哪”弹层中出现；
- 切换后 URL 更新并保留返回目标，页面不声称切换扩大或缩小权限；
- 无显式视角时不自动写入 `publishing`；
- 视觉效果：当前视角是轻量 chip，不与批准/驳回等责任动作争夺层级；
- 切换前后的授权实体并集保持一致，授权外对象继续结构化 denied；
- Agent/CLI 不依赖浏览器视角也可完整使用规范合同。

### US5 Application 集合按声明显示概览

作为维护者，我想在 Application 列表直接看到用途和组成，以便不逐个进入详情。

Given summary 声明 intent 和组成概览；When 打开 collection；Then：

- 每行或卡片展示 title、intent、version 和声明计数；原始 class/rel 退居辅助审计文本；
- 不显示与任务无关的固定徽标；
- 视觉效果：桌面采用紧凑 table/row，390px 退化为单列 compact card；
- 业务标题为主要可点击目标；
- 新 Application 无需修改 React 即按同一 hint 展示；
- 修改 overview hint 后 Renderer 自动调整列及顺序；
- Agent 读取 member projection 可获得相同 overview 语义。

### US6 人类处理 Activation 决策

作为审批者，我想在一个页面内理解变更、检查和影响，并明确批准或驳回。

Given Activation 处于 pending-approval；When 进入详情；Then：

- 首屏显示“需要批准什么”、目标 Flow、候选版本和提议来源；
- checks 以通过/失败摘要呈现，失败项优先；diff 紧邻决策上下文并可局部展开；
- approve/reject 区域按 Hint sticky 或首屏 inline，动作只来自当前 Siren actions；
- reject reason 必填且错误原位显示，guard reason 可见；
- 视觉效果：批准为主要责任动作，驳回与危险语义清晰区分，raw 不参与主决策层；
- 无需打开 raw 即可完成决定，从待审批集合进入并完成决定不超过两次页面点击；
- 成功后原位显示已决状态、动作消失、集合计数同步；
- Agent 执行 approve 继续被拒绝。

### US7 关系使用任务语言

作为维护者，我想理解实体与 Application、Flow、Draft、Activation 的关系，而不是阅读 `self` 和裸 rel。

Given links 带声明 title；When 查看关系区；Then：

- link title 是主要标签，raw rel 是弱化辅助文本，`self` 默认不出现在关系主区；
- 点击关系保留当前视角；无 title 时诚实回退 rel，不由 Renderer 猜文案；
- 视觉效果：关系采用紧凑链接组或 breadcrumb，不渲染大块空卡；
- Agent 读取同一 `link.title/rel/href`，不存在只给人的翻译表。

### US8 新增未知 Meta surface

作为平台维护者，我想新增符合合同的 Meta surface，而无需修改 Dashboard 或为它写页面。

Given sitemap 增加未知合法 collection 和 exact entity；When 重载 Meta；Then：

- 首页按声明分组自动出现新入口；collection 使用通用概览词汇；
- exact entity 使用 trait 对应词汇或安全 generic fallback；
- 不修改 Dashboard、路由或每类型 React 分支；
- 非法 Hint 不导致白屏或 CSS/脚本注入，页面显示结构化诊断且 raw 仍可审计；
- Agent 同时发现该 surface、Trait、Hint、links 和 actions。

### US9 键盘、响应式与错误恢复

作为只使用键盘或窄屏设备的维护者，我想完成完整治理流程。

Then：

- 所有触发键、筛选、关系、表单和决策动作可键盘到达；
- 展开表单后焦点进入首个字段，取消后恢复触发键；
- sticky 决策区不遮挡正文和移动端按钮；
- 390px 无页面级横向滚动，table/diff/JSON 仅局部滚动；
- loading 使用稳定 skeleton；
- 404、unauthorized、network、stale/CAS 保留当前 URL 和用户输入；
- 错误修复后可原位重试，无需从首页重新导航；颜色不是唯一状态信号。

### US10 非传统软件与双门一致性终审

作为平台守护者，我想证明新体验来自合同，而不是另一套传统页面实现。

Then：

- 范围内源码不存在 Application 名、具体 rel、具体 action 名驱动的展示分支；
- Dashboard 不维护固定 surface 清单，Renderer 不维护状态或关系文案映射表；
- Trait/Hint 不包含 CSS、像素或组件名；换一个 Application 无需修改页面代码；
- 人类与 Agent 对同一场景发现同一 entity、links、actions、guard、schema、Trait 和 Hint；
- 所有功能按钮都能追溯到当前 Siren action；
- UI 展示效果的变化只需修改声明或通用词汇；
- `pnpm governance:strict`、`pnpm check` 和相关 E2E 全绿。

## Non-Functional Requirements

- 不新增 UI framework、state store、router、数据库或业务事件族。
- 优先复用 Siren projection、presentation field roles、Renderer registry、RJSF、React Flow、diff 和 shadcn。
- Trait/Hint 解析纯函数化并在正确 package 边界测试。
- Meta Renderer 保持零 LLM、零 Sidecar；Collection 首屏不进行成员 exact N+1。
- 新代码覆盖率目标不低于 80%，安全和授权边界 100%。
- 遵守 GR1–GR5、D51、D53；文件增长触线时按功能边界拆解，不登记新例外。
- 实施前必须进行 disposable spike，验证合同归属、overview 复用、canonical 迁移、RJSF 字段归属和非法 Hint fallback。
- Spike 只形成证据和详细方案，不直接成为生产实现。

## 验收证据

每条用户故事使用浏览器真实操作、关键交互态截图、DOM 语义断言、URL/焦点/展开状态记录、
桌面与 390px 视觉检查、对应 CLI 或 HTTP 合同探针，以及 pass/pass-with-observations/fail 结论。

不新增永久 per-track Playwright 配置或脚本。可机械长期执法的行为进入现有单元、集成、E2E 或 governance gate。

## Out of Scope

- 创建完整新 Application 的产品内向导。
- 修改业务 Flow、事件 fold、定义激活语义或 D51 授权模型。
- 将 Meta 接入 Presentation Agent、Recipe 或 Sidecar。
- AI 生成审批结论或替代 human approval。
- workstation、Canvas 或 Chat 的整体视觉改版。
- 建立 raw 独立站点。
- 自由布局 DSL、页面设计器、CSS-in-definition。
- 每实体或每 Application 的定制 React 页面。
- 新增 UI 框架、状态库或第二套路由器。

