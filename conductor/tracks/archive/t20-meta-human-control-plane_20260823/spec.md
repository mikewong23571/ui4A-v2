# T20 Meta Human Control Plane — Specification

## Overview

UI4A 的 Meta 协议已经投影 `meta/applications`、`meta/drafts`、`meta/agent-definitions` 及 exact entities，但人类 `/meta` 首页仍使用 T4/T13 的硬编码 `FACES`，只提供 Flow、Activation、Capability 和 `meta/self`。Application、Draft、Agent Definition 没有浏览器路由；scope 也没有安全、连续的 UI 上下文。因此 T17/T19 在 API/测试中成立，却无法由人类 Renderer 完整治理。

本 Track 将 `/meta` 建设为 **Meta Human Control Plane（定义控制台）**：Meta sitemap 负责持续发现，Siren entity 负责事实、links、actions 与 schema，通用 Renderer 提供安全兜底，Application、Agent Definition、Draft/Activation 使用精心设计的任务视图。

## Product Principles

1. **合同驱动但不等于原始表格**：导航、可用动作和关系来自合同；关键对象使用特化 Renderer，raw JSON 仅作下钻。
2. **任务优先**：默认页面先回答“这是什么、当前状态、关系、下一步”，技术细节逐层展开。
3. **审批零 AI**：diff、checks、Eval、来源和决策使用确定性 Renderer；AI/Sidecar 不参与审批事实。
4. **交互必背书**：按钮只来自实时 Siren action，点击前重新读取 entity 并由 Meta exec 裁决。
5. **Scope 不可伪造**：UI 只能选择 credential 已授权 scope；每次 list/exact/action 都由服务端重新授权。
6. **可预测增长**：新增 Meta surface 只需要合同和可选 renderer registration，不修改首页导航分支。
7. **优雅可量化**：层级、导航、移动端、键盘、错误恢复、感知性能和人工任务完成时间都有验收证据。

## Functional Requirements

### Dynamic Control-Plane Shell

- `/meta` 从 Meta sitemap 生成当前 principal/scope 的顶层入口、状态摘要与搜索索引，移除硬编码 `FACES`。
- 提供稳定 breadcrumb、全局搜索、类型/状态筛选和当前 scope 上下文。
- 提供 `/meta/entity?rel=...`（或等价稳定通用路由），使未知但合法 Meta entity 至少可安全显示。
- Renderer registry 按 Siren class/shape 选择特化视图；未注册 class 使用通用 collection/detail fallback，不白屏。

### Application Experience

- Application 列表展示 title、intent、version、Flow/Capability 数量和状态。
- Application 详情以概览、Flow、Capability、Policy、Versions/Provenance 分区呈现，支持关系导航。
- 默认不显示整包 Bundle；raw contract 可展开、复制和审计。
- 当前范围保持 Application read-only；未声明 create/revise action 时 UI 不制造按钮。

### Agent Definition Experience

- 按授权 scope 列出 Agent Definitions，并展示 active/exact version、intent、runtime class 和 Eval 状态。
- 详情分区展示 Prompt blocks、sealed/binding、Task/Result schemas、runtime requirements、tools/resources/artifacts、Eval evidence、parent/flattened hashes、versions 和 Runs。
- Provider endpoint、credential、部署环境值绝不进入业务字段或 UI。
- Agent Run 到 Definition 的链接固定 birth version；后续激活不改变旧 Run 解释。

### Draft and Activation Experience

- Draft 列表展示 kind、target、status、version、owner、scope、expiry，并支持状态筛选。
- Draft 详情展示 validation issues、authored/effective diff、checks、Eval、sources、provenance 和 raw audit。
- revise/validate/diff/submit/approve/reject 只消费当前 Siren actions/schema；invalid Draft 提供可行动的修复说明。
- Human approve/reject 使用清晰、常驻但不抢占内容的决策区域；stale/CAS 冲突保留现场并解释恢复路径。
- Agent Authoring 成功后提供真实 Draft deep link；失败不产生空 Draft；Agent/system 不能 submit 之外的 human decision 或 activation。

### UX States and Continuity

- loading 使用稳定 skeleton；empty、404、unauthorized、network failure 和 partial section failure 如实呈现。
- URL 保留 rel、scope、tab/filter 等可分享状态；刷新不依赖进程内真相。
- 桌面和 390px 移动端无页面级横向溢出；复杂 table/diff 仅局部滚动。
- 全部功能支持键盘、可见焦点、语义 heading/table/tabs/status/error，颜色不是唯一状态信号。

## Non-Functional Requirements

- Meta governance Renderer 零 LLM/Presentation Agent 依赖。
- 首屏不得按成员发起 N+1 exact 请求；重复 Tab 不重复获取相同 revision。
- 本地健康环境中 shell/title/skeleton 立即出现，主要 entity 内容目标 p95 < 1 秒；测量方法在 Phase A spike 固定。
- 新增模块覆盖率目标 >80%；关键 authorization/action/replay Safety 100%。
- 不新增 UI framework、state store、router 或设计系统依赖；复用 Next.js、shadcn、RJSF、React Flow、react-diff-view 和现有 Meta client。

## Acceptance Criteria

1. 当前授权 scope 的 7 个顶层面（self、flows、activations、applications、capabilities、drafts、agent-definitions）全部可从 `/meta` 一次交互到达。
2. 测试注入 `meta/widgets` collection 后，不修改首页代码即可出现并由 generic fallback 显示。
3. Application、Agent Definition、Draft 三条人类 Golden Story 闭环；Flow/Capability/Activation 现有路径无回归。
4. Authoring Run → Draft → revise/submit → human approve → active Definition 全链可在浏览器完成。
5. Agent/system approval 拒绝、scope 隔离、stale CAS、internal callback 隐藏和 action fuzz 全部通过。
6. 30 秒内定位某 Application 的能力，60 秒内解释一个 Agent Definition 的权限边界，90 秒内判断一个 Draft 是否可批准；默认无需查看 raw JSON。
7. Playwright 桌面/390px、键盘/a11y、视觉 QA、全量 replay、`pnpm check` 和 `CI=true pnpm e2e` 通过。

## Out of Scope

- 在产品 Chat 内生成、编辑或激活完整 Application Bundle。
- 新增 Meta resources/projections/policies 等尚未声明的协议域。
- 改变 T17 Draft、T19 Agent Definition/Run、Flow activation 的事件真相或审批规则。
- AI 生成审批页面、AI judge 替代 checks/Eval/human decision、用户级 Sidecar 介入 Meta 审批。
- 多租户 IAM、Keycloak 接入、生产级 RBAC 管理器或通用低代码页面设计器。
