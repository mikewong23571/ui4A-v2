# Track: T28 一等交互与引用:动作上肩、引用可点、raw 模式

让合同的能力可见、协作的证据链可辨认:实体声明的动作渲染为一等控件
(人/AI 同权可见),chat 引用可点并与画布联动,raw 降格为随处可达的
"查看原始合同"模式,generic surface 按 intent 裁剪。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [Plan](./plan.md)
- [Mothership acceptance evidence](./evidence-mothership-20260826.md)

当前状态:`completed`（D47 五问、实现、accepted source `2d8d6c8` 与 mothership Helm
revision 49 现场验收）。方向依据:
`conductor/product-vision.md` §一(AI as assistant)、§二(指代可解/canvas
共同注视)、§三(raw 是镜头不是站点)、§五、§六(特判滑梯)。依赖
T27(站点框架,动工前按 spec"T27 闭环后复核点"清单核对)、T24(抽屉口径)
与 T30(组合机器,均已闭环);chat 引用可点部分可独立提前。

2026-08-26 细化(提前于 T27 闭环):spec 补齐方向依据、核心目标一句话与判定
三要点(同一裁决不是新通道/结构化事实不是文本解析/raw 是镜头不是站点)、
依赖锚点与现状事实(动作控件三提交路径并存与缺口、citations 已落库但 UI 零
消费、raw 视图唯一入口在 why 抽屉、字段 role 链已可消费但 generic 无 intent
参数、诊断节点现状)、Phase A spike 五问(动作控件统一形态/引用呈现/raw
形态/intent 裁剪规则/诊断归位,含与 D45 降级口径的张力)、GR3 基线与 I2
静默缺口警戒;新增 plan.md(Phase A spike → B 动作一等按钮 → C 引用可点
→ D raw 模式 → E intent 裁剪+诊断归位 → F 验收收尾)。**锚点纪律:全部
使用路径+符号/测试名,不写行号**(T27 施工将移动 canvas 宿主、components
目录与 e2e 选择器);spec 内置"T27 闭环后复核点"清单。实施会话从 spec.md
起步即可,无需此前聊天上下文。
