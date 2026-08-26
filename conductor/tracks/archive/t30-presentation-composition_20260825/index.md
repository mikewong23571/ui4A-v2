# Track: T30 呈现平面组合化:区域 × intent × 聚合虚主体

把 presentation plane 从"一个 subject 一个 surface"升级为"工作区组合":
多区域、多 intent、跨实体聚合虚主体(如 my-work = inbox∪threads∪
delegations)。这是 workstation 内容面不硬编码的真正前提——没有组合维,
T27 的"零硬编码页面"就是无法执行的口号。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [Plan](./plan.md)
- [Acceptance and deployment evidence](./evidence.md)

当前状态:`completed`（mothership Helm revision 43 与安装版 CLI 验收）。方向依据:`conductor/product-vision.md` §三
(workstation 不硬编码)、§六(页面滑梯)、§八(架构判断)。
前置架构 track,执行序在 T26 之后、T27 之前(threads 是 my-work 聚合源
之一,动工前 T26 应已闭环;机制层面对 T26 零代码特判)。

2026-08-26 细化:spec 补齐方向依据、依赖事实(T16/T26 D44/T29/T25 D41/T24)
与现状代码锚点(RenderSubject/SurfaceTree 单 root 假设位置/sidecar key 与
事件域/recipe 单 slot 三处硬编码/fastpath 阶梯/双目录词表/canvas 挂载/GR3
基线/I2·I5·I7 口径),新增 Phase 0 spike 五问(虚主体 wire 表示、声明数据
归属、区域树表达与退化形态、slot/promotion 一般化、授权与降级形状)的候选
分析(产出 D45);新增 plan.md(Phase A spike → B 声明模型 → C 组合规划内核
→ D sidecar/recipe 组合化 → E web/canvas 与误导验收迁移 → F 验收收尾)。
误导性验收排查复核扩充至十条(行号以当时基线为准)。同日补充:核心目标
一句话与判定偏离三要点(机器不是页面/同一台机器/组合不产生真相)、验收
防偏离四层防线与静默缺口警戒(门禁照绿≠目标达成,I2 e2e 段 test.skip
为例)。实施会话无需此前聊天上下文,从 spec.md 起步即可。
