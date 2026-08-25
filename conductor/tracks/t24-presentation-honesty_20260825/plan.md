# T24 呈现诚实化 — Plan

> 遵循 `conductor/workflow.md` 的 Story TDD、任务提交、Git notes 和 Phase Checkpoint 协议。
> 纯呈现层:不改引擎/合同/事件语义。spec:`./spec.md`。

## Phase A: canvas 机制抽屉化 [checkpoint: 706862c]

- [x] Task: 机制词表断言(Red) 02226a7
  - 固定机制词常量清单(surface 宿主/catalog.json/sidecar:/deref-failed/
    个人呈现 等),组件测试:canvas 主区域渲染文本不出现清单词;
    诊断/机制词只出现在抽屉内
- [x] Task: canvas 首屏清理(Green) 982d746
  - 移除头部机制行(A2UI surface 宿主/目录协商/表面 ID);信息层级:
    内容主体 > 合同动作(现状动作渲染不动) > 机制入口
- [x] Task: "为什么这样展示"抽屉 3b00cbd
  - 抽屉承接:sidecar 元数据与生命周期操作(pin/revert/patch/promote/
    设为团队默认)、provenance 解释(explain 接口)、surface ID 与 catalog
    协商信息、原始合同 JSON 视图
  - 能力等价测试:抽屉内各操作与现状 sidecar 控制条行为一致(复用既有
    route 测试口径 + 组件测试)
- [x] Task: sidecar 控制条降级 706862c
  - 首屏只留一个不显眼的"为什么这样展示"入口;原控制条从主区域移除
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) 706862c

## Phase B: chat 可观测性重构(活性保留,方言分层)

- [x] Task: thinking 帧默认折叠可展开 15d5752
  - 折叠态=一条进行中指示(步数/当前活动);展开态=实时思考增量(现状
    thinking-delta 渲染逻辑保留迁移)
- [x] Task: step 帧活动语言 5eaac0c
  - 固定 op 词汇映射(舞台机械,非文案模板):navigate→正在读取 {rel 标题}、
    exec→正在执行 {action 标题}、present→正在准备「{subject}」的呈现、
    answer/fail 等;映射表为固定常量,零每实体分支
  - 审计下钻:每条活动可点击跳事件流对应事件
- [~] Task: 失败措辞分层
  - 机械层产出结构化 reason({code, evidence, 已尝试});LLM 在场时由其
    生成面向用户表述;LLM 不可用时渲染中性结构化展示
    ("失败 · code=… · 已尝试:…"),零硬编码友好文案模板
  - 测试:三种来源(LLM 表述/中性降级/结构化数据)各自的渲染形状
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: 端到端验收

- [ ] Task: e2e 与走查
  - Golden Story 人类段/Agent 段、invariants 全绿
  - Playwright 截图走查:canvas 首屏零机制词、抽屉能力等价、chat 折叠/
    活动语言/失败分层

## 验收标准(Track DoD)

1. 机制词表断言通过:canvas/chat 主区域不出现机制词,全部机制能力在
   "为什么这样展示"抽屉内等价可达(pin/revert/promote/explain/原始合同);
2. chat 可观测性保留:thinking 可展开实时、step 为活动语言、可下钻事件流;
   失败三分层正确(LLM 表述/中性降级/结构化数据),无硬编码文案模板;
3. 零每应用/每实体类型特判组件(代码扫描 + review);
4. `pnpm check` + `CI=true pnpm e2e invariants` 全绿;部署后 Playwright
   走查截图对比(首屏/抽屉/chat)。
