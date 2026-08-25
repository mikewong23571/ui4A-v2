# Track: T18 Coding Capability Executor Host

将通用 Coding Agent 作为 `coding.execute` capability 的可插拔执行器接入 Application Flow；
UI4A 统一治理 workspace、运行状态、预算、原始轨迹、结果 artifact 与 human acceptance。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [User Stories](./user-stories.md)
- [Technical Stories](./technical-stories.md)
- [Architecture](./architecture.md)
- [Implementation Plan](./plan.md)
- [Acceptance Evidence](./evidence.md)
- [Real Codex Evaluation Report](./eval-report.json)
- [Phase A Probe Record](./spikes.md)
- [Principal Review](./REVIEW.md)
- [Completion Report](./DONE.md)

当前状态：`completed`。首个纵向切片以 Codex 作为真实 reference executor；Hermes 只提供架构启发，
不进入依赖或运行时。Claude Code/Gemini 由同一 SPI 的 contract fixtures 证明可扩展性。
