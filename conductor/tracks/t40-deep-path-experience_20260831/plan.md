# T40 深路径体验闭环 — Plan

> 固定评审项:无每应用/每实体类型特判;文案/状态词/术语走合同数据与 D47.1 通用文案框架,
> 渲染器零字符串模板;chat 修复不引入意图启发式与 rule driver;D51 授权/注意力不削弱;
> 不新增 per-track Playwright 配置;GR3 超线即拆解,不登记新例外。

## 编排与 Subagent 执行协议

- 每个实现任务只派发一个 subagent;任务按计划顺序串行。
- 编排者派发前把任务标记 `[~]`;prompt 写明 Goal(含最窄测试命令)、Non-goals、Changes、
  Blast radius 四要素,并附 `GOAL.md`、`DECISIONS.md`、`product-vision.md`、本 Track
  spec/plan/user-stories/findings 与相关 `AGENTS.md`。
- subagent 负责 Red→Green 与 focused tests;编排者亲自看 diff、复跑 focused test,通过后
  commit 并推进;失败最多两轮修复,仍失败回滚该任务。
- Phase Checkpoint 由编排者执行,不委派:复跑本 Phase 测试、`pnpm governance:strict`,
  并浏览器实测该 Phase 对应故事切片。
- Track 末由编排者按 S1–S10 做完整深路径终审;此时才运行全量 `pnpm check`、
  `CI=true pnpm e2e` 与 invariants。

## Phase A:走查复核与修复点勘探(编排者执行)

> 本 Phase 不写生产实现。Red 不单独成 Task:A2–A5 原定失败测试折入 Phase B–D 各实现
> Task 的"任务内 Red→Green"——subagent 先提交失败测试,编排者审 diff 确认其确败后再
> 放行实现,Phase Checkpoint 复核。

- [x] Task A1(2026-08-31 完成):复核 `findings.md` F-01~F-08 对当前代码成立;走查证据入
  `evidence/2026-08-31-walkthrough/`;F-07 标记现场待核(E4 裁定),不在本地强行复现。
- [x] Task A2(2026-08-31 完成):修复点勘探——F-01 起步链与失败回执、F-02/F-03/F-06
  渲染机器消费点、F-04/F-05 声明数据落点,均已定位到文件行号,勘探结论入各 Phase
  Subagent contract 的补充说明与 findings.md。
- [x] Task A3(2026-08-31 完成):Phase A Checkpoint——findings/plan 定稿,A2–A5 的 Red
  折入各实现任务,进入 Phase B。

## Phase B:Chat 共同注视起步与诚实降级(F-01)

**Subagent contract**:Goal=chat 起步对任意 focus 形态可用且失败说人话;Non-goals=不改 LLM
driver/披露分层、不引入意图启发式;Changes=chat 起步/start entity 解析、失败回执投影与
`apps/web/src/chat/` 相邻测试;Blast radius=禁止 worker/db schema、业务引擎裁决、Assistant
prompt 结构变更。

- [x] Task B1(2026-08-31):Green——`resolveStartRel`(start-chain.ts):focus 仅当业务面存在性表
  命中且授权内(与 /api/entity 咽喉同谓词)才保留;虚主体/不存在/授权外降级 scope entry →
  站点兜底,起步不阻断;降级附 `ChatStartNotice`(code/droppedRel/startedRel/startedTitle)。
- [x] Task B2(2026-08-31):notice 条目与 T35 失败回执同形——主行 D47.1 式合同标题插值
  (「已从「文章」继续」),机械 code/rel 退折叠「注视数据」区(thread.tsx NoticeMessage)。
- [x] Task B3(2026-08-31):浏览器验证 S5 通过(真实 LLM 回合,降级 notice 在场,无裸错误码);
  无 LLM 时起步降级不阻断、driver 失败走 T35 诚实失败形态(实测 code=driver_fail)。
- [x] Task B4(2026-08-31):Phase B Checkpoint——start-chain/route-ai-first/floating-chat 等
  focused tests 编排者复跑全绿,governance:strict 过,S5 截图入 evidence/2026-08-31-phase-b/。

## Phase C:实体页读面深化(F-02/F-03/F-06)

**Subagent contract**:Goal=任一业务实体页首屏三问(是什么/状态/能做什么)+ 字段分层 +
机械标签退守,全部经通用渲染机器;Non-goals=不动 meta 面(T39 已收敛)、不动 canvas 组合
拓扑;Changes=合同数据(状态 title/字段 presentation role)、generic 渲染机器消费点与相邻
测试;Blast radius=禁止 per-class/per-app 分支、React 文案模板、worker/db、chat。

- [x] Task C1(2026-08-31):Green——状态词唯一来源:详情(generic.ts 回退链 title→status→node)
  与列表成员(itemStatusPath)同绑节点中文 title;EntityView h1 改 identity→title→rel 链、
  状态行消费节点 title、副标题裸 node 退守 raw。英文枚举不再直出(实测无裸 open/published)。
- [x] Task C2(2026-08-31):Green——字段只来自显式声明:generic 候选发明循环删除,
  READ_BUDGET 放量(primary-content 不限席、metadata:1,policy v3,DECISIONS D55);
  EntityView 拆 FIELD_DISPLAY_LABELS 字典,改消费 properties.presentation.fields
  (备注独立成行,未填/未声明不渲染)。
- [x] Task C3(2026-08-31):Green——flow 链接补 title(flow-entry.ts),锚文本任务语言;
  detail.tsx/entity-view.tsx 的 Badge rel 直出移除,机械标签退守 raw 层。
- [x] Task C4(2026-08-31):浏览器验证 S1、S3 通过(todo:v2 三问齐、备注分层;
  todos/articles/post:post-welcome 同一约定;截图入 evidence/2026-08-31-phase-c/)。
- [x] Task C5(2026-08-31):Phase C Checkpoint——编排者复跑 focused tests 全绿
  (entity-view/detail/flow-entry/generic-detail-surface/intent/surface),governance:strict 过,
  diff 零特判;t21 源码门禁与 meta page 陈旧断言随本轮一并矫正(见 review.md)。

## Phase D:首页空态、Meta 术语与来源可读性(F-04/F-05/F-08)

**Subagent contract**:Goal=空态引导与术语全部来自声明数据;Non-goals=不改首页聚合逻辑、
不新增区块;Changes=emptyMeaning/声明数据消费、sitemap/定义数据中文 title、工作线来源
显示裁定与相邻测试;Blast radius=禁止 React 字典、per-app 分支、Presentation composition
拓扑变更。

- [ ] Task D1:Green——"在等我/在动"空态引导消费合同声明;无声明时干净留白,不渲染裸标题。
- [ ] Task D2:Green——Meta 控制台分组/卡片术语中文化(sitemap/定义数据),含 Governed
  Drafts、Specialized Agents、definition-lifecycle。
- [ ] Task D3:裁定并落实工作线"来源"显示:可读物优先,原始标识退守次级;结论记入 findings。
- [ ] Task D4:浏览器验证 S8、S9(含视角连续性与计数文案)。
- [ ] Task D5:Phase D Checkpoint——focused tests、governance、首页与 meta 截图对照。

## Phase E:深路径终审(编排者执行,不委派)

- [ ] Task E1:S1/S2/S7 业务深路径浏览器实测(本地 dev),逐条判定加粗句,截图入库。
- [ ] Task E2:S4/S6 真实 LLM 故事实测;provider 缺失记 NOT RUN,禁止 rule driver 替代。
- [ ] Task E3:S10 双门同径(CLI/HTTP 对照)+ 390px 窄屏深路径。
- [ ] Task E4:现场实例复核 S1/S4 形态,裁定 F-07 归属(本 Track 修复或部署配置),登记差异。
- [ ] Task E5:全量门禁——`pnpm format:check`、`pnpm governance:strict`、`pnpm check`、
  `CI=true pnpm e2e`、invariants。
- [ ] Task E6:汇总 `review.md`,逐故事 pass/pass-with-observations/fail、真实 LLM 状态、
  截图路径、剩余观察;更新 GOAL.md/tracks.md,归档 Track。
