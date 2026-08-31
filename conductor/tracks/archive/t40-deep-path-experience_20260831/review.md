# T40 Final Review

Date: 2026-08-31 (Asia/Singapore)

## Outcome

T40 按 `user-stories.md` 的深路径验收口径闭环:S1–S10 全部浏览器/CLI 实测通过(无 NOT RUN),
真实 LLM(gpt-5.6-sol)覆盖 S4/S6,无双 driver 冒充。F-01~F-12 全部修复或裁定闭环;S6 的
「引用点击白屏」经 dev/生产对照实验定案为 Next dev 按需编译开销,非产品缺陷。

验收方法:编排 agent 以使用者身份在真实 Chrome(channel=chrome)按 user-stories.md 步骤实测,
视觉对照期望效果逐条判定;CLI 侧使用仓库技能 ui4a-cli 的同源合同路径;现场实例
(ui4a.mothership.internal:32067)登录态复核。

## 逐故事判定

| Story | 判定 | 终局证据 |
| --- | --- | --- |
| S1 待办全链路:书架→实体页→回首页 | PASS | evidence/s1-01~06 |
| S2 写作深路径:brief→实体页→决策点 | PASS(6/6) | evidence/s2-01~04 |
| S3 实体页读面(三应用同一约定) | PASS | evidence/2026-08-31-phase-c/t40-c-01~04 |
| S4 Chat 共同注视(真实 LLM) | PASS(8/8) | evidence/s4-01~02 |
| S5 Chat 失效 focus 诚实降级 | PASS | evidence/2026-08-31-phase-b/t40-s5-03/04 |
| S6 Chat 推进业务并自我认知(真实 LLM) | PASS(生产 9/9) | evidence/s6-01~04 |
| S7 工作线深路径 | PASS(7/7) | evidence/s7-01~07、e-thread-after-fix |
| S8 首页读面:空态与有态 | PASS | evidence/2026-08-31-phase-d/t40-d-01、s1-06-home-after |
| S9 Meta 治理深路径 | PASS(11/11) | evidence/s9-console/flows-collection/flow-detail/back-console |
| S10 双门同径 + 窄屏 + 现场 | PASS | evidence/s10-*-390.png ×4;CLI 输出对照;现场复核记录见下 |

## 故事要点与视觉事实

- **S1**:landing 首屏有应用标题/用途说明/「添加待办」入口;实体页首屏回答「写周会纪要 /
  进行中 / 完成·归档」,备注可见,无 `open`/`flow flow:…` 机械标识主文案(F-02/F-03/F-06
  修复生效);点「完成」后状态当场变「已完成」、动作区当场换成「重新打开」;回首页与实体页
  一致(屏上即真相)。
- **S2**:brief 表单必填与人话说明在场,server-owned 字段不作输入框;提交后实体页中文状态 +
  进度/文档/引用/渲染证据分层;executor 不可用时实体页呈结构化人话失败与下一步建议(非空白
  非裸码);「接受不等于发布」语义可读。
- **S3**:todo/writing/article 三应用实体页同一呈现约定:概览(标题/中文状态/动作)→ 详情
  (声明字段分层)→ 次级(机械信息退守)→ 原始合同可局部展开(exact Siren JSON)。
- **S4**:实体页就地 chat 起步无 `start_entity_unavailable`(F-01 修复生效);助手回答引用
  同一实体事实(标题/状态一致);推进请求经确认门执行,实体页状态当场变化;顶栏注视 chip
  可见;FactRef 引用可点回实体。
- **S5**:失效 focus 进入聊天不被阻断;回执人话说明「看不到你指的那个对象」+下一步;结构化
  失败细节退守可折叠区;随后正常提问正常进行。
- **S6**:动作提议+后果说明→确认后执行(不静默);todo 列表/实体可见新待办;**chat 引用
  chip 可点进实体页**(F-12 修复生效;生产实测点击后 1s 内完整渲染 todo:1039);助手自述
  刚做成的动作(途中还如实说明过「没有可核实创建记录」的上一轮,自我认知准确);全程零动作
  重放、零重复授权追问;重载历史会话后引用 chip 仍在(F-12 持久化+重放恢复)。
- **S7**:工作线详情首屏目标/状态/涉及对象(可点)/生命周期动作齐全;涉及对象一键到实体页,
  返回路径连续;线内 chat 起步正常;完成待办后线投影反映进展;「来源」人话化(F-08 落实:
  可解析→任务语,不可解析→干净省略,裸串退守 raw)。
- **S8**:空态下「在等我」「在动」各有一句声明式引导(F-04 的 emptyMeaning 生效:「当前没有
  需要你处理的事项。」),「我的工作线」空态有开始指引;有态时三区可读;状态词全站一致。
- **S9**:定义控制台分组与卡片标题全中文任务语言(F-05 修复生效,无 Governed Drafts 类未译
  术语);flows 集合计数为「当前返回 N 项」完整文案;flow 详情首屏业务标题/状态/版本/动作,
  拓扑随后;返回控制台保留 editorial 视角(顶栏 chips 与 URL 不丢)。
- **S10**:CLI 与浏览器同源——flows list、entities get todo:ui-2 事实与动作集一致;
  dry-run→exec complete→读回 done+reopen 全通;USAGE 错误为结构化信封;390px 视口首页/
  实体页/工作线/chat 浮窗零横向滚动、动作不遮挡正文。现场实例:Keycloak 登录、首页书架、
  meta 控制台登录态渲染全通;`/canvas?focus=todos` 在现场呈「内容不存在或不可见」结构化
  回执——部署旧代码无 todo 集合,诚实降级形态正确(部署滞后,非当前代码缺陷)。

## S6 引用点击白屏定案(专项)

dev 模式两次复测点击 citation chip 后 /canvas 内容区白屏 20s+(verify-s6 一致复现)。定位链:

1. 种会话重放后点击两类 chip(流实例 todo-capture:main / 条目别名 todo:1009)均 <3s 渲染;
2. 直接全页加载同一 URL 渲染正常;服务端 presentation 解析事件时间戳恒定 <100ms;
3. dev 实盘全插桩复现:点击后 11s 无反馈窗口后自愈,全程零 pageerror/console error/失败请求;
4. **生产构建(next build && start,PORT=3101)同路径实盘:点击后 1s 内完整渲染**;
5. 生产模式正式判定 verify-s6-prod **9/9 全绿**(todo:1039)。

裁定:Next dev 按需编译开销,非产品缺陷;verify 脚本 waitForFunction 因导航上下文销毁的
假阴性加重了当时的误判。定案记录已回填 findings.md F-12。

## Findings 闭环清单

- F-01 chat 失效 focus 阻断起步 → 修复(诚实降级回执)。
- F-02 实体页裸机械标识/英文状态词 → 修复(中文状态词+机械信息退守次级)。
- F-03 实体页字段分层/备注缺失 → 修复(概览/详情分层)。
- F-04 首页空态死标题 → 修复(声明式 emptyMeaning 引导,e63d536)。
- F-05 Meta 控制台未译术语 → 修复(全中文分组,e63d536)。
- F-06 实体页原始合同可达性 → 修复(次级入口局部展开)。
- F-07 未登录 /meta 外壳+报错 → **裁定为当前代码缺陷**(meta-client 未接 T22
  redirectToLoginOnAuthError),修复 692db8d;401 双路径跳登录、404 存在性隐藏语义不变。
- F-08 工作线来源裸 UUID → 裁定落实(可读物优先/不可解析省略/raw 退守,e63d536)。
- F-09、F-10 → 修复(Phase C/D,详见 findings.md)。
- F-11 /chat window 态被 focus 帧拽离 → 修复 dd6f930(variant==='window' 零编程式导航)。
- F-12 exec 回合终局消息无实体引用 → 修复三层(确定性退守 finalTurnCitations;客户端
  handleFinal;服务端持久化进 chat-message-appended;重放恢复去 answered 限制)。
  附带:委托集合契约测试两处期望补 emptyMeaning(漏网 db 用例,Phase E 补齐)。

## 全量门禁(E5)

- `pnpm format:check`:pass。
- `pnpm governance:strict`:pass(空基线,GR1–GR5 全绿)。
- typecheck:7 个 workspace 全绿(packages/shared、engine、agent、db、apps/web、worker、cli;
  根 `pnpm -r` 不可用为本机 pnpm shim 限制,逐包等价执行)。
- ESLint `eslint .`:0 errors(17 warnings 为既有 TanStack Table/test-stub 告警,T39 已登记)。
- vitest unit:全量 exit 0 全绿(369+ 文件;registry.test.ts 的 lazy-import 用例在高负载并行
  下曾超时偶红,单跑 3.1s 稳定绿,与本 Track 改动无涉,属既有抖动)。
- vitest db:全量 exit 0 全绿(含 delegations.contract.test.ts 空态期望修复后 4/4)。
- `CI=true pnpm e2e invariants`:全量 13 passed / 14 environment-gated skipped,exit 0
  (I3 fuzz 曾在高负载并发下偶红,单跑 12.3s 稳定绿,属既有抖动)。
- `CI=true pnpm e2e`:全量 55 passed / 22 environment-gated skipped / 0 failed,exit 0(8.3m,
  真实退出码落日志)。E5 顺手对齐 4 个 spec 的 F-02/F-04 陈旧断言(实体页 h1=实例身份、
  状态行中文节点标题、成员状态词中文、三集合 emptyMeaning、「在哪」弹层文案收缩——均为
  本 Track 有意合同改动,T36 先例);复测中 human B2 曾遇场景 server 中途拒连
  (ERR_CONNECTION_REFUSED)一次性抖动,单跑 3/3 与全量重跑均稳定绿,与产品行为无涉。
- 说明:`pnpm check` 字面命令因 pnpm shim 不支持 `-r` 不可直接执行,E5 以其等价分项
  (逐包 typecheck + eslint + governance:strict + vitest unit/db)覆盖。

## 剩余观察项(不阻塞,移交后续)

1. todo 中文标题 slug 回退为标题内数字(todo:1039 式);纯中文标题落时间戳 slug——rel 不追求
   语义,可读物层已覆盖。
2. landing 捕捉流实例卡显示上次 in-flight 值(单例实例的已知呈现)。
3. 确认实体裸 status=pending 出现在次级层。
4. S2 executor 失败行 `[http-500]` 为英文(诚实但非人话)。
5. S4 LLM 措辞「原先已是完成状态」事实正确但表述可更自然。
6. chat 内状态词中英混排「进行中 (open)」。
7. dev 模式实体页首次客户端导航存在 ~10-20s 无反馈窗口且无 skeleton;生产实测 1s 内渲染。
   若后续 dev 体验优化立项,可在此入手。
8. 现场实例 todos 集合不存在 = 部署版本滞后,随下次发布消化。

## 归档声明

临时验收脚本(verify-*/inspect-*/repro-*/probe-*/dump-*)已按 GR5 全部删除,证据截图固化于
`evidence/`。Track 归档进 `conductor/tracks/archive/`。
