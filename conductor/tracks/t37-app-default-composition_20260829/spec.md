# T37 应用默认展示治理 — Specification

## 类型

Feature(产品级信息架构与呈现治理;跨引擎投影 + web 呈现适配两层)

## 问题(根因已查实)

进入应用后默认展示与直觉差距大,三个可复现症状同一根因:

1. **导航断链**:流实例 links 只有 `self`——发布产物后无任何入口可达产物
   (`contract/siren/project.ts` 实例投影只反查自身集合成员资格;向导线程不是
   任何集合的成员)。集合回链不一致:articles/todos/ideas 有 `flow` 链,
   comments/software-changes/writing-requests/agent-runs 只有 `self`。
2. **默认面缺位**:应用 chip 跳 `/canvas?focus=<入口流>&scope=<app>`,只渲染
   单流实例卡;sitemap 已声明 `articles`/`comments` 等集合表面但无 focus 时
   canvas 空屏。集合→成员→动作的合同数据齐备(`projectCollection` 嵌入完整
   成员投影含 actions),呈现侧无消费路径。
3. **低密度大块**:唯一表面形状是"单主体处境卡"(T7 向导叙事遗产),动作组
   词条按引导式任务设计,面对"一堆实体"时信息密度失衡。

根因一句话:**实体间关系没有统一投影模型,导航靠历史 Track 点状补丁;组合维
机器(T30)已建成但默认落点从未消费它。**

## 方向依据(北极星,`conductor/product-vision.md`)

- **§六 不做传统软件**:默认面由 presentation 机器从合同组装。固定评审项:
  **无每应用/每实体类型/每区域特判代码**;发现自己在写应用落点布局组件,
  即页面滑梯,当场退回。判据:"这段代码换一个 application 还要不要改?"
- **§四 application 是图书馆,不是书桌**:默认面回答"这个应用里有什么、
  我能干什么";用户的工作单位仍是工作线,首页(我的事)主角不变。
- **§二 同一扇门**:组合面是投影(聚合虚主体),agent 经合同消费同一份内容;
  披露收窄不窄化 HTTP 合同,CLI/外部 agent 发现面不变。
- **§八.4 组合维**:消费 T30 已建机器(区域 × intent × 聚合虚主体),
  本 track 不新造呈现机制;组合不产生真相——虚主体不进业务 sitemap、
  不可 exec、不产生业务事件。

## 功能需求

### FR1 流→产物正向链接(合同投影)

- 流实例 links 增加其效果目标集合(复用 `appendedCollections` 推导,现仅用于
  集合反链方向):`{rel: ['collection'], href: /api/entity?rel=<collection>}`。
- 产物→流回链:凡集合成员可推导归属某 flow(现有 `withCollectionFlowEntryLinks`
  口径)补齐;不可推导(无流/纯 seed 无 flow 归属)保持诚实缺链,零发明。
- 覆盖缺口集合:comments / software-changes / writing-requests / agent-runs
  中可推导者。

### FR2 全通道归属可推导(零新真相)

- 归属判定只依赖现有投影事实(`snapshot.collections` 成员关系 + flow 效果
  声明);seed/chat/worker 创建通道不新增登记表,不写新业务事件。

### FR3 默认落点组合化(消费 T30 组合机器)

- 进入应用(应用 chip、`canvas?scope=<app>`,含无 focus)默认呈现该应用的
  **组合面**:产物集合概览(聚合虚主体,密集行:状态 + 主动作 + 详情)+
  流入口 + 进行中实例。
- 组合面由 sitemap app 分组与集合投影经 presentation 机器组装;单主体 surface
  = 组合的退化形态,同一台机器,不分叉。
- 空应用/空集合诚实呈现空态,不伪装内容。

### FR4 应用内导航闭环

- 默认面 → 集合/实体详情 → 返回默认面,全程 policy scope 保留。
- 合同 links(FR1)与呈现导航一致;UI 不发明合同外入口。

## 非功能需求

- GR1–GR5 全过(T36 后基线清零,无例外);超限沿功能边界拆解(D53)。
- D51 授权/注意力分离:组合面不引入会话 scope 类输入;授权仍 =
  grantedApplications × fold audience;零可见授权事件语义不变。
- 披露收窄发生在 prompt/呈现层,HTTP 合同端点不窄化(CLI 三纪律)。
- 事件投影可重放:新链接全部为投影推导,零新事件类型。

## 验收:用户故事闭环(agent 浏览器视觉审核,非 Playwright)

> 审核方式:编排 agent 通过浏览器实操(导航/点击/表单)+ 截图 + DOM 快照
> 断言,逐故事留证 track `review.md`(证据 = 截图文件引用 + DOM 关键事实 +
> pass/fail 结论),用户可复核。**不编写任何 Playwright 脚本**(GR5:不留
> per-track 剧本;既有 `pnpm check` 单测/治理门禁照常作为回归底线)。
> 用户故事必须覆盖至少三个应用内的流程。

- **U1(publishing)默认组合面**:进入内容发布,默认看到组合面——文章集合
  概览(密集行)+ 向导入口;审核信息层级与密度(不再是大块单实例卡)。
- **U2(publishing)发布可达**:发布一篇文章后,从默认面两次点击内到达该
  文章实体;文章页可返回集合与默认面,scope 保留。
- **U3(todo 或 ideas)捕捉闭环**:进入待办(或想法)应用,经捕捉流创建
  一条待办;产物在默认面可见并可达。
- **U4(community)审核动作**:进入社区互动,默认面展示评论集合成员,
  审核动作(通过/驳回)行内可达并可用。
- **U5 零特判 + agent 同门**:U1–U4 三应用同款默认面,git diff 无任何
  per-app/per-entity 特判代码;CLI(或合同探针)从同一投影发现相同入口;
  全程 scope 保留。

## Out of Scope

- 通用实体页(/entity)人读/审计分层(后续 track)。
- 视觉去嵌套:卡套卡样式规约、编译期折叠单子 Column(后续 track)。
- 密度词条全面治理(仅复用现有词条,不新增词汇)。
- 工作线首页改版(首页主角仍是工作线,不动)。
