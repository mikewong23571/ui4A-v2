# Track: T22 生产形态部署、身份认证与双后端 Agent Runtime

把 UI4A 从 self-reported local demo 升级为可在 mothership K8s/Istio 与 Docker Compose
all-in-one 中重复部署、认证、恢复和验证的首个试验性版本。Keycloak 提供可信身份，Agent Runtime
同时支持隔离 K8s Pod 与受信宿主机 Runner；服务端 Runtime Profile 保持最终选择权。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [User Stories](./user-stories.md)
- [Technical Stories](./technical-stories.md)
- [Acceptance Evidence Contract](./evidence.md)
- [Acceptance Evidence Schema](./acceptance-evidence.schema.json)
- [Red Acceptance Baseline](./acceptance-baseline.json)
- [Implementation Plan](./plan.md)

当前状态：`in_progress`。目标发布为 `v0.1.0-experimental.1`，不宣称 GA、正式 SLA 或当前两 Worker
实验集群具备未经验证的高可用能力。
