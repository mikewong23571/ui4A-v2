# T56 Spike Report(S1/S2/S3)

> 用途:登记 P0 三个必做探针(design.md §3)的执行结果与定案依据。
> **当前状态:P0.1 仅建立骨架与「已核实」的已知事实;S1–S3 探针本体由 P0.2–P0.4 执行后
> 回填,三节现均为 NOT RUN。** 探针代码去向(保留为常驻测试/删除)按 GR5 在出口记录,
> 探索代码不直接当产品实现。纪律:原始观察 ≠ 部署事实;每个出口结论必须能指回
> evidence.md 的正式证据条目。

| 探针 | 任务  | 状态     | 结论位    |
| ---- | ----- | -------- | --------- |
| S1   | P0.2  | NOT RUN  | 本文件 §1 |
| S2   | P0.3  | NOT RUN  | 本文件 §2 |
| S3   | P0.4  | NOT RUN  | 本文件 §3 |

共同基线:HEAD `c38883b074d30620008eeacbf4bfe5c5f864b1f5`(工作树仅 plan.md [~]);
环境约定与治理基线见 `evidence.md` E-P0.1。

---

## §1 S1:本线整体如何进入现有呈现链路(P0.2)— NOT RUN

design.md §3-S1 出口要求:选定路线(thread 单实体 Surface vs 必要时 derived Composition)、
来源 rel/JSON path/声明形状与授权位置、空/终局/未知/授权裁剪分组语义、
rehydrate/invalidate 触发、词汇缺口与最小语义扩展;若两条路线都需要第二套状态或
硬编码应用页,判探针失败并修订设计。

### 已知事实(P0.1 已核实,探针输入)

- `projectWorkThread` 已返回 goal/status/context/active/approval/recent-events
  (`packages/engine/src/projection/work-thread.ts:280-313`),但 **`entities` 仅含
  context 导航成员卡**(:264-276);active/approval 只是 properties 里的 statusPointer
  数组与 links,**没有成员卡**;event 是审计链接(:201-203)。
- 归档线(`archived`)**动作集为空**(`actionsByStatus.archived: []`,:139)——
  「归档仍有责任」的呈现只能来自 references/关联实体,不能来自线自身动作(F03/FR3)。
- `CanvasBody` 把 focus=本线归入 **noGaze 旁路**(`canvas-body.tsx:44-45` 判定,
  :57-63 noGaze,:68-78 本线分支渲染协作引导文字 + ThreadStageActions + 应用书架),
  未走 `PresentationSurfaceHost`——本线今天没有 Surface。
- 已有认知 surface role 词表:work-queue/review-queue/output-catalog/task-history/
  human-responsibility/audit-only(D54.7);generic intent 走精确匹配 + role budget
  (D47.4);组合走 D45 `workspace:` 声明 registry
  (`apps/web/src/engine/presentation/compositions.ts`)与 `runtime-composition.ts`。
- 授权读面入口:`apps/web/src/engine/presentation/authorized-entity.ts`;
  服务线程域逻辑在 `apps/web/src/engine/service-thread.ts`(38 行)。
- 测试基座:`packages/engine/src/projection/work-thread.test.ts`(pure 投影)、
  `e2e/t26-work-thread.spec.ts`(合同 E2E)已存在。

### 探针结果与定案(待 P0.2 回填)

- [ ] 隔离 fixture(一目标、两个跨应用 context、一 active、一当前 approval、一历史决定、
      一显式 event)搭建记录
- [ ] exact Siren/授权/依赖记录(首选路线:thread 单实体 Surface)
- [ ] 必要时 derived Composition 对比记录
- [ ] 角色/责任/产出来源、同门、更新、部分授权与未知状态验证记录
- [ ] 最终数据/rel/path/词汇/声明/模块方案及探针代码去向
- [ ] 出口结论(选定路线 + 理由 + 失败判定检查)

---

## §2 S2:历史上下文与引用的时间边界(P0.3)— NOT RUN

design.md §3-S2 出口要求:live/history 精确 turn join、时点显示、集合级诚实降级、
缓存失效策略、读取/事件 shape 变化结论、测试位置;历史取数不得全站扫描或因默认页
上限漏判 unknown。

### 已知事实(P0.1 已核实,探针输入)

- 用户原话事件已带 `clientView?: ClientViewReport`
  (`apps/web/src/chat/history.ts:76-77`,ChatMessageAppendedDetail,仅 user 角色);
  **`ChatTurn` 投影不含 clientView**(history.ts:35-42)——历史回合无法回放发送时观察。
  事件级 `ConversationMessage` 已同时保 `citations` 与 `clientView`
  (`apps/web/src/chat/conversation.ts:32-44`),缺口在 ChatTurn join 层。
- history 路由(`apps/web/src/app/api/chat/history/route.ts`):principal 过滤 production
  生效(:33,`chat/history-access.ts`);**`listEvents(getDb(), 0, {principal})` 从 seq 0
  全量拉取后按 `rel === 'chat:<sessionId>'` 内存过滤**(:34-40)——S2 必须实测默认
  读取上限与分页口径,确认超过页边界时同回合 user 事件不漏判 unknown。
- citations join:仅 assistant 角色 + 精确 turnId,注入 final 回合(:71-90)。
- **FactRef = `{rel, pointer}` 二字段**(`packages/agent/src/types.ts:104-107`),
  parseCitations 拒绝额外键——**无证据快照/版本/identity**;集合 JSON Pointer 数组位置
  不是永久实体身份(FR8)。CitationList 只按 rel 读当前顶层身份
  (`citation-list.tsx:17-35`),pointer 不参与字段级定位,仅进 title 审计属性(:106)。
- 会话归属双轴 (principal, sessionId)(D68);切线不换绑会话(spec §3.5)。
- 探针范围参考:`e2e/interaction/chat-citations.spec.ts`(现存引用行为锚)。

### 探针结果与定案(待 P0.3 回填)

- [ ] A 线问 A 对象 → 切 B 线问 B 对象 → 刷新 的 live/history 对照记录
- [ ] 缺 clientView 的历史回合、集合重排、改名/权限撤回、SSE 迟到 各负例记录
- [ ] 原 event → history → ChatUiMessage → 展示 的映射链记录
- [ ] `listEvents` 读取页边界实测(超过默认上限的同一回合重建)
- [ ] 定案:join 与缺失策略、live/history 一致性、引用降级示例、标签缓存失效、
      必要字段变更与测试位置
- [ ] 出口结论

---

## §3 S3:剩余宽度、草稿与流式生命周期(P0.4)— NOT RUN

design.md §3-S3 出口要求:并排/覆盖切换条件、唯一 chat 状态拥有者、同一 session
生命周期连续、保留 float/popout 与 `/chat` 回归;不引入布局依赖。

### 已知事实(P0.1 已核实,探针输入)

- 宽度常量:ThreadDesk rail `lg:w-96`(`canvas-body.tsx:108`);FloatingChat FAB 态与
  sidebar 态均 `w-96`(`floating-chat.tsx:120,133`);**进线(railOn)首屏即并排,
  无剩余宽度检查**——与 design.md §1「主区至少 640 CSS px 且 ≥60% 净宽」阈值无关,
  1080px 视口的 F01 拥挤由此而来(待 S3 实测几何)。
- 断点用 `lg:`(Tailwind 整屏宽),非容器/剩余宽度查询。
- **chat 状态拥有者:`useChatSession`(`use-chat-session.ts:56`,628 行)不是全局单例**
  ——FloatingChat 内部实例化(`floating-chat.tsx:66`),`/chat` 页另起实例
  (`chat/page.tsx:16`);跨实例仅共享 localStorage sessionId 与服务端零会话态投影。
  S3 需验证:响应式切换若重建宿主,session/草稿/SSE 是否存续。
- 壳挂接:`AppShell aside={<FloatingChat />}`(`app/layout.tsx:20`);`/chat` 页
  FloatingChat 自隐藏避免窗中窗(`chat/page.tsx:20`)。
- SSE/停止、草稿能力在 ChatPanel/use-chat-session 内部(本轮未深挖,S3 实测)。
- 浏览器验收纪律:3100 端口须确认为本 HEAD 的干净 server(见 evidence.md 环境约定)。

### 探针结果与定案(待 P0.4 回填)

- [ ] 指定视口(1440×900/1280×800/1080×820/768×1024/390×844/200% 缩放)DOM 几何记录
- [ ] 草稿未发送 + 可控 SSE + 切 focus/history/back + 关开层 的状态存续记录
- [ ] `/chat` 独立页与 float/popout 回归记录
- [ ] 定案:并排/覆盖阈值、覆盖交互、唯一 chat 状态拥有者
- [ ] 出口结论

---

## 原始观察 ≠ 部署事实

- spec §2 的线上样例(ui4a.styleofwong.cn 工作线)是规划期浏览器观察,**未与本地 SHA
  核对,不作为本报告任何结论的依据**;探针一律在本地隔离 fixture 上执行。
- 本文件「已知事实」均为 P0.1 对 HEAD `c38883b` 的只读代码核查(带路径/行号),
  不含任何运行时行为结论;运行时行为以 S1–S3 探针与 evidence.md 正式条目为准。
