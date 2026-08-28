# Track: T22 生产形态部署、身份认证与双后端 Agent Runtime

把 UI4A 从 self-reported local demo 升级为可在 mothership K8s/Istio 与 Docker Compose
all-in-one 中重复部署、认证、恢复和验证的首个试验性版本。Keycloak 提供可信身份，Agent Runtime
同时支持隔离 K8s Pod 与受信宿主机 Runner；服务端 Runtime Profile 保持最终选择权。

`v0.1.0-experimental.1` 主路径按 D35 收敛：Compose/K8s 全组件单副本；一个 Keycloak
instance/realm，仅 `ui4a-web`、`ui4a-agent`、`ui4a-api` 三个 client；浏览器 Authorization Code +
PKCE、CLI 外部 Bearer、Agent Client Credentials/Token Exchange，以 `sub + azp` 作为唯一
canonical delegation。两种部署共用固定 realm 文件，首次导入，已存在则兼容性检查后跳过，不做
在线漂移修复。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [User Stories](./user-stories.md)
- [Technical Stories](./technical-stories.md)
- [Acceptance Evidence Contract](./evidence.md)
- [Acceptance Evidence Schema](./acceptance-evidence.schema.json)
- [Red Acceptance Baseline](./acceptance-baseline.json)
- [Mothership Platform Probe](./platform-probe.md)
- [Mothership Platform Facts](./platform-probe.json)
- [Disposable Keycloak Probe](./auth-probe.md)
- [Disposable Keycloak Facts](./auth-probe.json)
- [Disposable Runtime Backend Probe](./runtime-probe.md)
- [Disposable Runtime Backend Facts](./runtime-probe.json)
- [PostgreSQL and Temporal Topology Probe](./topology-probe.md)
- [PostgreSQL and Temporal Topology Facts](./topology-probe.json)
- [Architecture](./architecture.md)
- [Experimental Authentication Surface](./auth-surface.md)
- [T26 Work Thread Production and CLI Hotfix Evidence](./evidence-t26-cli-scope-hotfix-20260826.md)
- [Implementation Plan](./plan.md)
- [DONE](./DONE.md)

当前状态：`completed`(2026-08-27 收口闭环:Phase A–J 全部处置完毕;`v0.1.0-experimental.1`
已发布,tag 指向 `d5557bf`,现场已验认证、单 Web 并发/重启/重放与十工件隔离恢复;Runtime
matrix 按 D37 定格 `failed-honest`,镜像 known-risk 50C/241H,rollback/fault injection 未实测
如实登记)。剩余实机验收项按用户 2026-08-27 指令与 **D52** 裁定过期、不再补跑:Phase G
Compose story corpus 复跑、Phase I K8s/Host 双后端 Agent Run、Phase J T22 专项全量门——
依据是重跑验证的将是 T24–T34 后续演进而非发布物,质量门已常驻化(T33 全量 e2e 52 passed、
T34 `pnpm check` 终绿 + rev52 生产走查)。收口现场另跑 `pnpm check` 复核当前树(结果见
[DONE.md](./DONE.md))。`scripts/t22` 按 GR5/D52 晋升为常驻部署合同套件(路径与命名保留,
runbook/package.json 引用不变);多副本 Web/Session、跨副本 single atom、realm 在线升级、
细粒度角色同步、自动 Secret rotation、`act` 扩展、全面 service-to-service OIDC/全 route
平台化和 HA 保持延后。本 track 与发布仍不构成 GA、正式 SLA、LTS 或生产就绪。
