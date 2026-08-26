# T28 一等交互与引用 — Specification

## 类型

Feature(交互层;依赖 T27 的站点框架,引用可点可独立提前)

## 背景与动机

生产走查(2026-08-25):实体渲染只有数据没有动作——post-status flow 声明的
unpublish/archive 就在实体上,界面却无一可操作控件;"你看到的每样东西,你和
AI 都能按合同操作"这一核心承诺在界面上不存在。chat 回答中的实体名不是链接,
"已请求在画布中展示"与画布真实变化的因果不可见——协作发生了,但不可辨认,
读起来像普通 chatbot。generic surface 把 13 个属性路径全量绑成 prose,呈现
无 intent 裁剪。方向依据:product-vision.md §一/§二/§五/§六。

## 站点归属

workstation 站为主(raw 模式全域可达);meta 站的动作控件沿用其治理视图
既有口径,不在本 Track 重做。

## 最终形态

1. **动作一等按钮。** 实体合同声明的 actions 由通用 action 渲染器生成一等
   控件(沿用 action gate 裁决,确认门/表单/schema 现状语义不变),并可见
   标注"人/AI 同权"——同一 exec、同一裁决,一眼可读。guard 阻断的动作用
   合同 guard-results 呈现原因,不藏。
2. **chat 引用可点。** assistant 消息中的实体引用(rel/citation)渲染为链接,
   点击 = 呈现该实体(canvas 焦点或 workthread 内嵌);引用 → 事实 → 画面
   的因果链可见(如引用高亮与画布定位联动)。
3. **raw 模式。** "查看原始合同"从实体/引用/抽屉随处可达:未组装的 Siren
   JSON、事件切片、provenance——验钞灯,不是站点(顶级入口已在 T27 摘除)。
4. **呈现按 intent 裁剪。** generic surface 规划按呈现 intent 选择字段
   (identity/metadata/primary-content 角色优先),不再全属性绑定;诊断节点
   (deref-failed 等)只在抽屉暴露。

## Scope 边界(非目标)

- 不重做 meta 治理视图的动作控件;
- 不改 action gate/裁决/确认门语义;
- 不做新的 render words(词汇表扩充是独立候选);
- 不做 presentation 的 LLM 生成路径调整(Recipe/Sidecar 机制不动)。

## 施工纪律红线

- 动作渲染器零每实体类型特判:全部从合同 actions/guard-results 通用生成;
- 引用解析从 chat 协议的结构化 citation/messageId 提取,不解析自然语言;
- raw 模式展示原始合同数据,零组装、零 AI(审计通道铁律)。

## 验收方向

- 动作渲染:每个声明 action 有控件,提交过同一裁决(复用 I3 不变量 fuzz);
- 引用 e2e:chat 回答引用可点,点击后画布聚焦同一实体;
- raw 模式:任何实体两步内可见原始合同 JSON;
- 呈现裁剪:generic surface 绑定字段数显著下降且无信息回归(走查+快照);
- invariants 与 Golden Story 全绿。

## 验收目标纠偏与误导性验收排查(2026-08-26,行号以当时基线为准)

**既有验收测试与本 Track 目标相悖时,干掉验收目标——修正/迁移/删除测试,
绝不反向修改 track 目标去保绿。**

排查结论:本 Track 与既有验收基本同向,无反向施压项——动作作为一等按钮
已被 `e2e/human.spec.ts:118-129/:154-166`、`e2e/s1.spec.ts:402-414` 断言
(下线/通过/批准按 role 找按钮),chat 活动条目链接化已被
`e2e/t24-presentation-honesty.spec.ts:194-197` 断言。两处留意:

- raw 抽屉入口须遵守 i3 fuzz 注记规则(data-action/data-nav,参照既有
  `[data-nav="local:canvas-why"]` 模式),否则 i3 红——这是常驻约束,
  不是误导;
- 呈现按 intent 裁剪落地后,断言"全属性绑定"的旧快照若有残留一律删除
  (GR2),不得保留双口径。
