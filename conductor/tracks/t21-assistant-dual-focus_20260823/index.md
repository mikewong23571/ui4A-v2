# Track: T21 Assistant 双焦点事实与 AI-first Presentation 一致性

修复参考 Assistant 把本轮合同读取位置误当成客户端当前页面的问题。系统保留
`lastNavigation` 与 `clientView` 两个独立、有 provenance 的事实，同时交给 LLM 理解；机械层
不通过关键词、规则意图分类或固定工具轨迹替代智能决策。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [User Stories](./user-stories.md)
- [Acceptance Evidence Contract](./evidence.md)
- [Red Baseline](./baseline.md)
- [Disposable LLM Protocol Probe](./llm-probe.md)
- [Disposable Dual-Focus Contract Probe](./contract-probe.md)
- [Technical Stories](./technical-stories.md)
- [Architecture](./architecture.md)
- [Mechanical Safety Report](./safety.md)
- [Acceptance Report](./acceptance-report.md)
- [DONE](./DONE.md)
- [Implementation Plan](./plan.md)

当前状态：`completed`。本 Track 不改变 Business action、guard、schema 或文章数据，不引入第二权威
状态存储，也不让客户端观察扩大 principal 的读取或 effect authorization。
