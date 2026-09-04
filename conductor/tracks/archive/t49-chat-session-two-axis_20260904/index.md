# T49 聊天会话双轴 — Track Index

> Track ID: `t49-chat-session-two-axis_20260904` · Type: Bug(含架构决策 D68)· 状态: new

修复生产模式下聊天会话模型折叠(sessionId 被强制替换为认证 principal,每用户永远只有一个会话;「新会话」只清 UI 不清 agent 上下文)。解耦两轴并以 U1–U10 用户故事作为验收闭环。

- [Spec](./spec.md) — 根因链、D68 决策、FR1–FR6、验收标准、Out of Scope
- [User Stories](./user-stories.md) — U1–U10 产品验收入口(含锚点类型)
- [Plan](./plan.md) — Phase 0–6(TDD)、故事→阶段映射、治理红线事实
- [Metadata](./metadata.json)
