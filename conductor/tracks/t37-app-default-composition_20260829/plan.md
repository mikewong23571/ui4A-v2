# T37 应用默认展示治理 — Plan

> 执行方式:自治编排协议(`conductor/workflow.md`)。TDD 红绿;每任务
> commit + git notes;Phase 末 checkpoint。Phase C 的用户故事验证以
> **编排 agent 浏览器视觉审核**代行(截图 + DOM 断言留证 `review.md`),
> 不编写 Playwright 脚本;固定评审项:**无每应用/每实体类型特判代码**
> (`product-vision.md` §六)。治理失败只如实报告,不裁剪代码(D53)。

## Phase A:导航合同投影(纯合同层,零像素)

- [x] Task A1: Red——投影单测(引擎/web 投影测试位):流实例 links 含
  append 目标集合(流→集合正向,复用 `appendedCollections` 推导);
  产物→流回链在可推导处补齐(comments/software-changes/writing-requests/
  agent-runs 口径);不可推导处断言诚实缺链。确认测试失败。
- [x] Task A2: Green——`apps/web/src/engine/flow-entry.ts` 与
  `packages/engine/src/contract/siren/project.ts` 实现投影规则;
  重放测试保投影一致性;测试全绿。
- [x] Task A3: 合同探针验证 + 门禁:curl 断言三应用(publishing/community/
  development)流实例与集合 links 形状;`pnpm check` + `pnpm governance`
  全绿;commit + git notes。
- [x] Task A4: Phase A Checkpoint(复跑测试、留证、plan 标记 checkpoint sha)。[checkpoint: 1b40fa2c]

## Phase B:默认落点组合化(消费 T30 组合机器,零特判)

- [~] Task B1: Red——组合投影单测:按 sitemap app 分组组装「应用组合面」
  聚合虚主体(产物集合行 × 流入口 × 进行中实例);断言虚主体不进业务
  sitemap、不可 exec;断言组装路径纯数据驱动(通用代码,无 per-app 分支)。
- [~] Task B2: Green——engine presentation 内核(`packages/engine/src/
  presentation/`)+ web 适配(`apps/web/src/engine/presentation/`、
  `src/render/`)实现;测试全绿;commit + git notes。
- [~] Task B3: Red/Green——canvas 壳消费组合面(舞台机械改动,非页面
  组件):进入应用/无 focus 渲染组合面,不再空屏;组件测试先行。
- [~] Task B4: 集合概览密集行:复用现有词条(member-card/table)渲染
  「状态 + 主动作 + 详情」;不新增词汇、不写每应用组件;commit + git notes。
- [ ] Task B5: Phase B Checkpoint(含 `product-vision.md` §六四滑梯逐项
  自查记录;单测 + governance 全绿)。

## Phase C:用户故事视觉闭环(≥3 应用;浏览器实操审核)

- [ ] Task C1: U1/U2(publishing):进入内容发布见默认组合面,截图审核
  密度与层级;发布一篇文章后两次点击内达该文章(浏览器实操点链);
  证据留 `review.md`。
- [ ] Task C2: U3(todo 或 ideas):经捕捉流创建一条待办;产物在默认面
  可见并可达;证据留证。
- [ ] Task C3: U4(community):默认面展示评论集合成员,审核动作行内
  可达并可用;证据留证。
- [ ] Task C4: U5 零特判 + agent 同门:三应用同款默认面且 git diff 无
  per-app 代码;CLI/合同探针从同一投影发现相同入口;全程 scope 保留;
  证据留证。
- [ ] Task C5: review.md 汇总 pass/fail;发现问题回修(限 B/C 触达面)
  并复审;`pnpm check` + governance 全绿;`pnpm dev:all` 实测可运行。
- [ ] Task C6: Track Checkpoint:git notes 记录终审(含 §六滑梯自查、
  用户故事结论汇总);更新 registry 状态;GOAL.md/DECISIONS.md 如有
  沉淀则补记。
