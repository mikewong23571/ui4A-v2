# T22 DONE — 生产形态部署、身份认证与双后端 Agent Runtime

T22 于 2026-08-27 闭环。`v0.1.0-experimental.1` 已发布(Git tag 指向 release commit
`d5557bf`,Web/Worker/Runner 镜像 digest 固定):mothership K8s/Istio 与 Docker Compose
all-in-one 消费同一配置合同与用户故事 corpus;真实身份认证(浏览器 Authorization Code +
PKCE、CLI 外部 Bearer、Agent Client Credentials + RFC 8693 Token Exchange)以已验证
`sub + azp` 构成 canonical delegation;显式版本化迁移、单 Web 副本并发/重启/重放完整性、
健康语义、19 节 step-by-step runbook 与命名备份/隔离恢复全部交付。该版本是 internal
experiment:非 GA、非 SLA、非 LTS、非生产就绪;验收边界以
`release/v0.1.0-experimental.1/` bundle 为准。

## Delivered

- 统一生产配置合同(schema 校验、Secret/普通配置分离、production fail-closed,禁 demo
  隐式回退)与 Web/Worker/Runner 多阶段生产镜像(非 root、SBOM、smoke、scan)。
- Keycloak 单 realm 三 clients、import-or-check-and-skip、固定 realm 文件;浏览器/CLI/Agent
  三条身份链与 human-only approval;请求 body/query/普通 header 不可覆盖凭证身份。
- 显式迁移(advisory lock、migration role、失败阻止 readiness)、启动顺序合同与既有事件
  日志升级路径;事件日志保持唯一业务真相。
- 单 Web 副本 CAS/串行/重放完整性;`/live`、`/ready` 与依赖状态分离;Temporal 生产适配
  (namespace `ui4a`、graceful drain、独立 test queue)。
- 双后端 Agent Runtime 统一 SPI:`apps/agent-runner` 同时支撑 K8s 按 Run one-shot Job
  (D36)与受信宿主机 Runner;请求侧不可选择 backend/image/cwd/provider/model/env。
- Docker Compose all-in-one(命名 volume、健康检查、internal TLS 实验根 CA 持久化、
  确认式清理)与 Helm chart + mothership overlay(单副本、static PV、Istio 策略)。
- `scripts/t22` 部署合同套件与 operator 命令(`migrate:production`、`compose:t22`、
  backup/restore/recovery/drill),以及 `docs/t22-production-runbook.md`。

## Acceptance(现场与在案证据)

- 认证主路径与 auth negatives 100% 正确拒绝并留痕(Phase I `4fd3417`;K8s 登录/Flow/
  exchange 新证据见 `evidence-k8s-auth-fix-20260825.md`;浏览器路径可用性修复 D38)。
- 单 Web 副本并发/重启/重放(`d49ad70`)与十工件命名备份→隔离恢复 drill(`e71b59f`,
  RPO 0、实测 RTO)在 mothership 现场验证。
- T26 Work Thread 生产部署与 CLI credential scope hotfix 闭环(revision 40→42,修复提交
  `91e1a6e`/`8d3b289`/`41a228d`),见 `evidence-t26-cli-scope-hotfix-20260826.md`。
- 发布物齐备:release manifest、SHA256SUMS、SBOM、vulnerability summary、acceptance
  report、runbook inventory(`release/v0.1.0-experimental.1/`)。

## 诚实边界(known-risk,不提升为 passed)

- Runtime matrix 定格 `failed-honest`(D37):最终 Compose U7 与 K8s Run
  `a1o-20407625d83e` 均 `execute-failed`、零 fallback;U8 与 accept 未执行。
- 镜像扫描 50 Critical / 241 High matches,按 `known-risk` 仅接受用于 internal experiment。
- rollback 仅为文档化 revision-19 计划未实测;真实多依赖 fault injection 未执行;
  Kubernetes NetworkPolicy 未实施;Helm backup CronJob suspended 非权威。

## 过期验证裁定(D52,2026-08-27 用户指令)

以下剩余项不再补跑,依据见 `DECISIONS.md` D52:重跑验证的将是 T24–T34 后续演进而非
发布物 `d5557bf`;现场证据已由 D37 定格;质量门已常驻化(T33 2026-08-27 全量 e2e
52 passed;T34 `pnpm check` 终绿 + rev52 生产走查):

1. Phase G Compose story corpus(U1/U3–U9/U13/U14/U16 + Compose Golden Story)与
   restart/dual backends smoke 复跑;
2. Phase I K8s/Host 两后端完成 Agent Run;
3. Phase J T22 专项全量质量门与"最小三次 Runtime Run"。

`Critical/High=0` 按"无未登记的身份/数据一致性/恢复问题"口径以在案证据复核通过;
已知风险即上文诚实边界清单。

## 收口验证(2026-08-27 现场)

- typecheck:`@ui4a/shared`、`engine`、`agent`、`agent-runner`、`cli`、`web`、`worker`
  全部 `tsc --noEmit` 绿。
- lint:`eslint .` 0 errors(12 条既有 warning)。
- governance:`pnpm governance` OK(GR1 两条登记例外在案;GR2 baseline pending removal 0;
  GR3 baseline remaining 9 条,全部为已登记 shrink-only 债务)。
- vitest:全量 **3062 passed / 10 skipped**(skips 均为环境性:Temporal dev server 不可达、
  真实 Provider 门控);其中 `scripts/t22` 34 套 311 用例绿(归档后路径引用同步已验)。

## 治理清偿(GR5/D52)

- `scripts/t22` 整目录晋升为常驻部署合同套件;路径与命名保留以维持 runbook 与
  `package.json` 引用,"t22"自此只是目录名。
- GR3 三条 T22 存量(目录 14,425 行 + 两个 >800 行合同测试)转常驻登记债务,
  shrink-only;`apps/web/src/app/api/chat/route.ts` 收缩窗口与 T22 脱钩。
- `governance:strict` 并入 `pnpm check` 的条件修正为"整个 size-baseline 清空时",
  不再绑定单一 track 关闭。

## Explicit boundary

多副本 Web/Session、跨副本 single atom、realm 在线升级/漂移修复、细粒度角色同步、自动
Secret rotation、`act` 扩展、全面 service-to-service OIDC/全 route 认证平台化与 HA 均
延后至后续 Track;Runtime 成功证据属后续工作。本 DONE 不构成 GA、SLA、LTS 或生产就绪
声明,不改变 `v0.1.0-experimental.1` 的 known-risk 边界。
