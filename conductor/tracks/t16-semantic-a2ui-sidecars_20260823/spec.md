# T16 语义化 A2UI 呈现与 Render Sidecar fastpath — Spec

> Track ID: `t16-semantic-a2ui-sidecars_20260823` · Type: Feature · 状态: approved

## Overview

当前 `focus` 固定映射到单一 `detail` 词条，`RenderSpec` 只能声明一个组件，通用详情把 Entity 的 properties、fields、actions 和 links 原样摊平。它虽然满足 binding-only 和 action-backed，但无法根据用户目标为单 Entity、Entities、开放 Flow 或多层合同图形成可用、可复用的界面。聊天侧还存在跨回合 thinking 仅按 step 关联、以及 prompt 错称 render 未实现的正确性缺口。

T16 将渲染定义为 AI-first Assistant 的原生输出模态：Agent 读取授权合同图并输出 binding-only A2UI Surface Tree；Renderer 确定性解引用事实、校验 action、执行布局。成功的展示决策保存为可失效、可分层的 Render Sidecar，并在相同处境下走零 LLM fastpath。Sidecar 是派生展示状态，不进入业务 Entity 字段，不替代业务事件真相。

## Product Thesis

```text
应用合同：事实、关系、动作、约束
AI：理解目标、选择 Data Lens、规划 Surface Tree
A2UI Runtime：校验、解引用、确定性渲染
Sidecar：缓存成功展示决策并管理个人/共享生命周期
Engine：继续独占业务 action、guard、schema、confirmation 与事件真相
```

Renderer 的确定性不得扩张为 `entity type → 固定页面`。应用只能声明身份、正文、状态、元数据、关系和动作意图等语义，不得声明 Tailwind、像素坐标或完整 React 页面。

## Functional Requirements

### FR1 `present` 输出协议

- 增加与 `answer` 同级的非业务副作用输出 `present(plan, sources)`。
- `present` 可以表达即时 Preview；显示不需要人类确认。
- 保存个人 Sidecar、晋升共享 Sidecar 和执行业务 action 分属不同事件域。
- 生成路径不得由聊天 route 的业务关键词短路代替 Agent 动态规划。

### FR2 Render Situation 与有界合同图

- 统一支持单 Entity、集合 `entities[]`、显式 selection、Flow instance 和多层 graph。
- Render Situation 至少包含 roots、intent、Data Lens、audience/policy scope 和预算。
- Data Lens 只允许 `self/members/relations/flow/graph` 等受限遍历，不提供任意查询语言。
- 每条边重新经过授权过滤；不得广播不可见节点或泄露其数量。
- graph 必须有 `maxDepth/maxNodes`，超限时局部说明而非递归抓取。

### FR3 多区域 A2UI Surface Tree

- Surface 支持多个词条和 layout/slot/repeat 组合，而非单 `component`。
- factual props 全部来自 entity/field/collection/relation bindings；模型不能发送事实值。
- Entity identity、status、primary content、metadata 等通过语义角色声明或通用 fallback 解析。
- Entities 外层组织与成员 recipe 分离；成员增删不要求重新生成外层布局。
- Flow 使用稳定 Shell + Current Task/Context/Output/History slots；节点变化只替换必要子树。

### FR4 可交互 Action

- Surface 中的可提交控件只能来自当前 Entity 的实时 `actions[]`。
- 无字段 action 可呈现为紧凑 action group；有字段 action 通过 Dialog/Drawer/inline form 呈现。
- 提交时重新读取 action、guard 和 schema，随后走 `/api/exec`；Sidecar 不缓存 enabled 状态或表单值。
- high-risk action 保持 confirmation；“显示按钮”不等于授权执行。
- collection 成员 action 必须携带成员真实 rel；批量操作只能走声明的 batch/plan 合同。

### FR5 Render Sidecar 与 fastpath

- Sidecar 保存 normalized A2UI Surface Tree、bindings、Render Situation、dependency manifest、catalog/definition version 和 provenance。
- Sidecar 不保存正文、数量、guard 结果等已解引用事实。
- 支持 Session cache、Personal Sidecar、Promoted Shared View 三层生命周期。
- fastpath 必须先重新授权并校验依赖；命中时首屏前 LLM 调用为 0。
- 字段值、成员数量和普通状态变化重新解引用而不必失效。
- schema/action/definition/catalog/policy scope 不兼容时标记 stale；支持子树级失效与重规划。
- Personal Sidecar 不得影响其他 principal；Shared View 必须经 human diff/approval 后激活。

### FR6 人类优化

- 用户可用自然语言修订布局、信息密度、强调层级和动作收纳。
- 用户可拖动、折叠、调整区域、切换兼容词条，并保存为语义 Render Patch。
- Render Patch 不保存 CSS class、任意代码或像素事实。
- 所有 durable Sidecar 有版本、diff、回退和 provenance。
- 即时 Preview、个人保存、共享晋升必须有清晰不同的用户反馈。

### FR7 正确性与解释

- thinking 以 `(turnId, step)` 归属，后续回合不得覆盖旧回合 reasoning。
- Prompt、工具目录和 Assistant 回答必须与当前 render catalog 一致。
- Markdown 必须区分：聊天支持、render vocabulary 支持、业务字段 content-type 声明三种事实。
- 用户询问“为什么这样展示”时，解释来自 goal、Lens、bindings、catalog、Sidecar 命中/失效和人工修订事件。
- 业务事实、LLM 展示决策、Sidecar patch、业务 action 和 human approval provenance 不混淆。

## Non-Functional Requirements

- binding-only、action-backed、human-only approval、append-only audit 和 replay 不变量继续成立。
- fastpath 在本地基准下首个可用 Surface 目标为 500ms 内，且首屏前无 LLM 请求。
- 新增协议/投影/Sidecar 核心模块目标覆盖率 >80%。
- 键盘、焦点顺序、ARIA label、disabled reason 和窄屏布局必须通过浏览器验收。
- 真实 LLM 质量验收不断言固定组件、固定顺序、固定措辞或固定 tool trace。

## Acceptance Contract

- `user-stories.md` 的 S1–S32 每条 canonical 必须通过。
- AI 规划/解释故事每条至少四个自然语言变体，质量成功率 ≥80%。
- 所有 Safety 条件必须 100% 通过；任何事实泄露、合同外 action、审批越权均为 Track 失败。
- 浏览器任务完成率 100%；工程视觉 rubric 与人工 rubric 均值分别 ≥4/5。
- Story Eval 报告记录 driver/model、Sidecar hit/miss、LLM call count、dependency validation、业务事件差分和人工观察。

## Out of Scope

- Agent 生成或执行任意 HTML、JavaScript、CSS、React 组件代码。
- 为每个 Entity/Flow 编写固定业务页面或 prompt 关键词路由。
- 自动把一次个人生成结果晋升为全局默认。
- 通用查询语言、无限深图遍历、生产级多租户同步和跨设备冲突解决。
- 新增与本 Track 无关的业务 action、Flow 或 capability。

## Source of Truth

- 用户可见语义与逐故事验收：`user-stories.md`。
- 实施顺序与 Red→Green 证据：`plan.md`。
- 架构冲突先记录 `DECISIONS.md`，再修改代码。
