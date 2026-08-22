# T16 语义化 A2UI 呈现与 Render Sidecar fastpath — Plan

> 依据 `spec.md`、`user-stories.md` 与 `conductor/workflow.md`。采用 spike-informed Story TDD：先验证 A2UI/runtime、Sidecar 依赖与当前故障，再细化协议；确定性测试守事实和交互，真实 LLM/浏览器/人工 rubric 验收动态呈现。

## Phase A: Disposable spikes、现状 baseline 与架构决定

- [ ] Task: 建立 S1–S32 Story Eval 清单与版本化 evidence schema；记录 canonical、自然语言变体、Safety、Sidecar hit/miss、LLM calls、浏览器任务和人工 rubric
- [ ] Task: Red baseline——复现固定 `focus → detail`、单组件 RenderSpec、原始字段转储、thinking 跨 turn 错挂和 Markdown/render 过期回答
- [ ] Task: A2UI disposable probe——验证当前 SDK 对多组件 surface、layout、slot/repeat、增量 update、事件回调、序列化/恢复和 catalog version 的真实能力；不把 spike 代码直接并入生产
- [ ] Task: Sidecar disposable probe——比较同一事件日志独立 render projection、派生存储和缓存层的 replay/失效/性能边界；确认业务真相仍只属于 Entity event log
- [ ] Task: Flow/graph probe——用 article-drafting + post-status + artifact/confirmation 构造有界多层 Lens，测量 prompt 大小、解引用次数和局部失效触点
- [ ] Task: 将 probe 结论写入 `DECISIONS.md`，细化 Surface Tree、Sidecar store、dependency fingerprint 和 personal/shared lifecycle；如需技术栈偏差先更新 `tech-stack.md`
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase B: 正确性先行——thinking、render truth 与 `present`

- [ ] Task: S2 Red→Green——SSE/客户端消息 identity 扩展为 `(turnId, step)`，修复跨回合 thinking 覆盖并验证刷新恢复
- [ ] Task: S3 Red→Green——删除“render 未实现”过期提示，投影真实 catalog/content-type，Markdown 三层语义回答通过真实 LLM Eval
- [ ] Task: `present(plan,sources)` 协议 Red→Green——作为 `answer` 同级的非 effect 输出进入 Agent loop、SSE、history、audit；移除 chat route 的故事关键词渲染特判
- [ ] Task: `present` Safety——bindings/source 可追溯、零业务 mutation、失败不留半成品；scripted 只测协议，真实 LLM 验收选择行为
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase C: Render Situation、Data Lens 与 Surface Tree 合同

- [ ] Task: 在 `packages/shared`/`packages/agent` 定义 RenderSituation roots/intent/audience/budget 与受限 Data Lens；先写 schema/property tests
- [ ] Task: 定义 normalized A2UI Surface Tree、layout/slot/repeat/word nodes、binding-only validator 和 dependency manifest；禁止裸事实与任意代码
- [ ] Task: Engine/Web 投影授权合同图，支持 self/members/relations/flow/graph，逐边授权并强制 maxDepth/maxNodes
- [ ] Task: 定义 identity/status/primary-content/metadata 等应用语义角色和通用 fallback；禁止 entity type → page/component 映射
- [ ] Task: Source governance——扫描业务 entity/action 名、固定页面映射、prompt 示例和绕过 A2UI/action gate 的产品分支
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase D: A2UI 组合 runtime 与 Entity/Entities/Flow/Graph

- [ ] Task: S9/S11 Red→Green——多区域 Surface Tree 经 A2UI processor、deref 和 React runtime 一致渲染；局部失败保留其余区域
- [ ] Task: S4 Red→Green——高质量单 Entity fallback：正确身份/状态/正文/元数据/动作/关系层次，退出原始 fields 转储
- [ ] Task: S5/S6 Red→Green——Entities 外层 layout + repeat/item recipe，实时成员增删、异构缺字段诊断和显式 selection 比较
- [ ] Task: S7/S20 Red→Green——开放 Flow stable shell + node/context/output/history slots，transition 只刷新必要子树
- [ ] Task: S8 Red→Green——多层 graph Lens、预算、逐边授权、progressive disclosure 与子 Surface provenance
- [ ] Task: S10/S12 real Eval——同一 Subject 多 intent 与新定义零 Renderer/prompt 改动，质量率达到门槛
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase E: Surface Action 交互与安全

- [ ] Task: S13 Red→Green——无字段 action group 实时 declaration/guard 复核、精确 rel/action 提交与 Surface 刷新
- [ ] Task: S14 Red→Green——有字段 action 的 Dialog/Drawer/inline schema form、焦点管理、取消零事件和非法值拒绝
- [ ] Task: S15 Red→Green——high-risk action pending/approve/reject 全链，显示请求与执行状态差异
- [ ] Task: S16 Red→Green——Entities 成员 action 在排序/筛选后仍绑定真实 rel；未声明 batch 零批量入口
- [ ] Task: S17 Red→Green——过期 action dependency 使子树 stale，零 POST 且只读区域继续可用
- [ ] Task: Interaction invariants——fuzz 全部可提交元素映射当前授权 action；Sidecar 不缓存 guard、enabled 或 formData
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase F: Render Sidecar、fastpath 与局部失效

- [ ] Task: 定义 Sidecar event/schema/projection：Situation、normalized surface、dependencies、catalog/definition versions、audience 和 provenance；业务 snapshot hash 不变
- [ ] Task: S18 Red→Green——Entity fastpath 重新授权/解引用，首屏零 LLM、目标 ≤500ms、receipt 完整
- [ ] Task: S19 Red→Green——Entities membership 变化复用外层 Sidecar，repeat/item facts/actions 实时更新
- [ ] Task: S20/S21 Red→Green——Flow shell/node keys、值变化复用、结构/catalog/policy 变化 100% invalidation
- [ ] Task: S22 Red→Green——dependency DAG 子树级 reused/replanned、原子切换和有界 replan prompt
- [ ] Task: S23 Red→Green——LLM 故障下 fastpath/人工 renderer 可用，新规划诚实失败且零 rule fallback/effect
- [ ] Task: 并发/replay/property tests——同 Sidecar 多写、重试幂等、版本指针、stale race 和全量重放一致
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase G: 人类优化、Personal/Shared 生命周期与解释

- [ ] Task: S24 Red→Green——自然语言 Render Patch，引用用户原话/旧版本，只改语义布局不改事实
- [ ] Task: S25 Red→Green——拖动/折叠/切换转换为受限 patch，键盘/ARIA 稳定且可撤销
- [ ] Task: S26 Red→Green——Personal Sidecar principal/policy 隔离、保存反馈、下一次 fastpath
- [ ] Task: S27 Red→Green——Shared View diff + pending promotion + human-only approval + 版本激活
- [ ] Task: S28 Red→Green——active pointer 回退、历史不可变、业务 hash 不变、重新校验后命中
- [ ] Task: S31 Red→Green——事件派生解释 goal/Lens/bindings/catalog/hit/miss/patch，缺 provenance 诚实失败
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase H: 故障、安全、质量与全应用闭环

- [ ] Task: S29/S30 Safety——未授权 nested data 零泄露；catalog/Sidecar 损坏 fail-closed + generic fallback + 零 action
- [ ] Task: S32 replay/responsive/accessibility——桌面、窄屏、键盘、焦点、ARIA 与 Sidecar 生命周期全量重放
- [ ] Task: Golden Story 浏览器闭环——Application → Entities → Entity → 首次 present → 人类优化 → Personal save → action/确认 → fastpath → 解释
- [ ] Task: S1–S32 canonical 全过；AI 故事每条四变体质量 ≥80%；Safety 100%；工程视觉与人工 rubric 均值 ≥4/5
- [ ] Task: 回归 `pnpm check`、`CI=true pnpm e2e`、真实 LLM Eval、source-governance 和开发栈 live walkthrough
- [ ] Task: 同步 `GOAL.md`、`conductor/product.md`、`product-guidelines.md`、`tech-stack.md`、`arch-brief.md`、`DECISIONS.md` 与 DONE 报告
- [ ] Task: Final Phase Verification & Checkpoint (Refer to workflow.md)
