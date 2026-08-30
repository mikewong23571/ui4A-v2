# T39 Meta 合同驱动治理体验 — Plan

> 固定评审项：无每 Application、每实体类型、具体 rel/action 名展示分支；Trait 表达语义，
> Hint 表达有界展示偏好；Hint 不包含 CSS、像素、组件名或事实值；人类与 Agent 消费同一
> sitemap/Siren 合同；Meta Renderer 零 LLM、零 Sidecar；每个 Phase 按 Red → Green → Gate
> 执行；不新增 per-track Playwright 配置或永久视觉脚本。

## Phase A：Disposable Spike 与详细架构定型

- [ ] Task A1：盘点现有展示声明链路，包括 shared definition、SitemapSurface、Siren entity、`presentation.fields`、Meta Renderer registry、RJSF schema 和 canonical/友好路由。
- [ ] Task A2：编写 disposable contract probe，分别验证 Trait/Hint 放在 definition、sitemap、exact entity projection 三种位置时的传播、缓存版本和 Agent 可见性；Spike 不进入生产代码。
- [ ] Task A3：验证 overview hint 复用 T38 `presentation.fields` 的可行性，列出可复用字段、缺口和禁止建立的平行 schema。
- [ ] Task A4：验证 RJSF 对 `human-authored`、`client-generated`、`server-owned` 字段的过滤、预填、校验和提交行为，重点复现 Draft payload 缺控件与 policyScope 暴露。
- [ ] Task A5：核对 canonical `/meta/entity` 与 Flow/Activation/Capability 友好路由的差异，形成删除双路径的迁移清单。
- [ ] Task A6：产出 `architecture.md`，定型版本化 Trait/Hint 类型、归属模块、合法值、fallback、缓存失效、字段输入归属和迁移顺序；如需偏离 DECISIONS，先新增决定。
- [ ] Task A7：Phase Verification & Checkpoint：复跑 probe，确认没有生产代码依赖 disposable spike，并完成“换 Application”架构自查。

## Phase B：Trait/Hint 纯合同与机械治理

- [ ] Task B1：Red——在 shared/engine 最窄边界编写 Trait/Hint parse、版本、白名单、非法引用、未知版本和无声明 fallback 测试。
- [ ] Task B2：Red——编写 sitemap/entity projection 测试，断言 Trait/Hint 对人类 Renderer 与 Agent/CLI 同时可见，且不进入 Business fold、授权签名或事件。
- [ ] Task B3：Green——实现最小版本化 Trait/Hint 类型与纯校验、投影函数；复用现有 presentation field roles/overview。
- [ ] Task B4：Red/Green——实现字段输入归属声明，锁定 human/client/server 三类字段的 schema 传播和提交边界。
- [ ] Task B5：增加低误报治理规则：禁止 CSS/组件名/像素、Application 名和具体 rel/action 特判；禁止 server-owned 字段进入人类输入面。
- [ ] Task B6：运行 focused tests、`pnpm governance:strict`、相关 typecheck。
- [ ] Task B7：Phase Verification & Checkpoint：核对 dependency direction、缓存版本、D51 授权隔离和 Agent 双门合同。

## Phase C：canonical Meta Renderer 单一真相

- [ ] Task C1：Red——编写 canonical 路由组件测试，证明 Flow 当前落 generic，而期望展示拓扑、版本、节点和动作。
- [ ] Task C2：Red——编写 Activation/Capability canonical 测试，锁定 checks、diff、责任区、intent 和输入/输出边界。
- [ ] Task C3：Green——将 Flow、Activation、Capability 接入 class/trait Renderer registry，不按 rel 或 Application 分支。
- [ ] Task C4：统一 Application、Flow、Activation、Capability、Draft、Agent Definition 内链到 `/meta/entity?rel=...`，并保持显式视角。
- [ ] Task C5：删除旧详情组件树或将其调用能力收敛到 canonical 单一 Renderer；不得保留两套取数、动作或展示状态机。
- [ ] Task C6：增加 registry completeness 测试：所有已知 Meta exact class 都有确定 renderer outcome，冲突继续 fail-closed。
- [ ] Task C7：浏览器验证 US2：Application → Flow 一次点击、canonical URL、完整拓扑/版本/动作、返回路径连续。
- [ ] Task C8：Phase Verification & Checkpoint：focused tests、`pnpm check`、governance 和 canonical/Agent 合同探针。

## Phase D：任务优先首页与声明式集合概览

- [ ] Task D1：Red——编写 sitemap 分组/顺序投影测试，覆盖 responsibility、candidate、definition、system 四类语义，但不在页面固定组成员。
- [ ] Task D2：Red——编写 Meta Dashboard 测试，断言责任点首屏优先、空组退场、完整计数文案和未来 surface 自动进入声明分组。
- [ ] Task D3：Green——让 Dashboard 只消费 sitemap Trait/Hint，移除固定状态 facet 与资源平铺层级。
- [ ] Task D4：Red/Green——让 Meta collection 复用 overview hint，Application 概览显示 intent、version 和组成计数；其他 collection 使用同一词汇。
- [ ] Task D5：Red/Green——搜索结果显示总数和截断状态；facet 从声明或投影摘要派生；分页只跟随合同 links。
- [ ] Task D6：浏览器验证 US1、US5、US8：任务首页、概览密度、未来 surface、桌面和 390px。
- [ ] Task D7：Phase Verification & Checkpoint：确认 Dashboard 无 surface 清单、无 per-app 分支、Agent 能读同形分组与 overview。

## Phase E：Draft 表单边界与注意力语义

- [ ] Task E1：Red——复现 Draft 创建中 policyScope/commandId 暴露、payload 无可见控件和裸 rel 输入问题。
- [ ] Task E2：Red——测试 server-owned 字段不渲染、client-generated 字段自动生成、human-authored 字段完整校验。
- [ ] Task E3：Green——按字段输入归属驱动通用 ActionRunner/RJSF，不为 Draft 写字段名分支。
- [ ] Task E4：Red/Green——实现声明驱动的 target/source 选择词汇；候选来自当前授权合同，payload 使用结构化编辑/粘贴/导入通用词汇。
- [ ] Task E5：Red/Green——移除 Meta entity 页的 `publishing` 默认值，将 Scope 主标签收敛为“当前视角”，分离授权集合说明。
- [ ] Task E6：验证失败保留输入、字段原位错误、首错聚焦、Esc/取消焦点恢复、成功原位回执。
- [ ] Task E7：浏览器验证 US3、US4、US9，覆盖桌面、390px、键盘和 URL 连续性。
- [ ] Task E8：Phase Verification & Checkpoint：D51 专项回归、公开 schema 扫描、focused tests、governance。

## Phase F：责任点、关系与披露层级

- [ ] Task F1：Red——编写 responsibility trait 测试，断言 pending Activation/Draft 的决定、checks、diff 和 actions 首屏同域。
- [ ] Task F2：Green——实现通用责任点词汇，按 Hint 支持 inline/sticky；不得检查 approve/reject 名字决定布局。
- [ ] Task F3：Red/Green——统一 guard reason、两段确认、提交成功转已决状态和待决集合原位退出。
- [ ] Task F4：Red/Green——关系区优先消费 `link.title`，raw rel 退居辅助；`self` 默认只在合同/raw 层。
- [ ] Task F5：Red/Green——建立任务层、合同层、Raw 层的通用披露规则，raw 保持局部收起。
- [ ] Task F6：浏览器验证 US6、US7、US9：两次点击内完成决策、无需 raw、sticky 不遮挡、关系任务化。
- [ ] Task F7：Phase Verification & Checkpoint：human-only approval、fresh-read、stale/CAS、响应式和 Agent parity 回归。

## Phase G：全故事终审与常驻治理

- [ ] Task G1：逐一执行 US1–US10 浏览器实操；每个故事记录前态、关键交互态、完成态截图和 DOM/URL/焦点断言。
- [ ] Task G2：使用 CLI 或 HTTP 合同探针复跑每个故事的 Agent 同门路径，比较 entity、links、actions、guards、schema、Trait 和 Hint。
- [ ] Task G3：执行 390px 全流程视觉审核：Dashboard、Application、Flow、Draft form、Activation decision、错误恢复。
- [ ] Task G4：执行“换 Application”终审：新增 fixture Application/surface 仅改声明数据，UI 自动获得分组、概览、关系和动作效果。
- [ ] Task G5：扫描范围内源码，确认无 Application 名、具体 rel/action、固定 surface、状态文案映射和 CSS-in-definition。
- [ ] Task G6：将重复且低误报的坏模式晋升为常驻测试/governance；删除 disposable spike 和临时证据脚本。
- [ ] Task G7：运行 `pnpm format:check`、`pnpm governance:strict`、`pnpm check`、`CI=true pnpm e2e`、相关 invariants。
- [ ] Task G8：汇总 `review.md`，逐故事给出 pass/pass-with-observations/fail、截图路径、DOM 事实和剩余观察。
- [ ] Task G9：Track Verification & Checkpoint：确认系统可运行、工作区无临时产物、用户故事和北极星门禁全部闭环。

