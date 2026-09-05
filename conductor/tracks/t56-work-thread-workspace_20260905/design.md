# T56 Design

这是目标设计与实施边界；P0 探针只用于解决下述有界技术问题，不重新发散产品目标。
本轮不修改 `DECISIONS.md` 的现行约束；P0 将验证后的替代决定登记到当时的下一个编号。

## 1. 页面组织与导航契约

```text
全局壳：我的事 / 工作线                                账户与系统
本线目标（完整可读）  生命周期状态                      助手入口
当前：本线概览 或 当前对象名称    返回本线    相关材料(n)
─────────────────────────────────────────────────────────────
主要工作面（宽度优先）                    助手（按需并排）
  本线概览：目标、责任、进展、关联内容       当前提问的线/对象
  或用户选择的一个对象/决定                 历史回合及当时上下文
  依据与声明动作靠近判断内容                输入、在途状态、停止
─────────────────────────────────────────────────────────────
```

- 壳只提供位置、阅读宿主、材料/助手展开与返回；业务区域、内容、动作和重要性来自声明/合同投影。
- 概览和详情共用一条 Presentation 管线；不为工作线单独复制 entity cache、action gate、取数器。
- 材料默认关闭，用现有 Sheet/Popover 或主面内目录呈现；不挤出第三栏。目录有多项时允许
  稳定滚动，选对象后关闭覆盖层并聚焦目标标题。当前对象标识仍从 URL 导出。
- 不自动打开第一条材料或第一项责任。概览先显示可见责任入口；点选后才改变 focus。
- 应用书架不放进本线概览；添加材料可进入授权应用/集合发现，保留 `thread`。
- 本线生命周期动作位于其声明的动作组；对象详情动作来自对象。两者不混成一排“主操作”。
- 当前视口只呈现一个主要 H1，取授权实体身份或本线目标；“共同注视”不再压过业务标题。
  顶栏全局入口保持原路由，避免扩大为全站信息架构工程。
- `raw/why/reload` 集中到次要工具入口，最多两步可达。审批证据不是 raw，不能一起藏进去。

### 几何、交互与阅读下限

- 验证视口：1440×900、1280×800、1080×820、768×1024、390×844，以及桌面 200% 缩放。
- 默认并排条件：扣除全局 padding/gap 后，主区至少 **640 CSS px** 且至少占两栏净宽的 60%；
  助手建议 320–380px。任一条件不成立切为覆盖/单面模式，不使用仅按整屏 `lg` 的内层断点。
- P0 实测定案（S3，`probes/s3-layout-session.md` §1，已并入 DECISIONS D78）：当前壳内
  640px 结构性不可达——main `max-w-5xl`（1024）+ 书桌栏 384 + padding/gap 72，关 chat
  也只有 568。移除永久材料栏后注视列 = `min(vw−助手宽, 1024)−48`，切换条件即
  `vw − 48 − 助手宽 ≥ 640`（60% 条件此时恒满足 62.5%，640 为绑定约束）：助手 384px →
  并排阈值视口 **1072**（实测 1080 通过、1024 不通过）；助手 320px → **1008**；200% 缩放
  = 960 CSS px 布局视口，**必须覆盖/单面模式**。现状违反基线（P2 Red 对照）：1080 三栏
  中栏 240；390 停靠 body 横滚、float 面板左缘裁出屏；768 停靠挤唯一主列至 336；本线页
  0 个 H1、对象页 2 个 H1；书桌条目（`thread-desk.tsx:290`）与壳内 `<a href>` 为硬导航，
  是切对象丢草稿/在途回合的根因；Escape 不关面板、收起后无焦点恢复。
- 640px 是并排保护下限，不是手机最小宽。手机主面使用可用全宽，正文建议 16px、次级文字
  不低于 12px；标题可换行。不得通过 body 横向滚动、缩放整个界面或缩小字号满足断点。
- 普通正文建议约 65–85 字符的舒适行长；代码/diff/表格可在其专属区域横滚，不能带动全页。
- 助手并排有独立消息滚动；主面保留一个纵向阅读滚动区。避免再嵌套多个高度受限卡片。
- 390px 覆盖助手不能超出屏幕；提供明确关闭、Escape、焦点恢复、焦点圈及不依赖 hover 的操作。
  窄屏在“看材料/问助手”间切换时，所选对象、草稿、会话与正在执行的回合不变。
- 尊重用户当次展开/收起选择；切 focus、收到新状态、进线都不能强制重新停靠。
  不自动提交助手问题；不把呈现切换伪装成业务 mutation。

## 2. 事实来源与呈现责任

| 需要表达      | 已有正典来源                                            | 允许的加工                          | 禁止的推断                                       |
| ------------- | ------------------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| 目标/生命周期 | ThreadSnapshot.goal/status → thread Siren               | 授权身份、声明状态标题              | completed/archived = 目标验收通过                |
| 材料关联      | references.context 与当前授权成员                       | 分类导航、声明身份、数量            | 浏览过/钉住过 = 已关联                           |
| 进行中的工作  | references.active → 授权当前目标合同                    | 展示合同状态与声明的工作语义        | 仅靠 active 类别或未知 status 字符串推断仍在运行 |
| 当前责任      | references.approval → fresh confirmation/责任实体       | 当前责任与历史决定分开；完整动作组  | approval 数组长度 = 待批准数；缺权限 = 零责任    |
| 最近活动      | references.event/recentEventSeqs 与授权事件读           | 保留来源 seq/时间，有限活动语言     | 展示全站最近事件或从同名自动归线                 |
| 产出与验收    | 显式关联目标的声明字段、结果/审查回执                   | 原样解引用，可点到来源              | 普通材料自动升级为产出；没有证据补一个 PASS      |
| pin           | 已有本地 thread pin 偏好                                | 固定视图快捷入口                    | 影响 HTTP/Assistant 成员或跨设备业务真相         |
| 当前提问对象  | 既有 URL observation/clientView                         | 同源可读标题和范围提示              | 新建一套 attention/authorization store           |
| 历史上下文    | user chat-message-appended.clientView、turnId、日志 ts  | 同 principal/session/turn 精确 join | 用最新 presence 给旧消息补当时上下文             |
| 引用          | 持久化 FactRef{rel,pointer}、当时可证来源、当前授权标题 | 标明时点与指向；未知保留原路径      | 用今日集合索引伪造历史对象 identity              |

线程事件不新增“百分比/摘要/下一步”真相字段。需要新的读字段时只做可重建投影，
写入模型与四种生命周期保持；字段缺失、读取失败、无权、真正空集合分别建模。
所有数量、派生标题、链接、依赖与嵌套成员须先授权再组装。跨 principal 仍按既有存在性隐藏。
有限授权下只能陈述“当前可见/已关联”口径，不暴露受限对象数、名称或存在性细节。

### 概览的呈现优先级

1. 先保留目标/身份与生命周期。
2. 已可证的当前责任突出展示，即使线已归档；不因状态选择而抹去矛盾事实。
3. 其次是关联工作的当前状态。已终局项标为历史结果，未知项保留其原始合同状态与来源。
4. 已结束线突出有来源的产出/关联材料；无产出角色时就叫“关联材料”，不强行写“成果”。
5. 事件、材料全集与审计按需展开。正常首屏不把所有角色展开成固定卡片墙。

这些优先级必须落在版本化认知/呈现声明中，渲染器只消费语义；
不得在 React 或 service 内写 `if app === ideas`、业务 status 词表或自然语言关键词分类。
同类未知合同按现有 generic 路径诚实显示，不为了漂亮隐藏缺失语义。

## 3. 复用方案与三个必做探针

### S1：本线整体如何进入现有呈现链路

> 状态（2026-09-06，P0.2）：**已完成，出口见 `probes/s1-presentation.md`**
> （结论摘要见 `spike-report.md` §1；证据 `evidence.md` E-P0.2）。定案：路线 A，
> 已并入 DECISIONS D78 决定 2/3/4。

**已知**：`projectWorkThread` 已返回 goal/status/context/active/approval/recent-events，
但 `entities` 仅含 context 导航摘要；`CanvasBody` 把 focus=本线归入 noGaze。
已有认知 traits 含 work-queue/review-queue/output-catalog/task-history/human-responsibility/audit-only；
不能在计划里假设 generic 已支持所需所有组合。

**首选**：以原 `thread:<id>` 作为公共认知根，在纯投影中给显式角色关系补齐可授权的读语义，
并用既有 Presentation host/generic/Recipe 表达。布局仍由通用词汇与声明驱动。
若单实体 Surface 无法表达必要区域，复用现有 derived Composition registry/Broker，
声明由线程规范关系派生，页面仍保持 canonical thread focus。

**探针**：隔离 fixture 含一目标、两个跨应用 context、一 active、一当前 approval、一历史决定、
一个显式 event。先记录 exact Siren、Sidecar/Recipe 请求、hydration、动作到达与依赖变化；
分别尝试首选与必要时 Composition，实际验证，不把探索代码直接当产品实现。

**出口已记录**：`probes/s1-presentation.md`（`spike-report.md` §1 为索引）：

- 选定路线 A（thread 单主体 + 纯投影扩展）、来源 rel/声明形状与授权位置（零新增授权机制）；
  无新增 rel，故无 parser/discoverability 负担。
- 两种应用无需改前端，责任经 approval 成员卡完整可读；所有展示事实由同源 HTTP 读取。
- active/approval/context 分组的空、终局、未知、授权裁剪语义已逐项定案（报告 §6）；
  无全库扫描。
- member/value/action/授权四类变化的 rehydrate/invalidate 接线实测已存在（报告 §4）。
- 现有 schema/word 足够项与最小语义扩展清单见报告 §7；`spike-report.md` 为索引。

若两条路线均需第二套状态或硬编码应用页，判定探针失败，修订设计再进入 P1；
不得用纯 CSS 修复替代 US01–US04 的业务交付。

### S2：历史上下文与引用的时间边界

> 状态（2026-09-06，P0.3）：**已完成，出口见 `probes/s2-history-citations.md`**
> （结论摘要见 `spike-report.md` §2；证据 `evidence.md` E-P0.3）。定案：写侧零变化、
> ChatTurn 只读投影扩展，已并入 DECISIONS D78 决定 5。

**已知**：用户原话事件已有 clientView；ChatTurn/history UI 目前未完整带出这一信息；
CitationList 只按 citation.rel 读取当前顶层身份，忽略 pointer 对应字段/成员身份；
FactRef 只有 rel/pointer，不包含证据快照或版本。

**探针**：同一 session，A 线问 A 对象→切 B 线问 B 对象→刷新；构造缺 clientView 的历史回合、
集合引用后成员重排、目标改名/权限回收和 SSE 晚到。记录原事件→history→ChatUiMessage→展示映射。

**首选**：扩展只读 ChatTurn 投影，按 principal/sessionId/turnId 精确 join 原 user 事件；
live 路径沿用该次发送的 clientView，刷新路径保持相同语义。不新增 thread-session 所有权映射。
历史取数须核查当前 `listEvents` 的过滤/边界：不得为 join 再扫描全站历史，或因默认页上限
漏掉仍存在的 user 事件而误判 unknown。使用既有存储读过滤/有界分页；必要读适配落相邻子目录，
测试超过默认读取页边界的同一回合重建，不引入新的存储权威或全站搜索系统。
历史未知不得从当前 route 补全；引用支持声明字段标题或原 pointer 作为依据类型。
无法证明具体成员身份的集合引用，显示集合级来源与“回答时依据/当前内容”边界，
不能让用户误认已定位历史对象。无需为本 track 建立全站历史快照系统。

**出口**：明确读取/事件 shape 是否变化、join 与缺失策略、live/history 一致性、引用降级示例、
授权失效后标签缓存策略和测试位置；必要的新元数据必须先记录决策，保留历史记录不回填。

### S3：剩余宽度、草稿与流式生命周期

> 状态（2026-09-06，P0.4）：**已完成，出口见 `probes/s3-layout-session.md`**
> （结论摘要见 `spike-report.md` §3；证据 `evidence.md` E-P0.4）。定案：实测断点与
> 唯一 chat 状态拥有者，已并入 DECISIONS D78 决定 1 与本文件 §1。

**已知**：ThreadDesk 与 FloatingChat 均使用 w-96；进线首次展开会强制 sidebar。
useChatSession 挂在外壳，不应因为响应式切换而重建。

**探针**：在 §1 所列尺寸与 200% 缩放下，用同一布局状态切助手与材料，输入未发送草稿，
接收可控 SSE，切 focus、history/back、关开层。测 DOM bounding boxes、body.scrollWidth、
重复标题、焦点返回、消息/草稿是否丢失以及 clientView 是否漂移。

**出口**：定案并排/覆盖切换条件与唯一状态拥有者；同一 chat session 生命周期连续；
保留现有 float/popout 功能及 `/chat` 独立页回归，不为本次引入新的布局库。

### 决策先于实现

P0 必须在 DECISIONS 新增一个有证据的决定：撤销 T35 的“恒三栏/本线视为无注视”假设；
明确 D46 壳与内容边界、D47 历史引用限制、D54 认知声明与本线读投影的关系。
原 T35 归档文件只读；用新决定和新测试 supersede，不能偷偷删除旧断言。
P0 允许在本 track 内收敛组件/只读合同形状，但不得自动扩大为新业务生命周期、生产迁移或部署。
**已完成（2026-09-06，P0.5）**：DECISIONS **D78**（三探针定案并入；T35 归档零改动）。

## 4. 模块落位与复用路径（均为仓库相对路径）

| 改动边界             | 当前入口                                                                                                                                  | 必须复用/避免                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 线程纯投影           | packages/engine/src/projection/work-thread.ts（S1 定案：≈唯一必改产品文件）；packages/shared/src/work-thread.ts（如需类型）               | active/approval 补与 context 同构的 `thread-reference` 成员卡（含 dangling）+ `presentation` 升级 `projectCognitiveSemantics` version:1 声明；事件/写入模型零变化，不把派生摘要写进事件 |
| 语义/呈现            | packages/shared/src/definition/cognitive-semantics.ts；packages/engine/src/presentation/                                                  | version:1 认知声明单一落点（D54/D78）；generic 规划器非密度 trait 消费通路按需扩展（P1.2，`PRESENTATION_SURFACE_CATALOG`/`generic-intent-policy` 版本随语义递增），禁止 class/rel 分支 |
| 服务授权             | apps/web/src/engine/service.ts；service-thread.ts；presentation/authorized-entity.ts                                                      | S1 定案：授权裁剪六处逐引用已生效且成员卡天然继承，零新增授权机制；不让纯 snapshot 派生值越过授权 |
| 组合适配             | apps/web/src/engine/presentation/compositions.ts；app-workspace/composition.ts；runtime-composition.ts                                    | S1 定案路线 A：**不派生 `workspace:thread:<id>`**（路线 B 已实核否决）；D45 机器留给 app workspace；本行仅保留对比结论（probes/s1 §5） |
| 页面与主面           | apps/web/src/components/canvas/canvas-body.tsx；presentation-surface-host.tsx；apps/web/src/components/app-shell.tsx                      | P2 撤 noGaze 旁路（`canvas-body.tsx:57-63/68-78`），同一 entity cache 与 Presentation host；壳内裸 `<a href>`（`app-shell.tsx:28`）改客户端导航（S3：硬导航丢草稿根因） |
| 材料与 pin           | apps/web/src/components/canvas/desk/（`thread-desk.tsx:290` 裸 `<a>` 改 Next Link，S3 存续契约前置）；apps/web/src/components/actions/thread-material-add.tsx | ObjectSelectorPanel、已有 submit；pin 与 membership 分离       |
| 责任词汇             | apps/web/src/render/words/member-card.tsx；apps/web/src/components/actions/                                                               | approval 成员卡携带被引确认实体声明动作，generic 按 membersDeclareActions 自动选 member-card（D50 责任卡）；T54 知情确认/决定回执、fresh submit；不复制批准实现 |
| 聊天壳               | apps/web/src/components/chat/floating-chat.tsx；chat-panel.tsx；use-chat-session.ts；chat-types.ts                                        | S3 定案：根布局 FloatingChat 内 useChatSession = 工作站唯一拥有者（P2 只换壳不换宿主）；剩余宽度停靠替换「进线必停靠」并保留 dockedThread 记忆；补 Escape/焦点恢复；不把 thread 用作会话 key |
| 历史与依据           | apps/web/src/chat/history.ts；conversation.ts；apps/web/src/app/api/chat/history/route.ts；apps/web/src/components/chat/citation-list.tsx  | P3：ChatTurn 增 `clientView?`/`userContextKnown`（principal×sessionId×turnId 精确 join，不回填）；历史读取按 `{rel,principal}` 过滤取界、无默认页 limit；引用精确型/集合型两型 chip + 时点边界；无全局标签缓存 |
| 处境导航             | apps/web/src/presence/；apps/web/src/components/stage/situation-bar.tsx                                                                   | URL observation/clientView 单一来源、保留 thread/scope（S3 实测发送侧与 URL 已同源） |
| Agent 若确有接线需要 | packages/agent/src/；apps/web/src/chat/post/                                                                                              | 最小披露/transport 改动；不重写决策 loop/provider/执行路径     |
| 测试与探针母本       | apps/web/src/engine/service-tests/work-thread/（S1 种子已常驻，独立 GR3 预算）；apps/web/src/chat/history/（P3 计划新子目录，chat 本体 3974/4000 近限）；apps/web/src/components/chat/（S2 两枚种子已落）；e2e/workstation/（P2/P4 新建）；probes/scripts/*.mjs（S3 五脚本转正保留，P2 Red 母本） | 新测试沿功能子目录避让贴限目录（D53）；不新增 per-track Playwright 配置（GR5） |

以上是影响范围，不要求全部修改。新增文件路径与最终 shape 已按 S1–S3 定案回写此表
（P0.5，2026-09-06）并同步 plan。
`packages/db` 仅在确需读投影支持时触及；默认零存储 schema/事件种类变化（S2 定案：
写侧零变化，S2 步骤 6 实测的 `(principal, rel, seq)` 索引属 schema 决策，本 track 默不做）。

规划期 GR3 事实（仅作开工提示，P0 必须重测）：chat 3974、engine/execution 3986、
service-tests 3918、engine/presentation 3707 有效行（P0.1 重测逐一吻合，见 evidence
E-P0.1）。不要把测试集中堆在贴限目录；S1 已在 `service-tests/work-thread/` 建独立
预算子目录（父目录 3918 不变），S2 计划新子目录 `apps/web/src/chat/history/`；
需要增加时沿功能拆进历史读取/线程呈现等相邻子目录，保留原测试意图、更新路径和 DB 分类。

## 5. 稳定性与失败路径

- 切 thread/focus/授权时取消或隔离旧请求，旧响应不可覆盖新主面、标题、引用、已关联状态。
- action 成功后失效目标、工作线派生状态和相关 Surface；拒绝/并发失效时回读当前合同并保留原因。
- 审批失效、目标不可见、缺历史前值不等于“暂无待办”；语义在合同/投影层明确，UI 不自行鉴权。
- 本线空、未知来源、dangling、局部不可读、LLM 不可用分别测试；人工控制面仍可用。
- 运行/暂停/结束/归档只改变呈现重心，不改变业务执行合法性、自动提交动作或清理数据。
- 集合分页仍 server-owned；大工作集读取有界，不能一次加载所有关联正文、无限 N+1 或全局历史。
  P0 记录请求数与截断/分页口径，展示数量不得把可见前 N 条说成总数。
- 所有确定性主页面数据新鲜度不依赖 LLM；新的 AI 回答仍使用配置的 LLM，失败零业务副作用。
  只读问答的事件检查须区分领域副作用与既有基础接线：chat/presence 日志及
  `chat-thread.ts` 对该次 user message 的规范 attach 单独记账，不把它们误判成领域写入，
  也不借此放行任何额外材料、生命周期、审批或业务对象改动。
