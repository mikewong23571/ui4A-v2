# T35 持续试用与走查修复 — Track Index

- [Specification](./spec.md) — 方向依据(北极星)、目标、验收协议、Scope 边界
- [Plan](./plan.md) — Phase A–F 任务分解;每 Phase 以视觉验收 Checkpoint 收口
- [User Stories](./user-stories.md) — S1–S8 文档化视觉验收锚(验收只认走查证据)
- [Findings](./findings.md) — 问题实情台账(唯一事实来源,F-XX 持续追加)
- [Design Notes](./design-notes.md) — 设计审查记录(工作线承载业务目标的四层判断)
- [Metadata](./metadata.json)
- Evidence: `evidence/2026-08-27-initial-walkthrough/`(R1 全站走查 29 张)

## 试用期约定

1. 本轨道长期 `[~]`:试用 → 登记 findings → 修复 → 按 user-stories 视觉验收;
2. 验收不使用死代码断言;代码测试仅为语义回归护栏;
3. 北极星(`conductor/product-vision.md`)是设计分歧的裁判文书;四滑梯(页面/
   特判/文案/规则)为每轮固定评审项;
4. 治理:业务优先,超限登记例外;`pnpm check` 全绿是每阶段底线。
