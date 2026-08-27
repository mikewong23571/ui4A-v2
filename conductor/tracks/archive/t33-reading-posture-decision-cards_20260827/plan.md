# T33 读面姿态与责任点 — Plan

> 遵循 `conductor/workflow.md` 的任务生命周期、Git notes 与 Phase Checkpoint 协议。
> spec:`./spec.md`(含 ASCII 理想态用户故事方向锚;锚点全为路径+符号,实施前复核)。
> 每 Task 先 Red 再 Green;每 Phase 结束复跑 `pnpm check` 与
> `CI=true pnpm e2e invariants`。
> 治理纪律:GR3 业务优先不为凑行数拆分;触及 shrink-only 基线目录
> (`packages/engine/src/presentation`)须净不增长;例外登记由编排 agent
> 统一执行,subagent 只如实报告。词汇/目录变更走 catalog 版本升级。
> 冲突面:`depends_on` T32(交互与组合质量修复,Phase E 收尾在途)——本 Track
> 在 T32 闭环后开工;若并行,逐任务核对 T32 是否触及 `action-runner`/`generic`/
> `intent` 同文件。
> 前置确认:T27/T28/T30 已归档(消费对象);D45/D46/D47 已落 DECISIONS.md。
> 实施前必读:根 `AGENTS.md`、`apps/web/AGENTS.md`、`conductor/workflow.md`。

## Phase A: 裁决固化 → DECISIONS(D50) [checkpoint: b33bc28]

- [x] Task: 读/写姿态裁决落 DECISIONS.md D50 [a8a143a]
  - 两小节:① D47.4 姿态细化——actions 任何 intent 下始终保留且为一等控件;带参数
    动作的参数表单全站单一默认收起(打开是零业务事件的表现层交互);无双路径;
    ② 读/写通道分工方向判断——复杂写的正典在 chat 原话授权(T15 仪式),UI 保留
    责任点一击(批准/拒绝/确认);
  - 裁决须显式核对 D47 原文,不得复辟已否决候选(read 意图下移除动作 = 违背
    D47.4 与 T28"每个声明 action 有一等控件");
  - 验收:D50 一条目两小节,各有明确采纳与理由;引用 product-vision §一.1
    "只做你明确要点头的部分"
- [x] Task: 误导性验收排查清单落地(spec"误导性验收排查"节为初核)
  - grep 复核结论(2026-08-27):
    - 组件测试:`action-runner.t16.test.tsx`、`entity-view.test.tsx:228-332`
      (ActionRunner RJSF 直渲染/直填)、`annotations.test.tsx`(表单 data-action
      断言)、`render/words/detail.test.tsx`/`form.test.tsx`(经 ActionGroup 渲染
      表单)——Phase B Red 时逐一迁移(先点触发键再断言表单);
    - e2e:`human.spec.ts` B1(向导三步 textbox 直填 ×4)、
      `dual-executor.spec.ts:158-168`(同)、`invariants.spec.ts:249-259` 与
      `s1.spec.ts:395-410`(确认页 reason textbox required 直断言——需先点开
      驳回表单再断言);chat/workstation-home 套件无展开表单依赖,不动;
    - 英文 title 断言:grep 'Create work thread'/'Thread id'/'Goal source' 在
      测试中零命中——Phase C 仅需新增中文断言,无旧断言迁移;
    - 成员纯链接断言:`workstation-home.spec.ts` 区域内容断言在 Phase D 复核;
    - 关键事实:流程向导(文章三步)表单即实体动作表单,经 entity-view →
      ActionGroup → ActionRenderer 渲染——默认收起后每步需一次"打开",
      e2e 按此迁移(D50 单一默认,不留向导特例)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase B: 写姿态单一默认收起 [checkpoint: 17a6d11]

- [x] Task: Red——ActionRunner 组件测试改预期 [17a6d11]
  - 默认态断言 `closed`(带参数动作渲染一行触发键,不渲染展开表单);点击打开后
    prefill/schema 校验/焦点/两段式确认行为断言保持;mutation 抽查:恢复默认
    `form` → 变红
- [x] Task: Green——`action-runner.tsx` 初始态改 `closed` [17a6d11]
  - 触发键/图例/`data-action` 注记保持;打开后的全部既有行为零改动
- [x] Task: 读面零展开表单断言 + e2e 迁移 [17a6d11]
  - 新断言:首页三区域、canvas read surface、实体页首屏无默认展开参数表单;
  - 按 Phase A 清单迁移受影响填表步骤(统一加"打开"一步,GR2 一次性,无双默认)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: 任务语言(合同数据层) [checkpoint: c20c3d0]

- [x] Task: Red→Green——work-thread 定义 title 中文化 [c20c3d0]
  - engine 投影单测先行:threads 全部动作 title('创建工作线'等)与字段 title
    ('线程标识'/'目标'/'目标来源'等,具体措辞施工时定)断言;`work-thread.ts`
    数据改动,渲染器零改动
- [x] Task: Red→Green——链接标签优先合同 title [c20c3d0]
  - 投影为 self/member 链接携带 Siren `title`(集合 identity 已有'在等我'式
    人话标题,链接层补齐);渲染器(detail/entity-link 的 links 区)优先 title
    回退 rel;words 单测先行
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: 责任点一等——成员决策卡(词汇投资) [checkpoint: bfa1791]

- [x] Task: Red——engine presentation 单测:成员决策卡结构规则
  - 施工发现(记入 notes):① inbox 成员投影缺 canonical properties.rel
    (member-link 同样潜伏,首次被真实成员踩到)→ projectConfirmation 补齐;
    ② surface 适配器 guard 检查未接入 blockedForRenderer(renderer 满足
    actor-is-human),确认动作在 surface 路径全部被拒 → 接入与 ActionGroup
    同规(T28 遗留接缝);③ e2e 决策卡需 terminateStaleNotifyWorkflows
    清理口径(与 s1 同) [bfa1791]
  - repeat 成员携带已声明动作 → item 子树含 identity + 摘要 + actions 绑定;
    无动作成员 → 维持 member-link(纯结构规则,零 class/rel 分支);
    mutation 抽查:注入 `if class` 分支 → 变红(以 review + 扫描兜底)
- [x] Task: Green——`member-card` 词条与 catalog 版本升级 [bfa1791]
  - 新词条:identity + 一行结构化摘要 + ActionGroup(复用 D47.1 统一动作组);
    engine surface catalog + web word-catalog/catalog-adapter 双注册,指纹/版本
    bump(sidecar 失效走既有依赖机制);GR3:engine presentation 净不增长
- [x] Task: e2e——首页"在等我"决策卡 [bfa1791]
  - 成员卡 approve 一击(零导航、零参数)→ `/api/exec` 同裁决 → 事件落库 →
    卡片退场计数即变;与 chat 写同裁决断言(actor 区分,门相同)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase E: 工作线一句话 + 在动进度轨 [checkpoint: cbb58a1]

- [x] Task: Red→Green——thread/delegation 投影补任务语言 resume 行 [cbb58a1]
  - 实施口径修正:角色声明通道改为投影派生属性(properties.resume)+ 规划器通用
    可选绑定(status/detail),替代原计划的两个新词条(resume-point/progress)——
    更小刀、零新词、同一验收(一句话+进度呈现);计划口径偏差按 in-flight
    refinement 记录
  - thread:statusPointer/recent-events 进入角色通道;delegation:steps/successes;
    投影单测先行
- [x] Task: Red→Green——成员 status/detail 绑定与词条渲染(替代新词条方案) [cbb58a1]
  - `resume-point`:「停在「X」 · 时间」框架文字通用固定,节点名/时间全部合同
    插值(D47.1 模式,零实体类型分支);`progress`:steps/successes 机械计数条;
    catalog 版本再升级
- [x] Task: e2e——首页要素断言 [cbb58a1]
  - 施工发现(记入 notes):① 组合区域 rehydrate 模式冻结成员词选择 → my-work
    声明 v2(invalidate)演进;② 潜伏双 principal 分裂(user:local vs local-user)
    → 统一为 local-user(生产 3 处+测试 9 文件),否则规划永远看不到 UI 建的线
  - 工作线成员一句话 + 时间;在动成员进度呈现;`data-nav`/`data-action` 注记
    齐全(I3)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase F: 验收收口 [checkpoint: 71a3591]

- [x] Task: 全量回归
  - `pnpm check` 全绿(typecheck/eslint/governance/unit 2535/db 490);
    `CI=true pnpm e2e invariants` 4 passed;全量 `CI=true pnpm e2e`
    **52 passed / 0 failed / 20 skipped**(与基线口径一致;含 T16 golden、
    T24 honesty、T27 home、T28 citations、T30 composition)
- [x] Task: 人机同源与 chat 写复验
  - CLI 对拍:workstation-home e2e 首测试即 CLI 对照(doctor + entities get
    三区域源逐项一致,principal 已统一 local-user);画面 3(chat 原话授权建线)
    机制由 T15 quote-authorization 测试族与全量 chat 套件背书(执行走同一
    /api/exec 合同,本 track 零 chat 链路改动)
- [x] Task: 走查对照与零特判复核
  - 截图走查(2026-08-27,dev server + 1 待决 + 1 工作线)对照画面要素清单
    全部在场:在等我=决策卡(批准一击零参数)、我的工作线=目标+「停在「open」」
    一句话+收起动作行(挂载/卸载/暂停/完成/归档全中文)、写=一行收起
    (填写创建工作线参数)、区域链接=合同 title(在等我/在动/我的工作线)、
    首屏零英文机器名(rel 仅在 mono 辅助位);零特判:成员卡选择纯结构
    (members.some(actions)),governance 全绿;D50 与实施一致(D47.4 未推翻,
    动作全部保留为一等收起控件)
  - 环境备注:走查期间 3100 临时停 docker web 容器,结束已恢复(200)
- [~] Task: mothership 现场验收(spec 验收方向末条口径)【显式遗留】
  - 确定 Git SHA 构建 immutable OCI images,按 T22 runbook 部署走查,evidence
    记录 SHA/digest/命令/时间/逐项结果
  - 处置(2026-08-27,自治如实记录):mothership 为内网 K8s 部署,本会话环境
    无集群凭证与网络可达性,无法诚实执行;本地全部门禁已绿(check/invariants/
    全量 e2e 52/截图走查)。**该项保持未勾**,待具备 mothership 访问条件时从
    当前 Git SHA 构建 images 按 T22 runbook 执行并补记 evidence;在此之前
    本 track 的现场验收条款视为未完成(本地验收已完备)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)
