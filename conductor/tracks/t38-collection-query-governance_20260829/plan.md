# T38 集合查询治理 — Plan

> 执行方式:自治编排协议(`conductor/workflow.md`)。TDD 红绿;每任务
> commit + git notes;Phase 末 checkpoint。Phase C 用户故事验证由编排 agent
> 浏览器视觉审核代行(截图 + DOM 断言留证 `review.md`),不写 Playwright;
> **全应用横扫验收**;固定评审项:**无每应用/每实体类型特判代码**
> (`product-vision.md` §六)。治理失败只如实报告,不裁剪代码(D53)。

## Phase A:合同层——分页投影、过滤声明、显示 hint 贯通

- [ ] Task A1: Red——投影/service 测试:集合实体可选分页参数(limit/offset
  或 cursor,实施期定形)切片成员嵌入;不带参数响应与现状逐字节一致(既有
  全量测试锚定);非法参数结构化拒绝;分页响应 links 声明 next/prev(无更多
  页诚实缺链)。
- [ ] Task A2: Red——过滤声明与投影:sitemap 集合表面/投影声明可过滤维度
  与值域(来源应用定义数据);过滤参数生效(值域外结构化拒绝);过滤 +
  分页组合;行级授权投影逐行不变(D51 回归断言)。
- [ ] Task A3: Red——显示 hint 贯通:应用定义声明概览字段/标题/顺序(优先
  复用既有 presentation.fields 角色体系扩展);实体投影携带 hint;引用未
  声明字段按投影校验处理并留诊断;agent 经同一投影可读 hint(双门)。
- [ ] Task A4: Green——实现定义→投影→成员携带链路(web engine service +
  packages/db 读取边界;bundle 声明扩展;零新事件类型);全部测试转绿。
- [ ] Task A5: 合同探针 + 门禁:curl 断言无参数全量/带参分页/过滤/组合/
  非法拒绝/hint 携带六类形状;`pnpm check` + `pnpm governance` 全绿;
  commit + git notes。
- [ ] Task A6: Phase A Checkpoint(复跑、留证、checkpoint sha)。

## Phase B:呈现层——概览列、分页脚、过滤控件

- [ ] Task B1: Red——member-table 组件测试:概览列按 hint 渲染(标题/顺序/
  缺 hint 回退现状);仅当声明分页链接时渲染分页脚(next/prev;无声明零
  零件);仅声明维度渲染过滤控件(值变更触发携带参数取数);URL query
  同步(可分享回放)且 scope 保留;单页/无维度诚实空态。
- [ ] Task B2: Green——member-table 概览列与分页脚/过滤控件实现(通用,
  零 per-app);member-card 的 detail 位按 hint 升级(无 hint 原样);既有
  词条/组合测试零回归;commit + git notes。
- [ ] Task B3: 组合面贯通:canvas 取数链路携带分页/过滤参数(声明驱动);
  组件与集成测试绿。
- [ ] Task B4: Phase B Checkpoint(含 §六四滑梯自查;单测 + governance 绿)。

## Phase C:用户故事视觉闭环(全应用横扫;浏览器实操审核)

- [ ] Task C1: U1(publishing)分页:合同门批量创建成员(CLI/exec,顺带验
  agent 同门)→ 分页脚翻页、URL 参数、刷新保持、scope 保留;证据留
  `review.md`。
- [ ] Task C2: U2(community)过滤 + hint:声明维度筛选 pending;过滤 +
  翻页组合;概览列按 hint;证据留证。
- [ ] Task C3: U3(publishing)hint 概览列:声明字段进集合行,详情面全量
  不变;证据留证。
- [ ] Task C4: U4 全应用横扫:逐一进入 7 个应用默认组合面 + 关键集合,
  截图审展示效果(声明渲染/零件只在声明处/零诊断/行内动作与详情链接
  无回归);证据留证。
- [ ] Task C5: U5/U6 合同门 + 零特判:curl 六类形状;hint 双门消费;
  git diff 无 per-app;D51 授权回归;证据留证。
- [ ] Task C6: review.md 汇总 pass/fail;发现问题回修(限触达面)并复审;
  `pnpm check` + governance 全绿;`pnpm dev:all` 实测可运行。
- [ ] Task C7: Track Checkpoint:git notes 终审(含 §六滑梯自查、全应用
  结论);更新 registry;GOAL/DECISIONS 沉淀如有。
