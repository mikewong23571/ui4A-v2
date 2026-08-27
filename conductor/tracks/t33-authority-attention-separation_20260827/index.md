# Track: T33 授权与注意力范畴分离:凭证集合裁决 + presence 单点镜头,破坏性剥离单值 policyScope

2026-08-26/27 生产事故链(chat present 跨应用 authorization-failed →
毒 sidecar 持久键 → canvas 404)的终态改造:根因是
`identity.policyScope` 单值字段同时承担"授权裁决输入"与"认知镜头"
两个互斥范畴。本 track 按 product-vision §七 自诊断("scope 作为授权
边界做了,作为认知边界没做")执行范畴归位:授权溶解为数据受众谓词 +
两处咽喉守卫(全自动、类型隔离),注意力收敛到 situation 单点装配
(显式 > presence > 未定位);随后删除全部单值 scope 机器。
决策依据:DECISIONS.md **D51**(Phase 0 登记)。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [Plan](./plan.md)
- [Architecture](./architecture.md)(实现级架构合同:D51 五不变量的执法映射、
  agent navigate 推演、迁移与治理)

当前状态:`planned`(用户已定向:不做临时修复,直接终态,减法优先,
允许破坏性重构;开工指令待下达)。验收以 spec"DONE 定义"为准:
五景 E2E 走查 + D51 五不变量证据 + `pnpm check` 终绿 + 生产真人走查
一次到位。性质:refactor(净行数预期为负,零新机制/端点/schema)。
