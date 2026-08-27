# Track: T33 读面姿态与责任点:读多写少落地(表单退位、决策卡一击、任务语言)

把 2026-08-27 走查确认的"读多写少被违背"矫正成交付:阅读面上写退位为收起的
一行动作(复杂写的正典留在 chat 原话授权),责任点(批准/拒绝)升为成员
决策卡一击可达,区块与字段用任务语言呈现。ASCII 用户故事五画面(回家/
责任点/chat 写/投影更新/共同注视)嵌入 spec 作为验收方向锚;D47.4 细化为
D50(姿态而非移除);决策卡/进度轨/一句话全部由合同数据驱动,零特判。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [Plan](./plan.md)

当前状态:`completed`(2026-08-27 按 workflow 闭环:Phase A–F 全部执行,
D50 落 DECISIONS;本地门禁全绿——pnpm check、CI=true pnpm e2e invariants、
全量 e2e 52 passed/0 failed、截图走查对照 ASCII 画面要素清单通过)。性质:
feature(交互层,只消费不新建架构)。**显式遗留**:mothership 现场验收
(内网不可达,plan Phase F 记录处置;具备条件时从 Git SHA 构建 images 按
T22 runbook 补验)。施工中修复三个潜伏缺陷:surface 适配器 actor-is-human
豁免缺失、inbox 成员缺 canonical rel、双 local principal 分裂(user:local vs
local-user)。方向锚与验收口径见 spec"理想态用户故事"与"验收方向"节。
