# Track: T19 Specialized Agent Contracts

将基础 Agent Runtime、版本化 Agent Definition 和单次 Agent Run 分层；通过 Prompt Template、
Task/Result Contract、Runtime Requirements、Tool/Context/Artifact/Evaluation Policy 派生 Coding、
Writing 等特化 Agent。Agent 可以起草新的 Agent Definition，但不能批准或激活自身。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [User Stories](./user-stories.md)
- [Technical Stories](./technical-stories.md)
- [Architecture](./architecture.md)
- [Implementation Plan](./plan.md)
- [Acceptance Evidence Contract](./evidence.md)
- [Story Corpus](./story-corpus.md)
- [Phase A Spikes](./spikes/)
- [Principal Review](./review.md)
- [DONE Report](./DONE.md)

当前状态：`completed`。T18 保持为 Coding Agent specialization v1 的已验证基础；T19 不删除代码特化
契约，而是把它们纳入可定义、可版本化、可 Draft、可验收的通用 Agent Host。
