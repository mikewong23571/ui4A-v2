# T22 v0.1.0-experimental.1 部署与运维手册

本手册是 UI4A `v0.1.0-experimental.1` 的实验部署主路径，覆盖 Docker Compose all-in-one、
mothership Kubernetes、Istio、OIDC、两种 Agent Runtime、恢复及升级回滚。它只支持单副本、非 HA
环境；PostgreSQL 是业务真相，Temporal 只保存 durable execution history。

集群、节点、镜像导入、入口 CA 和 storage 的现场事实由以下外部手册负责。本手册只引用它们，
不复制 Secret、证书私钥或宿主机私有路径：

- `../mothership-setup/K8S-ISTIO-DEPLOY.md`
- `../mothership-setup/deploy/ui4a/README.md`

## 不可破坏的边界

- 所有 shell 先执行 `unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy`。
- 镜像必须使用 `repository@sha256:<64 hex>`，UI4A OCI revision 必须等于 release Git SHA。
- 禁止 prune；禁止 `helm upgrade --force`；普通操作不得删除 volume、PVC、PV、Secret 或 archive。
- 所有持久卷使用 `persistentVolumeReclaimPolicy: Retain`。卸载 release 不等于删除数据。
- `docker compose down` 不得带 `--volumes`；清空只能使用带 project 精确确认的独立命令。
- 禁止 online realm reconciliation。固定 realm 只允许首次导入，已存在时兼容检查并跳过。
- 不把 Istio 放行当作应用身份；审批仍由应用验证的人类 credential 决定。
- K8s Runtime 空闲时没有静态 Runner daemon；Host Runner 仅使用 server-owned profile。
- 本版本是内网试验版本，不承诺多副本 Session、HA、自动 Secret rotation 或 realm 在线升级。

## 运行前统一变量

```bash
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy
export UI4A_REPOSITORY=/home/mike/projs/main/ui4A-v2
export MOTHERSHIP_REPOSITORY=/home/mike/projs/main/mothership-setup
export UI4A_NAMESPACE=ui4a-system
export UI4A_RELEASE=ui4a
cd "$UI4A_REPOSITORY"
```

所有 `<...>` 都是必须在执行前解析并检查的 operator 输入，不得复制示例占位符执行。Secret 只从
权限为 `0600` 的常规文件、Compose secret file 或 Kubernetes Secret mount 进入进程；不得出现在命令
输出、evidence 或 shell history。

Compose 的完整环境变量、11 个 Secret files 和 9 个 image refs 以
`deploy/compose/README.md` 为准；不要在本手册重复 Secret 值。

## 1. 目标集群和节点预检

### Step 1.1 — 固定集群事实

```bash
kubectl version
kubectl get nodes -o wide
kubectl get namespace ui4a-system --show-labels
```

- Expected output：Kubernetes v1.31.14；`k8s-cp-1`、`k8s-w-1`、`k8s-w-2` 都是 Ready；已安装环境的
  `ui4a-system` 含 `istio-injection=enabled`。
- Failure criterion：API 不可达、任一节点 NotReady、版本或节点名与 mothership survey 不同。
- Recovery action：停止 UI4A render/apply，先按
  `../mothership-setup/K8S-ISTIO-DEPLOY.md` 恢复既有集群。

### Step 1.2 — Compose 主机预检

```bash
docker version
docker compose version
pnpm compose:t22 preflight
```

- Expected output：Docker/Compose 可用，最后一行 JSON code 为 `COMPOSE_PREFLIGHT_COMPLETED`。
- Failure criterion：canonical settings/Secret file 缺失、文件不是绝对常规文件、镜像未锁 digest 或
  image revision 与 `UI4A_RELEASE_GIT_SHA` 不同。
- Recovery action：只修正输入文件与 image inventory；不得用 inline JSON 或跳过 preflight。

## 2. StorageClass/PV 决策

### Step 2.1 — 只读盘点

```bash
kubectl get storageclass,pv
kubectl -n ui4a-system get pvc -o wide
```

- Expected output：`postgres-data`、`runtime-data`、`backup-data`、`pki-data` 分别 Bound 到审核过的 PV；
  mothership static 模式都固定到 `k8s-w-2`。
- Failure criterion：PVC Pending、capacity/node/local path 与 overlay 不同，或 reclaim policy 不是
  `Retain`。
- Recovery action：不删除 claim；在 apply 前修复 StorageClass/PV 决策。节点磁盘初始化只执行外部
  mothership runbook 的一次性、带确认步骤。

Compose 使用 `deploy/compose/compose.yaml` 中的 named volumes；不要把 Compose volume 与 K8s local
PV 当成同一存储。

## 3. 内网镜像构建、传输、预拉和 digest 验证

### Step 3.1 — Release inventory gate

```bash
"$MOTHERSHIP_REPOSITORY/deploy/ui4a/verify-overlay.sh"
ssh k8s-w-1 'sudo crictl --runtime-endpoint unix:///run/containerd/containerd.sock images'
ssh k8s-w-2 'sudo crictl --runtime-endpoint unix:///run/containerd/containerd.sock images'
```

- Expected output：overlay `PASS (deployment gate)`；十个 values image refs 都是 immutable digest；两个
  worker 都有完整 layers。
- Failure criterion：placeholder/mutable tag、archive checksum 不同、CRI 只有 manifest metadata、OCI
  revision 不等于 release SHA。
- Recovery action：停止部署，按 `../mothership-setup/deploy/ui4a/README.md` 的 export/checksum/import
  步骤重新传输；不得清理整个 containerd store。

### Step 3.2 — Repository image contracts

```bash
pnpm vitest run scripts/t22/t22-image-contract.test.ts scripts/t22/t22-helm-contract.test.ts
```

- Expected output：focused image/Helm contracts 全绿。
- Failure criterion：UI4A image 缺 non-root runtime、health entrypoint、admin bundle 或 immutable ref。
- Recovery action：修复并重建同一 release SHA；不能复用错误 digest。

## 4. Namespace、Istio injection 和基础策略

### Step 4.1 — Render 前检查

```bash
kubectl get namespace ui4a-system --show-labels
kubectl -n ui4a-system get gateway,virtualservice,requestauthentication,authorizationpolicy
```

- Expected output：namespace injection 开启；Gateway、两个 host route、JWT issuer/audience 与 callback
  policy 完整。
- Failure criterion：issuer 缺 `:32067`、JWKS 不走 cluster service、`/deliver` 未绑定 Runner，或 internal
  callback 暴露到 external host。
- Recovery action：修正 `deploy/helm/ui4a` values/render，重新 lint/template/dry-run；禁止临时放宽策略。

### Step 4.2 — Helm render gate

Helm 位于 `k8s-cp-1`，chart 为 `deploy/helm/ui4a`，mothership values 为外部 overlay 文件。

```bash
ssh k8s-cp-1 "helm lint '<staged>/ui4a' -f '<staged>/values.yaml'"
ssh k8s-cp-1 "helm template ui4a '<staged>/ui4a' -n ui4a-system \
  -f '<staged>/values.yaml' >/dev/null"
```

- Expected output：lint/template exit 0。
- Failure criterion：schema、duplicate resource、Secret inline 或 immutable Job diff。
- Recovery action：不 apply；回到 chart/overlay contract 修复。

### Step 4.3 — 首次安装

首次部署前，按外部 overlay 创建 namespace label、runtime Secret metadata、ingress TLS Secret 和 staging
chart/values；本手册不复制它们的私有输入。

```bash
kubectl -n ui4a-system get secret ui4a-runtime-secrets \
  -o custom-columns=NAME:.metadata.name,TYPE:.type
ssh k8s-cp-1 "helm upgrade --install ui4a '<reviewed-chart>' -n ui4a-system \
  -f '<reviewed-values>' --wait --wait-for-jobs --timeout 15m"
```

- Expected output：release deployed；所有 Jobs Complete、Deployment/StatefulSet Ready、四个 PVC Bound。
- Failure criterion：Secret metadata 不存在、Helm failed revision、Job immutable 或任何 state claim 未就绪。
- Recovery action：停止并查看 failed revision；不使用 `--force`，不删除 retained state。

## 5. 根 CA、域名和证书

### Step 5.1 — 公共证书事实

```bash
kubectl -n istio-system get secret ui4a-internal-tls \
  -o custom-columns=NAME:.metadata.name,TYPE:.type
kubectl -n ui4a-system get pvc pki-data
```

- Expected output：只显示 TLS Secret metadata；`pki-data` Bound 且 Retain。
- Failure criterion：Secret metadata 缺失、两域名 SAN/chain 验证失败、PKI marker 不完整。
- Recovery action：从已验证 backup 恢复 PKI；根 CA/私钥首次生成后禁止覆盖。证书生成与公共 CA 安装
  命令只引用 mothership overlay runbook。

### Step 5.2 — Compose PKI idempotency

```bash
pnpm compose:t22 up
```

- Expected output：先完成一次 `pki-init`，再 `docker compose up -d --wait`；已有完整 PKI 返回 reused。
- Failure criterion：partial inventory、key/cert 不匹配、issuer/SAN 错误或 pki-init 非零。
- Recovery action：停止启动并恢复 PKI backup；不删除 CA volume 后重试。

## 6. PostgreSQL

### Step 6.1 — Bootstrap 和 readiness

```bash
kubectl -n ui4a-system rollout status statefulset/postgres --timeout=180s
kubectl -n ui4a-system wait --for=condition=complete job/postgres-bootstrap --timeout=300s
```

- Expected output：PostgreSQL 1/1 Ready，bootstrap Complete，四库和六个最小角色存在。
- Failure criterion：TLS verify-full 失败、role password 错误、bootstrap Job active/failed、data PVC UID 改变。
- Recovery action：查看 `postgres-0` 和 bootstrap logs；修正 Secret binding/证书，禁止 reset DB/PVC。

## 7. Temporal

### Step 7.1 — Schema、server、namespace

```bash
kubectl -n ui4a-system wait --for=condition=complete job/temporal-schema --timeout=300s
kubectl -n ui4a-system rollout status deployment/temporal --timeout=180s
kubectl -n ui4a-system wait --for=condition=complete job/temporal-namespace --timeout=300s
kubectl -n ui4a-system rollout status deployment/temporal-ui --timeout=180s
```

- Expected output：schema/namespace Complete；server/UI 1/1 Ready；gRPC probe 通过。
- Failure criterion：passwordCommand、service-link env、Istio startup ordering 或 Job sidecar 导致失败。
- Recovery action：保留数据库，读取 Job 和 `--previous` logs；仅在确认幂等后重建具体 Job。

## 8. Keycloak 固定 realm 首次导入与兼容性检查

共享来源是 `deploy/keycloak/realm-import.json`；Compose 和 K8s 使用同一文件语义。

### Step 8.1 — Check 后 apply

```bash
pnpm --filter @ui4a/worker exec tsx ../../scripts/t22/t22-keycloak-realm-bootstrap.ts --check
pnpm --filter @ui4a/worker exec tsx ../../scripts/t22/t22-keycloak-realm-bootstrap.ts --apply
```

- Expected output：首次 check 是 `absent`，apply 是 `imported`；后续 check/apply 都是 `skip` 且
  `no changes made`。
- Failure criterion：`KEYCLOAK_REALM_INCOMPATIBLE`、client 集合不是 ui4a-web/ui4a-agent/ui4a-api，或尝试
  自动修复 drift。
- Recovery action：先备份 Keycloak/realm，停止部署并采用直接替换/重建流程；禁止 online realm
  reconciliation。

## 9. 数据库迁移

### Step 9.1 — 运行并保存 receipt

K8s 使用 retained `migration` Job；Compose 使用同一 admin Worker bundle。

```bash
kubectl -n ui4a-system wait --for=condition=complete job/migration --timeout=300s
kubectl -n ui4a-system logs job/migration -c migration
```

- Expected output：Job Complete，schema/bootstrap receipt 与 release compatible。
- Failure criterion：Job failed、schema 版本未知或 migration 需要 destructive rewrite。
- Recovery action：停止 Web/Worker rollout，保留升级前 backup；不得手工修改生产库绕过 migration。

## 10. UI4A Web/Worker

### Step 10.1 — 单副本 readiness

```bash
kubectl -n ui4a-system rollout status deployment/web --timeout=180s
kubectl -n ui4a-system rollout status deployment/worker --timeout=180s
kubectl -n ui4a-system get deploy web worker -o wide
```

- Expected output：Web/Worker 都是 desired=ready=1，使用 release digest；Worker dependency status 全绿。
- Failure criterion：degraded 被报告 Ready、image revision 错误、DB/Temporal/Keycloak/LLM/Runtime 缺失。
- Recovery action：保持单副本，修复明确依赖或 rollback image；不以增加副本掩盖故障。

Compose all-in-one 对应命令：

```bash
pnpm compose:t22 status
docker compose --project-name ui4a -f deploy/compose/compose.yaml ps
```

## 11. K8s Agent Runtime

### Step 11.1 — RBAC 与 idle topology

```bash
kubectl -n ui4a-system auth can-i create jobs \
  --as=system:serviceaccount:ui4a-system:ui4a-worker
kubectl -n ui4a-system get jobs -l app.kubernetes.io/name=ui4a-agent-runner
```

- Expected output：Worker 可以执行合同要求的 bounded Job operations；idle 时无静态 Runner Deployment。
- Failure criterion：RBAC 缺失或过宽、Run 接受 request-owned image/backend/cwd/provider/model/env。
- Recovery action：停止 K8s dispatch，修正 server-owned settings、ServiceAccount 和 profile；不得 fallback
  到 Host Runner。

### Step 11.2 — One-shot evidence

```bash
kubectl -n ui4a-system get jobs,pods -l app.kubernetes.io/name=ui4a-agent-runner -o wide
```

- Expected output：每个 Run 恰好一个 Job/Pod，结果符合 canonical Run envelope。
- Failure criterion：重复 Job、credential ref 越权、workspace/image/profile 不匹配或 Secret 出现在结果。
- Recovery action：保留 Job/Pod logs 和 workspace，取消该 Run；不要自动重交结果。

## 12. Host Runner

Host Runner 与容器 Runner 复用同一 sealed processor；运行前必须有 canonical host profile。Token 从私有
文件加载到 `UI4A_RUNNER_TOKEN`，不写进命令历史。`UI4A_RUNNER_ID` 必须精确匹配 server-owned profile。

### Step 12.1 — Build 和 health

```bash
pnpm --filter @ui4a/agent-runner build
node apps/agent-runner/dist/main.js health
node apps/agent-runner/dist/main.js version
```

- Expected output：structured live/version JSON，不包含 Secret。
- Failure criterion：build 失败、release revision 不匹配或 health 输出 credential。
- Recovery action：不启动 daemon，修正 release/config 后重建。

### Step 12.2 — 启动 daemon

```bash
export UI4A_RUNNER_ID='<server-owned-id>'
export UI4A_RUNNER_TOKEN="$(< '<absolute-0600-token-file>')"
node apps/agent-runner/dist/main.js daemon
```

- Expected output：Runner ready，只接受 profile 的 workspace/image/resource/network/credentialRefs。
- Failure criterion：`runner_delivery_not_configured`、Bearer 不匹配、路径逃逸或未经授权 credential ref。
- Recovery action：停止 daemon、`unset UI4A_RUNNER_TOKEN`、保留 workspace evidence；修正 canonical profile，
  不扩大权限。

## 13. DNS/hosts 和客户端根证书

### Step 13.1 — 两个域名和 CA

```bash
getent hosts ui4a.mothership.internal auth.ui4a.mothership.internal
curl --cacert '<reviewed-panel-ca-copy>' \
  https://ui4a.mothership.internal:32067/.well-known/ui4a.json
curl --cacert '<reviewed-panel-ca-copy>' \
  https://auth.ui4a.mothership.internal:32067/realms/ui4a/.well-known/openid-configuration
```

- Expected output：两域名解析到审核的 ingress 地址，两个 HTTPS 请求成功且不使用 `-k`。
- Failure criterion：DNS 漂移、证书 SAN/chain 错误、OIDC issuer 缺 external port。
- Recovery action：修复 DNS/hosts 或只安装审核过的公共 CA；绝不分发 CA 私钥。

## 14. 人类登录、CLI、Agent token exchange

### Step 14.1 — 负向矩阵

```bash
pnpm vitest run apps/web/src/auth/authentication-negative.test.ts \
  apps/cli/src/production-authentication.test.ts
```

- Expected output：missing/malformed/expired/wrong issuer/audience/signature/scope 全部 fail closed；CLI 在 HTTP
  fetch 前拒绝无 credential。
- Failure criterion：伪造 header/body 改变 principal、Agent/service account approve 成功或 token 泄露。
- Recovery action：停止验收并撤销测试 credential；修复 Istio 与应用二次验证，不能只加 edge policy。

### Step 14.2 — 正向只读 CLI

```bash
pnpm cli:build
export UI4A_TOKEN='<memory-only-bearer>'
node apps/cli/dist/main.js doctor
unset UI4A_TOKEN
```

- Expected output：doctor/sitemap/entity read 成功，principal 来自 verified token；delegation 记录 canonical
  `sub + azp`。
- Failure criterion：CLI 负责登录/refresh、token 出现在 stdout，或交换 scope 不是原 grants 子集。
- Recovery action：清除内存 credential，检查 Keycloak client scopes/audience 和应用身份映射。

浏览器仅支持 Authorization Code + PKCE；人类 approval 仍要重新读取当前 Siren action 并通过
guard/schema/CAS。

## 15. Golden Story

单 Web 并发、restart 与 replay 的 operator contract 是
`scripts/t22/t22-k8s-replay-drill.ts`；它只使用 bounded fixture，不能替代完整业务验收。

### Step 15.1 — 用户故事 gate

```bash
CI=true pnpm e2e invariants
```

- Expected output：业务 Flow、bounded delegation、Agent 无法审批、人类审批、K8s/Host 两后端、重启、审计
  与 replay evidence 全部通过。
- Failure criterion：用 Pod Running/HTTP 200 代替业务验收、Agent 审批成功、proposal 被自动 merge/deploy，
  或 replay hash 不一致。
- Recovery action：不接受 release；从第一个失败的用户故事边界修复并用干净 fixture 重跑。

## 16. 备份恢复

恢复必须隔离，禁止把 current PVC/Service/namespace 当 target。合同入口包括：

- `scripts/t22/t22-k8s-recovery-observe-command.ts`
- `scripts/t22/t22-k8s-recovery-command.ts`
- `scripts/t22/t22-k8s-recovery-live.ts`

### Step 16.0 — Compose backup/restore plan

```bash
pnpm compose:t22 backup
pnpm compose:t22 restore-plan
```

- Expected output：backup 明确要求 verified quiescence receipt；restore 是 isolated、
  `destructive=false`、`useCleanRestore=false`。这两个入口报告 plan，实际 executor 仍须使用审核过的
  `0600` request。
- Failure criterion：Compose preflight 失败、backup inventory 不完整或 restore 指向 current volume。
- Recovery action：保持 stack/volume 不变，修正 canonical request 后再调用 backup/restore executor。

### Step 16.1 — Observation 与 plan

```bash
export UI4A_K8S_RECOVERY_NAMESPACE=ui4a-system
export UI4A_K8S_RECOVERY_HWM_PROBE_FIRST='<immutable-probe-1>'
export UI4A_K8S_RECOVERY_HWM_PROBE_SECOND='<immutable-probe-2>'
export UI4A_K8S_RECOVERY_OBSERVATION_OUTPUT_FILE='<absolute-new-0600-json>'
pnpm --filter @ui4a/worker exec tsx \
  ../../scripts/t22/t22-k8s-recovery-observe-command.ts capture

export UI4A_K8S_RECOVERY_OBSERVATION_FILE="$UI4A_K8S_RECOVERY_OBSERVATION_OUTPUT_FILE"
export UI4A_K8S_RECOVERY_REQUEST_FILE='<absolute-0600-request-json>'
pnpm --filter @ui4a/worker exec tsx ../../scripts/t22/t22-k8s-recovery-command.ts plan
```

- Expected output：observation 写入新 `0600` 文件；plan 是 `mode=isolated`、`destructive=false`，current
  UID 与 target root 无重叠。
- Failure criterion：HWM 不稳定、writer 未 quiesce、active Agent Job、target 已存在或 root/UID alias。
- Recovery action：恢复 current writers 并停止；修正 observation/request，不能放宽隔离检查。

### Step 16.2 — Live drill acceptance

```bash
pnpm vitest run scripts/t22/t22-k8s-recovery-live.test.ts \
  scripts/t22/t22-backup-contract.test.ts scripts/t22/t22-restore-contract.test.ts
```

- Expected output：命名 backup 包含四库、workspace、realm/settings/bindings、PKI/private config；manifest
  checksum 完整；隔离 restore/rebuild 后 authority/identity/Run match，记录 RPO/RTO。
- Failure criterion：任何 checksum/inventory 缺失、current resource UID 改变、RPO 非零或 hash 不同。
- Recovery action：保留 current 与 incomplete archive，停止恢复；不得 in-place restore。

## 17. 升级与回滚

当前现场基线是 Helm revision 19。只有新 image digest 已导入、升级前 named backup HWM 与 live HWM
相同、retained Job render 无 diff 时才继续。`adminWorker`/`pkiRunner` 保持旧值可保护 completed Jobs；
若 migration/PKI/Job template 变化，本步骤失效，必须另做兼容迁移计划。

### Step 17.1 — Dry-run 和 retained Job gate

```bash
ssh k8s-cp-1 "helm lint '<reviewed-chart>' -f '<reviewed-values>'"
ssh k8s-cp-1 "helm template ui4a '<reviewed-chart>' -n ui4a-system \
  -f '<reviewed-values>' --show-only templates/jobs.yaml" | kubectl diff -f -
ssh k8s-cp-1 "helm upgrade ui4a '<reviewed-chart>' -n ui4a-system \
  -f '<reviewed-values>' --dry-run=server --hide-secret"
```

- Expected output：lint/dry-run 成功，六个 completed Job diff 为零，Secret/PVC/PV refs 不变。
- Failure criterion：任一 Job template diff、migration 不兼容、new image 未锁 digest。
- Recovery action：零变更停止。禁止删除 Jobs 来掩盖未审核 drift，禁止 `helm upgrade --force`。

### Step 17.2 — Rollout、rollback、roll-forward

```bash
ssh k8s-cp-1 "helm upgrade ui4a '<reviewed-chart>' -n ui4a-system \
  -f '<reviewed-values>' --wait --wait-for-jobs --timeout 15m --history-max 20"
ssh k8s-cp-1 'helm rollback ui4a 19 -n ui4a-system \
  --wait --wait-for-jobs --timeout 15m'
ssh k8s-cp-1 'helm rollback ui4a 20 -n ui4a-system \
  --wait --wait-for-jobs --timeout 15m'
```

- Expected output：upgrade revision 20；rollback 产生 revision 21 并恢复旧 images；roll-forward 产生
  revision 22 并恢复 revision 20。每次 smoke 后 event HWM/authority hash 与基线相同，Jobs/PVC/Secret UID
  不变。
- Failure criterion：smoke、UID、HWM/hash 或 image refs 任一不符。
- Recovery action：手动 rollback revision 19，不用 `--atomic` 或 `--force`；数据问题先用 verified backup
  做隔离恢复，不能覆盖 current。

Realm Job 在此路径不重跑，所以不需要 realm 在线升级；身份变更是独立的备份后替换/重建工作。

## 18. 日志、健康检查和常见故障

### Step 18.1 — Redacted diagnostics

```bash
kubectl -n ui4a-system get pods,jobs,pvc -o wide
kubectl -n ui4a-system get events --sort-by=.lastTimestamp
kubectl -n ui4a-system logs deployment/web -c web --tail=200
kubectl -n ui4a-system logs deployment/worker -c worker --tail=200
```

- Expected output：liveness、readiness、dependency status 分开；日志含 request/run/workflow/principal
  correlation，但无 Token/API Key/password/full prompt。
- Failure criterion：degraded 冒充 ready、previous failure 丢失、日志包含 credential material。
- Recovery action：保存 redacted metadata 与 `--previous` logs，修复明确依赖后重跑 readiness/smoke。

常见现场映射：

| 现象 | 检查 | 恢复 |
| --- | --- | --- |
| `cannot verify user is non-root` | container numeric UID/GID | 修正 chart securityContext 后重建 Pod |
| Job 永不 Complete | Istio sidecar 是否注入 | 仅 batch Job 标记 `sidecar.istio.io/inject: "false"` |
| Temporal password auth failed | passwordCommand/Secret file | 不重置 DB；修正 file command |
| Temporal probe binary missing | gRPC native probe | 不容忍 restart；修正 probe |
| UI `TEMPORAL_PORT=tcp://...` | service links | `enableServiceLinks: false` |
| TLS unknown CA | combined trust/NODE_EXTRA_CA_CERTS | 修复 CA mount；禁止 `-k` |
| Job immutable upgrade | retained Job diff | 停止 upgrade；不用 `--force` |

## 19. 停止、卸载和数据保留

### Step 19.1 — Compose 普通停止

```bash
pnpm compose:t22 down
pnpm compose:t22 status
```

- Expected output：`COMPOSE_DOWN_COMPLETED`；containers 停止，named volumes 保留。
- Failure criterion：planned command 含 `--volumes`、prune 或 broad path 删除。
- Recovery action：取消命令，先运行 `pnpm compose:t22 status` 和 backup inventory。

### Step 19.2 — Compose 明确清空

这是与普通停止分离的破坏性操作，只能在 backup 已验证且 operator 明确授权后执行：

```bash
pnpm compose:t22 clean --confirm-destroy-volumes ui4a
```

- Expected output：只有 exact project `ui4a` 接受确认并执行 `down --volumes`。
- Failure criterion：缺确认也能删除、project 不精确或目标包含非 UI4A volume。
- Recovery action：不确认；先核对 manifest/checksum。已删除 volume 只能从 backup 恢复。

### Step 19.3 — Helm 卸载但保留数据

```bash
ssh k8s-cp-1 'helm uninstall ui4a -n ui4a-system'
kubectl get pv
kubectl -n ui4a-system get pvc 2>/dev/null || true
```

- Expected output：release workloads 删除；Retain PV 和宿主机数据仍存在，供明确的恢复或后续处置。
- Failure criterion：流程包含 `kubectl delete pvc`、`kubectl delete pv`、storage prune 或删除 backup/PKI。
- Recovery action：停止。记录 PV/PVC/namespace/Secret UID 与 backup checksums；数据删除必须作为本手册
  之外的单独审核操作。

Compose 与 Helm 停止后都不得删除 `v0.1.0-experimental.1` 的 release inventory、named backup、恢复
报告或根 CA。实验数据保留多久由环境 owner 决定，不由卸载命令隐式决定。
