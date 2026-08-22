# T16 语义化 A2UI 呈现与 Render Sidecar fastpath — Plan

> 依据 `spec.md`、`user-stories.md`、`technical-stories.md`、`architecture.md` 与 `conductor/workflow.md`。采用 spike-informed Story TDD：Chat 只委托薄 Presentation Request；Application 预生成 Recipe；用户级 Sidecar 跨 Session fastpath；确定性测试守事实和交互，真实 LLM/浏览器/人工 rubric 验收动态呈现。

## Phase A: Disposable spikes、Red baseline 与架构决定 [checkpoint: 27c57d7]

- [x] Task: 建立 S1–S32/TS1–TS18 evidence schema；记录 canonical/变体、Safety、Chat/Presentation LLM calls、Recipe/Sidecar hit、依赖校验、浏览器任务和人工 rubric — b16758c
- [x] Task: Red baseline——复现固定 `focus → detail`、单组件 RenderSpec、原始字段转储、thinking 跨 turn 错挂、Markdown/render 过期回答、Chat context 携带渲染复杂度和 Session 级缓存风险 — 0205e66
- [x] Task: A2UI disposable probe——验证当前 SDK 对多组件 Surface、layout、slot/repeat、增量 update、事件回调、序列化/恢复和 catalog version 的真实能力；spike 不直接并入生产 — 5d45c65
- [x] Task: Application Recipe probe——从 Application/Flow 定义机械枚举 overview/inspect/browse/current-task/confirmation/artifact 场景，用独立 Presentation context 生成参数化 Recipe，验证零 live facts/principal/sessionId — 44502cf
- [x] Task: User Sidecar probe——比较同一日志独立 Presentation projection、派生存储和 cache index 的 replay/失效/性能；验证跨 Session 命中与 Business Snapshot hash 不变 — fcc4b4d
- [x] Task: Flow/graph probe——用 article-drafting + post-status + artifact/confirmation 构造有界 Lens，测量 prompt、解引用、层级 Recipe 和局部失效触点 — 44502cf
- [x] Task: 将 probe 结论写入 `DECISIONS.md`，确认 pure presentation kernel 位置、Recipe Registry/Sidecar store、event families、fingerprint 和 candidate/promoted lifecycle；技术栈偏差先更新 `tech-stack.md` — 27c57d7
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) — 27c57d7

## Phase B: Chat 正确性、薄协议与 Plane 隔离

- [ ] Task: S2/TS1 Red→Green——SSE/客户端 identity 扩展为 `(turnId, step)`，修复 thinking/receipt 跨回合覆盖并验证刷新恢复
- [ ] Task: S3/TS2 Red→Green——删除“render 未实现”过期提示；Chat 只见薄能力，Presentation Agent 读取实时 catalog/content-type；Markdown 三层回答通过真实 LLM Eval
- [ ] Task: TS3 Red→Green——定义 versioned PresentationRequest/Receipt；Chat schema 禁止 Surface/component/bind/dependency，Direct Navigation/Flow Transition 共用协议
- [ ] Task: TS4 Red→Green——Presentation Broker requestId 幂等、重新授权、Situation 构建、异步 receipt 与 Chat answer/failure 隔离
- [ ] Task: Source governance——Chat prompt/history 不含完整 catalog/Surface/dependency；chat route 无展示关键词或业务名规划分支
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase C: Render Situation、Data Lens 与 Surface Tree 合同

- [ ] Task: TS5 TDD——在共享协议定义 RenderSituation roots/intent/audience/budget 与受限 self/members/selection/relations/flow/graph Lens；schema/property tests 先红
- [ ] Task: 授权合同图 resolver——逐边 principal/policy 过滤，强制 maxDepth/maxNodes，对 direct/member/relation/nested 四类泄露 fuzz 为 0
- [ ] Task: TS9 TDD——定义 identity/status/primary-content/metadata/relation 语义角色和高质量 generic fallback；禁止 entity type → page/component 映射
- [ ] Task: TS10 TDD——normalized Surface Tree、layout/slot/repeat/word nodes、binding-only validator、dependency manifest 和 deterministic hash
- [ ] Task: Pure kernel boundary——按 Phase A 决定落入现有 package/module 或新 presentation package，保持无 React/AI SDK/DB/环境依赖
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase D: Application Scenario/Recipe 预生成

- [ ] Task: TS6 Red→Green——Scenario Enumerator 从 Application/Flow/Entity/action/confirmation/artifact 语义确定性产生 descriptor，不选择组件、不含业务关键词
- [ ] Task: TS7 Red→Green——独立 Presentation Agent prompt/context 与 Recipe template/slot/provenance；Recipe factual literal/principal/sessionId 为 0
- [ ] Task: Recipe validator/compiler——definition/catalog/dependency validation，非法 candidate fail-closed 且不阻断 Application activation
- [ ] Task: TS8 Red→Green——candidate/promoted/stale/version Registry、确定性 key、受影响依赖扫描、后台 retry/regeneration 和兼容旧版本连续服务
- [ ] Task: S12 real Eval——新 Entity/Flow/action 激活后零 Renderer/chat prompt 改动即可产生新 descriptor/Recipe；source governance 全绿
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase E: A2UI Runtime 与 Entity/Entities/Flow/Graph

- [ ] Task: TS10 Red→Green——Surface Tree 经 A2UI processor、compile/serialize/restore、deref 和 React runtime 一致；未知 word/裸事实交互前拒绝
- [ ] Task: S4/TS9 Red→Green——高质量单 Entity fallback：正确身份/状态/正文/元数据/动作/关系层次，退出原始 fields 转储
- [ ] Task: S5/S6/TS11 Red→Green——Entities layout + repeat/item recipe、实时成员增删、异构诊断和 selection 比较
- [ ] Task: S7/S20/TS11 Red→Green——开放 Flow stable shell + node/context/output/history child Sidecars，transition 只刷新必要子树
- [ ] Task: S8/TS11 Red→Green——多层 graph Lens、预算、逐边授权、progressive disclosure、父子不复制事实和原子 subtree replacement
- [ ] Task: S9–S11 real Eval——Recipe/miss 路径形成可用多区域 Surface，不断言固定 word/顺序，局部失败保留已验证区域
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase F: Surface Action 交互与安全

- [ ] Task: S13/TS12 Red→Green——无字段 action group 实时 declaration/guard 复核、精确 rel/action 提交与 Surface 刷新
- [ ] Task: S14/TS12 Red→Green——字段 action 的 Dialog/Drawer/inline schema form、焦点回收、取消零事件、extra-data 剥离和拒绝呈现
- [ ] Task: S15 Red→Green——high-risk action pending/approve/reject 全链，明确区分 requested/executed
- [ ] Task: S16 Red→Green——Entities 成员 action 在排序/筛选后仍绑定真实 rel；未声明 batch 零入口
- [ ] Task: S17 Red→Green——过期 action dependency 使子树 stale，零 POST 且只读区域继续可用
- [ ] Task: Interaction invariants——fuzz 全部可提交元素映射当前授权 action；Recipe/Sidecar 不缓存 guard、enabled 或 formData
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase G: 用户级 Sidecar、fastpath 与局部失效

- [ ] Task: TS13 Red→Green——独立 Presentation events/fold：User cache/pinned、versions/active pointer/provenance；Business Snapshot hash 不变，schema/key 无 sessionId
- [ ] Task: TS14/S18 Red→Green——跨 Chat Session/Canvas/direct page 命中同一 User Sidecar，重新授权/解引用，两个 LLM call count=0，目标 ≤500ms
- [ ] Task: S19 Red→Green——Entities membership 变化复用外层 Sidecar，repeat/item facts/actions 实时更新
- [ ] Task: TS15/S20/S21 Red→Green——Flow shell/node keys、值变化复用、结构/catalog/policy 100% invalidation，incorrect reuse=0
- [ ] Task: S22 Red→Green——dependency DAG 子树级 reused/replanned、原子切换、有界 Presentation context 和 receipt
- [ ] Task: S23/TS4 Red→Green——Chat/Presentation/LLM 故障隔离；User Sidecar/Recipe hit 可用，新规划诚实失败且零 rule fallback/effect
- [ ] Task: 并发/replay/property tests——跨窗口 optimistic baseVersion、非冲突 patch 合并/冲突拒绝、写入重试幂等、stale race 和全量重放一致
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase H: 人类优化、User Memory 与 Shared Recipe

- [ ] Task: S24/TS16 Red→Green——Chat 自然语言只产生 thin Revision Request；Presentation Agent 输出引用 user message/baseVersion 的语义 Patch，事实不变
- [ ] Task: S25/TS16 Red→Green——拖动/折叠/兼容词条切换绕过 Chat 直接产生同构 Patch，键盘/ARIA 稳定且可撤销
- [ ] Task: S26 Red→Green——User cache → pinned、principal/policy 隔离、跨 Session fastpath、版本反馈和回退入口
- [ ] Task: S27/TS17 Red→Green——User Sidecar 参数化/去用户化 → candidate Recipe → mechanical diff → human-only promotion → promoted version
- [ ] Task: S28 Red→Green——active pointer rollback、历史不可变、业务 hash 不变、目标版本重新校验
- [ ] Task: S31/TS18 Red→Green——事件派生解释 request/Situation/Lens/Recipe/Sidecar/hit/miss/patch/promotion，缺 provenance 诚实失败
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase I: 故障、安全、质量与全应用闭环

- [ ] Task: S29/S30 Safety——未授权 nested data 零泄露；catalog/Recipe/Sidecar 损坏 fail-closed + generic fallback + 零 action
- [ ] Task: S32 replay/responsive/accessibility——桌面、窄屏、键盘、焦点、ARIA 与 Recipe/User Sidecar 生命周期全量重放
- [ ] Task: Golden Story 浏览器闭环——Application Recipe 预生成 → Chat thin request → User Sidecar instantiate → Entity/Entities/Flow → 人类优化/pin → action/确认 → 跨 Session fastpath → 解释
- [ ] Task: S1–S32/TS1–TS18 canonical 全过；AI 故事每条四变体质量 ≥80%；Safety 100%；工程视觉与人工 rubric 均值 ≥4/5
- [ ] Task: 性能/隔离门——Chat prompt token 不含 render payload；Chat answer latency 不等 Presentation Planner；Recipe/User hit 的 LLM calls 达到定义值
- [ ] Task: 回归 `pnpm check`、`CI=true pnpm e2e`、真实 Chat/Presentation LLM Eval、source-governance 和开发栈 live walkthrough
- [ ] Task: 同步 `GOAL.md`、`conductor/product.md`、`product-guidelines.md`、`tech-stack.md`、`arch-brief.md`、`DECISIONS.md` 与 DONE 报告
- [ ] Task: Final Phase Verification & Checkpoint (Refer to workflow.md)
