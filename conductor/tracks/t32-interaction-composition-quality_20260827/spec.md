# T32 交互与组合质量修复 — Specification

## 类型

Fix(T28/T30 实现质量评审发现项的登记与修复;无新功能、无架构变更)

> **锚点约定:** 全部代码锚点使用"路径 + 符号/测试名",不写行号(T31 在途
> 施工,行号必然漂移)。实施前以仓库现状复核。

## 背景与动机

2026-08-27 对 T28(一等交互与引用)与 T30(呈现平面组合化)两个已归档
track 做了实现质量评审(2 个并行 subagent,对照各自 spec/plan/D45/D47/D48,
重跑 focused 测试约 80 用例全绿)。结论:**两个 track 的验收声明成立,红线
无实质违反**(D47 四形态与 D45 五问在代码层均真实落地;零特判、零 GR2 双轨、
虚主体未成为业务实体)。但累计发现 2 个 medium 测试缺口、6 个 low 行为/
一致性项、3 个卫生项、1 个裁决项与 2 个归后续项,共 14 项(Q1–Q14)。

同时确认一个**归属缺口**:T31 登记册中 R23/R25 归 T28 领土、计划 Phase E
落注 T28 spec/plan,但 T28 已归档(GR5 只读)且 T31 Phase E 未执行——这两项
现无 owner,由本 Track 接管修复。T30 领土的 R11/R12/R13/R20 经代码复核
确认仍未修复,但它们仍在 T31 修复范围(R1–R22)内,**归 T31,本 Track 不
重复修**,只在冲突面上协调。

## 核心目标(一句话与判定要点)

**登记册 14 项全部进入终态:medium 测试缺口补齐且被证明能红,裁决项落
DECISIONS(D49),low 逐项修复,归后续项在目标文档落注;T31 的 R23/R25
归属缺口由本 Track 承接闭合。** 判定偏离要点:本 Track 只修不建——若发现
自己在加新能力/新机制,即越界;修复不得引入新旧双路径(GR2),不得为保绿
削弱断言。

## 站点归属

跨站卫生层;主要触及 apps/web(actions/chat assistant-ui/render/engine
presentation 接线)与少量 packages/engine。CLI 零改动。

## 发现项登记册(2026-08-27 评审,全等级全量)

### Medium(测试缺口,行为破坏时无测试会变红)

- **Q1**(←T28)e2e raw 断言弱于验收口径:`e2e/interaction/chat-citations.spec.ts`
  对 raw 抽屉只断言 `toContainText('"rel": …')`,未断言"不含事件/
  provenance/hydrated facts"或与新鲜授权响应深等;单测已锁定 exact 序列化
  (`raw-contract-drawer.test.tsx` 的 fetch spy),但"授权链路后仍 exact"
  的端到端性质只存在于一次性 mothership 现场证据。若后续在 entity 传入前
  拼装(如混入 explain),e2e 照绿。
- **Q2**(←T30)I2 property 套件不覆盖组合树:`apps/web/src/render/property.test.ts`
  的实体生成器只产单实体,**不生成多区域组合树**——组合面的 binding-only
  常驻覆盖仅剩一条一次性 e2e(T30 spec 自警的"门禁照绿 ≠ 目标达成"同类
  形态)。处置:property 套件加声明驱动的组合 fixture 或多区域生成器。

### 裁决项(需 D49 判断;T31 归属缺口承接)

- **Q3**(←T31 R23)审计下钻主路径仍是裸 JSON API:
  `apps/web/src/components/assistant-ui/thread.tsx` 的 `stepAuditHref` 返回
  `/api/events?afterSeq=N`,活动条目点击落在未组装 JSON。D47 第 3 问明文
  "事件切片属于审计链接",审计通道用 JSON 是否算 D47 既定豁免需要裁决。
  **需 D49 裁决(豁免记录 vs 改为 raw 抽屉镜头)。**

### Low(行为/一致性修复)

- **Q4**(←T31 R25a)thread 徽章文本启发式仍在:`thread.tsx` 的 `AssistantText`
  以 `rel.includes('flow') || text.includes('执行 next(')` 判定徽章显隐(T9
  遗留)——对 assistant 正文做自然语言匹配,违反"零自然语言启发式"口径,
  无测试锁定。修复:改结构化 rel 判定,零文本匹配。
- **Q5**(←T31 R25b)canvas-errors 机制标识泄漏残留:
  `apps/web/src/components/canvas/presentation-surface-host.tsx` load 失败
  路径把 `${spec.concern}:${error.message}`(含 sidecar id/HTTP 状态)与
  catch 兜底裸 `error.message` 推入主区域 `data-testid="canvas-errors"`;
  机制标识可上首屏,异常分支无测试。修复:fail 分支映射固定人话 + 机制细节
  进 why 抽屉,补异常分支测试。
- **Q6**(←T30)单/组合依赖双装配形状:`apps/web/src/engine/presentation/
  runtime.ts` 的 `currentDependencies()` 手写拼装单主体依赖,组合路径由
  `compose.ts` canonical 产出;两套 id 方案(`entity:<rel>` vs
  `composition:<id>@<v>:<region>:entity-contract`)并存,`dependencyDecision`
  两侧比对,将来只改一侧会静默失配。**需 D49 裁决(统一经 compose 内核
  产出 vs 注释锚定对应关系)。**
- **Q7**(←T30)`runtime-composition.ts` 的 `planRegion` 用
  `membershipFingerprint(region.entity)!` 非空断言——collection 类实体缺
  `entities` 数组时把显式拒绝藏成运行期 `!`。修复:显式守卫,错误信息点名
  区域与原因。

### Low(卫生)

- **Q8**(←T28)`hrefToRel` 双份实现:`components/entity-view.tsx` 与
  `render/words/detail.tsx` 各一份相同实现(注释自称同口径),手工同步的
  重复契约解析。处置:提取共享模块。
- **Q9**(←T28)`entity-view.tsx` 头注释滞后:仍写"guard reason → disabled +
  title 原因",而现状已是控件下 `role="status"` 可见文本。处置:更新注释。
- **Q10**(←T30)过期里程碑注释:`apps/web/src/engine/presentation/broker.ts`
  的 `createWebPresentationBroker` JSDoc 仍写"Phase B deliberately has no
  Presentation planner or durable Sidecar store yet"(T16 期状态);
  `runtime.ts` 的 `persistSurface` 上方同类。处置:改写为现状。

### 归后续(登记在册,不在本 Track 修复)

- **Q11**(←T28)meta 渲染器平行 RawContract 实现:
  `components/meta/renderers/common.tsx` 的 `RawContract` 与
  `canvas/raw-contract-drawer.tsx` 的 `RawContractContent` 职责重叠 → 归
  下一次触碰 meta 渲染器的 track(落注其 spec/plan 一行)。
- **Q12**(←T28,前既有)`entity-view.tsx` 的 `FIELD_DISPLAY_LABELS`/
  `PROPERTY_DISPLAY_LABELS` 把发布域业务词表硬编码进通用渲染器(T14 遗留,
  T28 红线只约束动作/引用渲染器,不算违约)→ 归词汇人话化机制候选 track
  (登记,不指定既有 track)。
- **Q13**(←T30)`runtime.ts` 的 `resolve` 命中路径 partial 判定用
  `situation.regions?.some(...)`,plan 路径用 `composition?.partial`,口径
  分散但当前一致 → 并入 T31 R12(`regionSlot()` kind 推导)修复时顺手收敛,
  落注 T31 plan Phase C 任务一行。
- **Q14**(流程,登记)T31 Phase E 对 R23/R25 的"落注 T28 spec/plan"因 T28
  归档不可执行:本 Track Q3/Q4/Q5 即其实质承接;T31 收尾时应按本登记册
  核销 R23/R25 的处置指向,不再落注已归档文档。

## 与 T31 的边界与冲突面

- T30 领土的 R11/R12/R13/R20 仍归 T31(其 R1–R22 修复范围),本 Track
  **不修、不重复登记修复**;Q13 只落注 T31 plan 一行;
- 文件冲突面:Q6/Q7 触 `runtime.ts`/`runtime-composition.ts`,与 T31 R12
  (同文件)重叠——**本 Track 相关任务在 T31 闭环后执行**,或并行时逐任务
  与 T31 Phase C 进度核对;Q3/Q4/Q5 触 `thread.tsx`/`presentation-surface-host.tsx`,
  与 T31 冲突面无重叠(T31 避开了这些文件);
- Q3 的 D49 裁决须显式核对 D47 第 3 问与 T31 spec R23 的原文,不得复辟
  已否决候选(独立 raw 站点/事件切片混入 raw 抽屉均已在 D47 否决)。

## 修复范围与施工纪律

- 范围:Q1–Q10(Q11–Q14 只登记并落注);
- 测试缺口类(Q1/Q2)的验收口径:新测试必须经 mutation 抽查证明"破坏被测
  行为 → 测试变红",不允许纸面补测;
- GR3:Q6/Q7 触及 shrink-only 基线目录关联文件(`apps/web/src/engine/
  presentation`,目录在基线外有余量;`packages/engine/src/presentation` 为
  shrink-only),若需改 engine 侧必须净不增长;例外登记由编排 agent 统一
  执行;
- 注释/卫生修复(Q8/Q9/Q10)与代码行为修复同标准:改完复述现状;
- Q4 修复必须删除全部文本匹配分支(GR2 单实现),不留"新旧判定并存"。

## 验收方向

- 登记册 14 项全部终态(修复 / D49 有意偏离 / 归后续落注);
- Q1/Q2:新测试 mutation 抽查能红;组合面进入 binding-only 常驻覆盖;
- Q4:全仓 grep 无 `执行 next(` 等文本启发式残留;徽章显隐由结构化 rel 驱动
  且有测试锁定;
- Q5:canvas-errors 主区域零机制标识(sidecar id/URL/HTTP 状态),异常分支
  有测试;
- 不回归:`pnpm check` 全绿、`CI=true pnpm e2e invariants` 全绿、T16/T28/
  T30 相关套件全绿、governance 零新增基线;`pnpm dev:all` 实际启动走查。
