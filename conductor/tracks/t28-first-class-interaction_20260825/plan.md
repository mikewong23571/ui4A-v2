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

- [x] Task: spike 五问决断,落 DECISIONS.md 新条目
  - 五问 = spec.md"Phase A 决策点":动作控件统一形态与提交路径、chat 引用
    呈现与点击行为、raw 模式形态与入口、intent 裁剪规则与接线、诊断节点
    呈现位置
  - 每问给候选/约束/推荐默认/否决项与理由;锚点:spec.md"现状事实"节;
    可用纯函数/组件原型验证形态语义(不提交或提交为 spike 测试)
  - 验收:DECISIONS.md 新增条目,编号顺延;五问各有明确采纳/否决;否决项
    写明理由(防复辟);第 5 问的裁决显式核对 D45 第 5 问(降级不静默)
- [x] Task: spec/plan 回改对齐
  - 将 D47 固定形状同步进 spec 最终形态与 Phase B–E 任务合同,清除开放问题;
    tracks.md 无需动(本 Track 已登记)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase B: 动作一等按钮

> 既有验收与本 Phase 同向(human B1–B3、s1 UI 走查按 role 找按钮);前置处置
> 项 = `entity-view.test.tsx` 的 guard-results 用例随呈现升级扩展。

- [x] Task: 一等动作渲染器统一(D47 第 1 问)
  - 实体页/Canvas/组合区域复用同一 contract-driven 动作组;宿主显式注入
    scope-aware fresh-read → exec adapter,删除 `live`/函数身份隐式分流;SDK gate
    继续治理 A2UI dispatch,服务端仍作最终 declaration → guard → schema 裁决
  - Red→Green:渲染器组件测试(三形态/确认门/live 复核);"每声明 action 有
    控件"的合同驱动断言(以不同 class 实体 fixture 证明零特判)
- [x] Task: 同合同图例 + guard 原因可见
  - 每个动作组显示“你和助手使用同一合同,由同一规则裁决”;不得声称 actor
    权限相同。guard 阻断原因从合同 guard-results 渲染为控件下 status 文本
  - Red→Green:标注呈现断言;guard-results 各形态(blocked/unblocked/
    actor-is-human 解除)可见性测试;i3 注记齐全
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: chat 引用可点(可独立提前,若 T27 未闭环可先落地本 Phase)

> 协议零改动:citations(FactRef)已端到端落库,本 Phase 纯 UI 消费。

- [x] Task: 终局 citation chips 与画布聚焦(D47 第 2 问)
  - 只在 assistant 终局消息尾部渲染去重 FactRef chips;live final sources 与按
    turnId 恢复的 history citations 双链路接通。点击只保留 scope/thread 并聚焦
    Canvas;URL focus 驱动 chip current 与 Surface active,不新增选择态
  - Red→Green:引用 guard/dedupe/navigation/history/live 组件与 route 测试;
    文本诱饵不生成 citation;e2e 点击后 focus/scope/thread 与 active 同源
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: raw 模式

- [x] Task: 共享 raw 合同抽屉(D47 第 3 问)
  - EntityView 与 Canvas exact focus 复用共享 RawContractDrawer/Content;只序列化
    当前 scope 授权的未组装 Siren Entity。citation 聚焦后第二步可开;workspace
    虚主体不伪造 raw;不包含事件、provenance、hydrated facts 或 Surface
  - Red→Green:两步可达 e2e(任意实体 → 原始合同 JSON);raw 视图无 LLM
    调用断言;新控件 i3 注记齐全
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase E: 呈现按 intent 裁剪 + 诊断归位

> 前置处置:generic planner/compiler 断言"全属性绑定"的旧 fixture 先迁移
> (GR2 一次性,处置记录进任务 notes)——先于裁剪落地。

- [x] Task: exact intent policy 进入 generic 路径(D47 第 4 问)
  - required intent 经 planRegion/broker/Canvas fallback 传入;纯 selector 只接收
    path/field role,按版本化 exact intent budget 裁剪,unknown 使用 read fallback;
    actions/links/members 保留,policy version 进入 Sidecar dependency
  - Red→Green:纯 selector 确定性/子集/budget 测试;compile binding-only property;
    同 source 不同 region intent 产出不同 path 子集且不读取 entity class
- [x] Task: 诊断归位(D47 第 5 问)
  - 首屏只显示固定人话在位提示;code/node/message 的去重结构化 issues 只在 why
    抽屉。region-unavailable 只披露 region/availability/fixed code,继续不静默
  - Red→Green:首屏零诊断细节断言;抽屉内诊断可达断言;region-unavailable
    降级 e2e 不回归(T30 口径)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase F: 端到端验收与收尾

- [ ] Task: 全量验收
  - `pnpm check` 全绿(含全量 vitest——I2 靠 property test,e2e 不构成
    binding-only 证据);`CI=true pnpm e2e invariants` 全绿;`CI=true pnpm e2e`
    全量全绿;T16 presentation/T24 honesty/chat 套件全绿
  - 最终系统验收不使用本地 dev server:从 accepted source 构建 web/worker/runner
    镜像,部署 mothership,在现场验证 ready/version、动作/引用/raw/intent/diagnostic、
    I3 与只读 replay;现场证据写入 Track 后方可关闭
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
6. `pnpm check` + `CI=true pnpm e2e invariants` + e2e 全量全绿;accepted source
   镜像部署 mothership 后通过现场系统验收。
