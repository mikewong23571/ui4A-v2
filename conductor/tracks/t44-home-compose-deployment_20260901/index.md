# T44 Home Compose 部署

- [规格](./spec.md)
- [计划](./plan.md)
- [验收证据](./evidence.md)
- [DONE](./DONE.md)
- [元数据](./metadata.json)

把 T22 的通用单副本 Compose 合同部署到 `home`：保留 digest、Secret、迁移、身份、回放和
数据保留门禁，同时让公共 HTTPS origin 与容器内部 TLS listener 解耦。

用户要求最终结果为部署成功；编排 agent 按 `conductor/workflow.md` 自治实施和验收，仅在缺少
不可替代的外部凭证或需要删除既有业务数据时请求介入。
