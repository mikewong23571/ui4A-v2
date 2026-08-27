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

当前状态：`in_progress`(2026-08-27 收敛复核:Phase A–F/H 全部闭环;B/C/E 的验收
子弹已按常驻合同套件逐项核验勾选,scripts/t22 33 套 308 用例绿 + darwin 非 root
chown 守卫;arm64 temporal 剪枝修复与本地镜像实验栈已提交)。**剩余 14 项全部
依赖实机/外部授权,本地会话不可代行**:Phase G Compose story 验收(U1/U3–U9/
U13/U14/U16 + Golden Story,restart/dual backends/backup-restore smoke——
operator-authorized-live)、Phase I 的 K8s/Host 双后端 Agent Run 与 Golden Story
checkpoint(需 mothership 集群,本会话无 kubectl context)、Phase J 全量质量门
(`pnpm check` 当前受并行 T31 的 db 基线增长在途影响)与终审 DONE 报告。目标发布
为 `v0.1.0-experimental.1`，不宣称 GA、正式 SLA 或当前两 Worker
实验集群具备未经验证的高可用能力。多副本 Web/Session、跨副本 single atom、realm 在线升级、
细粒度角色同步、自动 Secret rotation、`act` 扩展、全面 service-to-service OIDC/全 route
平台化和 HA 明确延后，不阻塞本 Track。
