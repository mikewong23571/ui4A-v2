# T28 一等交互与引用 — Plan

> 遵循 `conductor/workflow.md` 的 Story TDD、任务提交、Git notes 和 Phase Checkpoint 协议。
> spec:`./spec.md`(含方向依据、依赖锚点、现状事实与 Phase A 决策点;锚点全为
> 稳定符号标识,实施前以仓库现状复核)。
> TDD 顺序:每 Task 先 Red 再 Green;每 Phase 结束复跑 `pnpm check` 与
> `CI=true pnpm e2e invariants`。
> Phase B–E 固定执行本 Track 的 DECISIONS 条目(Phase A 产出,编号顺延;T27
> spike 占 D46);不得重新引入已否决候选。
> 治理纪律:GR3 行数上限不驱动裁剪(业务优先原则);例外登记由编排 agent 统一
> 执行,subagent 只如实报告。
> 前置确认:T27 已闭环(站点框架与共享 canvas 宿主),并按 spec"T27 闭环后
> 复核点"清单逐条核对;T30 已闭环归档,T24 已闭环。
> 实施前必读:根 `AGENTS.md`(构建/测试命令与 GR1–GR5)、`apps/web/AGENTS.md`
> (Next.js 版本特定规则)、`conductor/workflow.md`(任务生命周期/验收协议)。

## Phase A: Spike → DECISIONS(分歧先于代码)

- [ ] Task: spike 五问决断,落 DECISIONS.md 新条目
  - 五问 = spec.md"Phase A 决策点":动作控件统一形态与提交路径、chat 引用
    呈现与点击行为、raw 模式形态与入口、intent 裁剪规则与接线、诊断节点
    呈现位置
  - 每问给候选/约束/推荐默认/否决项与理由;锚点:spec.md"现状事实"节;
    可用纯函数/组件原型验证形态语义(不提交或提交为 spike 测试)
  - 验收:DECISIONS.md 新增条目,编号顺延;五问各有明确采纳/否决;否决项
    写明理由(防复辟);第 5 问的裁决显式核对 D45 第 5 问(降级不静默)
- [ ] Task: spec/plan 回改对齐
  - 将已决形状同步进 spec 最终形态与 Phase B–E 任务合同,清除开放问题与
    推荐默认措辞;tracks.md 无需动(本 Track 已登记)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase B: 动作一等按钮

> 既有验收与本 Phase 同向(human B1–B3、s1 UI 走查按 role 找按钮);前置处置
> 项 = `entity-view.test.tsx` 的 guard-results 用例随呈现升级扩展。

- [ ] Task: 一等动作渲染器统一(Phase A 第 1 问已决形状)
  - 实体页/canvas/组合区域同一渲染器;双提交路径按已决形态收编或分层统一;
    语义不变(同一 /api/exec、同一 declaration → guard → schema、同一确认门)
  - Red→Green:渲染器组件测试(三形态/确认门/live 复核);"每声明 action 有
    控件"的合同驱动断言(以不同 class 实体 fixture 证明零特判)
- [ ] Task: 人/AI 同权标注 + guard 原因可见
  - 同权标注按已决形态上控件;guard 阻断原因从合同 guard-results 结构渲染为
    可见呈现(不藏 tooltip),零硬编码文案
  - Red→Green:标注呈现断言;guard-results 各形态(blocked/unblocked/
    actor-is-human 解除)可见性测试;i3 注记齐全
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: chat 引用可点(可独立提前,若 T27 未闭环可先落地本 Phase)

> 协议零改动:citations(FactRef)已端到端落库,本 Phase 纯 UI 消费。

- [ ] Task: 引用渲染与画布聚焦(Phase A 第 2 问已决形状)
  - assistant 消息的结构化引用渲染为可点入口;点击 = 画布聚焦同一实体
    (沿用既有 focus 链路;T27 已闭环则按其宿主形态);因果链最小联动按
    已决形状
  - Red→Green:引用渲染组件测试(只消费结构化 citations;零文本解析——
    代码扫描自查);e2e:chat 回答引用可点、点击后画布聚焦同一实体
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: raw 模式

- [ ] Task: 随处可达的"查看原始合同"(Phase A 第 3 问已决形态)
  - 实体页/canvas/引用入口按已决形态落地;未组装 Siren JSON 必备,事件切片/
    provenance 按已决范围;零组装、零 AI;无顶级导航入口
  - Red→Green:两步可达 e2e(任意实体 → 原始合同 JSON);raw 视图无 LLM
    调用断言;新控件 i3 注记齐全
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase E: 呈现按 intent 裁剪 + 诊断归位

> 前置处置:generic planner/compiler 断言"全属性绑定"的旧 fixture 先迁移
> (GR2 一次性,处置记录进任务 notes)——先于裁剪落地。

- [ ] Task: intent 进入 generic 路径(Phase A 第 4 问已决规则)
  - intent 经 planRegion/broker 传入 generic 回退;裁剪规则按已决形状(role
    驱动声明式规则,零实体类型分支);binding-only 不变
  - Red→Green:纯内核测试(intent → 字段子集选择;零字面量,property test
    口径);绑定字段数显著下降且无信息回归(快照 + 走查)
- [ ] Task: 诊断归位(Phase A 第 5 问已决形态)
  - 诊断细节(deref-failed 等)只在抽屉暴露;区域降级在位指示与"不静默、
    不泄漏"按已决形态;迁移 canvas-why-drawer/compiler 受影响用例
  - Red→Green:首屏零诊断细节断言;抽屉内诊断可达断言;region-unavailable
    降级 e2e 不回归(T30 口径)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase F: 端到端验收与收尾

- [ ] Task: 全量验收
  - `pnpm check` 全绿(含全量 vitest——I2 靠 property test,e2e 不构成
    binding-only 证据);`CI=true pnpm e2e invariants` 全绿;`CI=true pnpm e2e`
    全量全绿;T16 presentation/T24 honesty/chat 套件全绿;`pnpm dev:all`
    实际启动走查(里程碑约束)
- [ ] Task: Track 收尾
  - `conductor/tracks.md` 状态流转;track 目录按 GR5 处置(无 bespoke 脚本/
    配置残留);metadata.json 归档;方向 program(T24–T30)全闭环,GOAL.md
    与 product-vision.md 的落账口径复核

## 验收标准(Track DoD)

1. spike 五问落 DECISIONS.md(编号顺延,采纳与否决齐全),spec/plan 与之一致;
2. 动作一等控件:每个声明 action 有控件(实体页/canvas/组合区域同一渲染器),
   人/AI 同权标注可见,guard 阻断原因可见且来自合同 guard-results;提交过
   同一裁决(I3 fuzz 复用);
3. chat 引用可点:citations 渲染可点、点击画布聚焦同一实体;渲染只消费
   结构化 FactRef,零文本解析;
4. raw 模式:任何实体两步内可见原始合同 JSON;零组装零 AI;无顶级导航入口;
5. 呈现按 intent 裁剪:generic 绑定按 intent 收敛(无信息回归);诊断细节只在
   抽屉,区域降级不静默;I2 property test 全量通过;
6. `pnpm check` + `CI=true pnpm e2e invariants` + e2e 全量全绿;系统实际可
   运行。
