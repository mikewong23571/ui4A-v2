# T43 Application Capability 边界

- [规格](./spec.md)
- [用户故事](./user-stories.md)
- [计划](./plan.md)
- [探针](./spike.md)
- [架构](./architecture.md)
- [验收证据](./evidence.md)
- [元数据](./metadata.json)

首个垂直切片以 `cve.enrich` 证明 Capability 是 Application 面向外部执行环境的
Port；Native Function 只是部署侧 Adapter，结果必须经验证和 callback Action 才能成为业务事实。

用户授权编排 agent 按 workflow 自治实施、验收和闭环；仅在外部凭证、不可逆风险或产品范围发生
实质变化时请求用户介入。
