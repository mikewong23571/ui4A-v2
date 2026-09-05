# T55 架构治理落地:审查结论 → 决策 → 门禁 → 重构

- [Spec(含验收方案与条件 AC-0–AC-6)](./spec.md)
- [Plan(Phase 0–5,TDD 任务分解)](./plan.md)
- [Metadata](./metadata.json)
- 输入:[arch-review-2026-09-05.md](../../../arch-review-2026-09-05.md)(v2,经独立双重审核)
- 关键裁定依赖:DECISIONS.md D52(chat 收缩窗口/t22 常驻)、D53(反机械切分)、D34/D36(agent-runner);本 track 新增 D75/D76/D77。
- 验收协议:编排 agent 代行(workflow.md),每 AC 关闭留 commit + 验证命令 + 输出摘要三元证据。
