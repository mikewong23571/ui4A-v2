# T20 Technical Stories — Meta Human Control Plane

## TS1 Meta Surface Inventory

从 Meta sitemap 规范化顶层 collection/self 与 exact child descriptors，区分授权不可见、未知 class 和无浏览器 renderer。

DoD：pure descriptor tests；新增 fixture surface 自动进入导航；业务 sitemap 隔离不变。

## TS2 Scope Transport and Authorization

确定 URL/UI scope 与 credential 授权的交集协议；UI 不以任意 header 模拟权限。

DoD：真实 route probe；allowed scopes 来源明确；伪造/跨 scope list/exact/action 全拒；local demo 自报口径显式。

## TS3 Meta Route Resolver

实现稳定 generic Meta browser route，把 rel/URL state 映射到 canonical `/_meta/api/entity`，不复制数据或动作判断。

DoD：refresh/deep-link/404/encoding tests；未知合法 rel 可达；same-origin only。

## TS4 Class-Based Renderer Registry

按 Siren class/shape 与 priority 解析 Renderer，generic collection/detail 为安全 fallback。

DoD：registry pure tests、duplicate/ambiguous registration fail closed；无 Application 名称分支；source governance。

## TS5 Control-Plane Shell

实现 sitemap-driven dashboard、breadcrumb、scope、search/filter、pending/invalid summaries 与 loading/error boundaries。

DoD：首页零 `FACES`/rel 列表；authorized descriptors 单一数据源；URL state 可分享/恢复。

## TS6 Application View Model and Renderer

从 exact Application entity 机械提取 overview/flows/capabilities/policies/version/provenance，避免 raw bundle 主体验。

DoD：projection parity、no invented facts、zero action invention、large bundle/empty sections tests。

## TS7 Relationship Navigation

统一 Meta links → browser links、breadcrumbs 和 back references；保留 exact rel/version/scope。

DoD：Application/Flow/Capability/Definition/Run/Draft 关系图路径测试；无 N+1。

## TS8 Agent Definition Renderer

实现 Prompt、schemas、runtime/policies、Eval、version/birth provenance 的结构化 viewers。

DoD：sealed/binding 语义、JSON Schema tree、hash copy/expand、secret redaction、scope isolation tests。

## TS9 Draft Collection and Workspace

实现 Draft list/filter/detail 与 validation/diff/checks/Eval/sources/revision history 布局。

DoD：invalid/ready/pending/terminal fixtures；action schema 驱动 revise/validate/submit；raw payload 按 exact auth 下钻。

## TS10 Human Decision Surface

统一 Draft activation 与既有 Flow activation 的 human-only decision experience。

DoD：实时 action、reject reason、stale/CAS、atomic apply、double-submit/idempotency、Agent/system rejection。

## TS11 Authoring Handoff

把 source Flow/Agent Run 成功结果中的 Draft rel 投影为可导航 link，并提供 Draft → Run/result/evidence 回链。

DoD：success/invalid/failure/deduplicated callback tests；无空 Draft；birth refs 不漂移。

## TS12 Progressive Disclosure Components

复用 shadcn/RJSF/React Flow/react-diff-view 建立 summary、tabs、schema tree、prompt blocks、hash/provenance 与 raw contract disclosure。

DoD：默认主任务无 raw dump；超大值/深层 schema/长 diff 可用；不新增依赖。

## TS13 Honest UX States

区分 loading、empty、missing、unauthorized、network、partial failure、stale 与 terminal。

DoD：每种状态 component + browser evidence；错误不造数据；partial failure 不白屏。

## TS14 Accessibility and Responsive Layout

建立 heading/tab/table/status/error/focus/keyboard 语义与 390px layout contract。

DoD：keyboard Golden Story、accessible names、focus restoration、no page overflow、diff local scroll。

## TS15 Performance and Cache Discipline

复用 revision-aware entity cache，批量使用 collection embed，禁止 list 后逐项 exact N+1。

DoD：request count assertions、repeated tabs no duplicate fetch、p50/p95 report、bounded search index。

## TS16 Interaction Safety Governance

建立 Meta Renderer action fuzz 与 source rule，防 hardcoded functional buttons、internal callback 暴露、scope/identity override。

DoD：全页面 fuzz 100%；AST/source rule 低误报；realtime reread before exec。

## TS17 Visual and Human Evaluation Harness

定义桌面/移动截图矩阵、视觉 QA checklist 和 30/60/90 秒人工任务记录模板。

DoD：截图不是唯一 gate；任务完成、点击/误读/raw 依赖与问题 severity 留痕；Critical/High 为零。

## TS18 Replay, Documentation, and Governance

覆盖 Meta/Application/Draft/Agent Definition/Run projection rebuild，更新 GOAL/AGENTS/README/demo/DONE 与模块地图。

DoD：重放前后页面事实/hash/links 一致；Track evidence matrix 完整；Principal review 无 High。
