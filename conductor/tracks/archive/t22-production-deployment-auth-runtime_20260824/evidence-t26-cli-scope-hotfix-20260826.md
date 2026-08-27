# T26 Work Thread 生产部署与 CLI Scope Hotfix 证据

日期：2026-08-26

环境：mothership Kubernetes，namespace `ui4a-system`

入口：`https://ui4a.mothership.internal:32067`

状态：完成；Helm revision 42 `deployed`

## 范围与结论

本证据补录 T26 归档后的生产部署、真实 CLI 对照和两次部署态修正。T26 归档文档保持只读；
部署过程与 post-release correction 归入仍活跃的 T22。最终结果满足以下合同：

- Work Thread core 事件可从既有日志严格重放，credential identity 仅为审计封套，不进入业务
  detail 的闭式解析；
- credential 模式的 `POST /api/exec` 成功实体与 `GET /api/entity` 使用同一个 policy-scope
  lens，不披露当前 scope 外的 Thread 引用；
- CLI 仍不接受 actor/principal/scope override，只用外部 Bearer credential、Siren action、
  dry-run 和只读 audit；
- 修复未重跑 retained Jobs，未替换 PVC，也未夹带并行开发中的 T30。

## 时间线

### Revision 40：T26 首次部署

- T26 完成提交：`a261a6486b09aa4deb6a402bbc839a12f9d198b3`；
- Web/Worker 镜像构建、离线导入两台 worker，Helm revision 40 成功；
- 预升级 PostgreSQL 备份：
  `/backups/ui4a-pre-upgrade-a261a64-hwm360/ui4a.dump`；
- archive SHA-256：
  `373450b5659201f3c8130dfb225ae38d27078a1393ed45c5f94ae70b64d2f351`；
- 在线 create/attach 成功，但 Web restart 后严格 replay 报
  `Thread created detail contains forbidden key identity`。

根因是 Web 持久化层按既有合同把可信 credential provenance 放在 `detail.identity`，而 T26
新增的闭式业务 parser 在 replay 时直接解析整个存储 detail。在线命令使用写入前的业务 detail，
所以只有 restart/replay 能暴露该缺陷。

### Revision 41：审计封套重放修复

- `91e1a6e fix(thread): replay credential-audited events`；
- `8d3b289 fix(engine): type credential audit detail`；
- Web digest：
  `sha256:5089003bb5888e9e46a354beb58dff7fd4ddad99e9fb8b7e32866fe50a6cbab8`；
- Worker digest：
  `sha256:f38b9cb6a9bcf8f7d4704a384688e7e6d096ecd4a4b0fda1e1d7db83d305a301`；
- Helm revision 41 成功，`/ready` 的 required bootstrap/config/migration/postgres/replay
  全部为 `ok`；
- 重启后的 `thread:deploy-a261a64` 从既有日志恢复，默认 scope 隐藏 `articles`，publishing
  scope 可见，审计含 `thread-created` 与 `thread-reference-attached`。

## 真实安装版 CLI 对照

CLI 通过以下路径验证，不用 curl 或数据库代替业务合同：

1. `pnpm cli:build`；
2. `pnpm --filter @ui4a/cli pack`；
3. 在 `mktemp -d` 前缀执行 `npm install --prefix ... <package.tgz>`；
4. 从安装后的 `node_modules/.bin/ui4a` 执行 `doctor`、discovery、entity/action read、
   dry-run、live exec 和 audit；
5. Bearer token 仅存在于进程环境，不落盘、不输出；内部 CA 通过
   `NODE_EXTRA_CA_CERTS` 验证。

revision 41 上建立 `thread:cli-deploy-8d3b289`，产生以下 core events：

| seq | kind | action |
| ---: | --- | --- |
| 369 | `thread-created` | `create` |
| 370 | `thread-reference-attached` | `attach` |
| 371 | `thread-status-changed` | `pause` |
| 372 | `thread-status-changed` | `resume` |

CLI 的 create/attach/audit 与状态生命周期均成功，但暴露了第二个问题：attach/pause/resume 的
`actions exec` 响应包含 `context: ["articles"]`，紧随其后的普通 `entities get` 在同一
credential 默认 scope 下返回 `context: []`；通过 CLI 的只读 `request get` 指定已授予
`scope=publishing` 后又能看到 `articles`。写入与 scope lens 都存在，但 exec 响应绕过了 lens。

## Scope 响应修复

代码检查确认：

- `GET /api/entity` 对 credential entity 调用 `filterEntityForPolicyScope`；
- `POST /api/exec` 直接返回 `outcome.entity`；
- `POST /api/exec-plan` 不返回 Siren entity，只返回已受“一个 scope 覆盖所有 step”约束的
  rel/裁决摘要，因此不需要实体过滤改动。

TDD 与实现：

- Red：新增 production route 测试，证明 accepted Work Thread entity 的跨 scope property/link
  未过滤；
- Green：所有 credential 模式 accepted entity（包含普通 exec 与 Agent Run action）统一经过
  与 GET 相同的 `filterEntityForPolicyScope`；local demo 行为不变；
- 主分支功能提交：`41a228d7319694d594882e9995f3f72b03d6322e`；
- 为避免部署并行 T30，从 revision 41 的 `8d3b289` 基线创建
  `release/t26-scope-hotfix-20260826`，只 cherry-pick 本修复；发布提交：
  `d5557bfe5e57e9026cc72e4290a3bb7e0e6f5246`。

## 自动验证

通过：

```text
pnpm vitest run apps/web/src/app/api/exec \
  apps/web/src/auth/application-scope.test.ts apps/cli/src
```

结果：10 files、72 tests 全绿。`pnpm check` 的 typecheck、ESLint（零 error）与 governance
GR1–GR3 全部通过。全量 Vitest 的 `floating-chat*.test.tsx` 在 Node.js Web Storage 环境中整组
失败，并输出 `--localstorage-file was provided without a valid path`；该环境问题由用户确认，
与本次路由改动无关，不把它记为全量测试通过。

镜像构建本身再次执行 Next.js production build 与 TypeScript 检查并成功。

## Revision 42 部署证据

- Web source：`ui4a/web:t26-scope-d5557bf`；
- Web archive SHA-256：
  `34af448a21f9ab28713bfc4621f0a0d944cacf02572733bab0380ab73fe6d468`；
- 两节点一致的 manifest digest：
  `sha256:9b0e20077d16368f0197a8fa493b8ec8b12b74b327a9caf030113e0c2e81911c`；
- Worker 保持 revision 41 digest：
  `sha256:f38b9cb6a9bcf8f7d4704a384688e7e6d096ecd4a4b0fda1e1d7db83d305a301`；
- `verify-overlay.sh`、Helm lint、server dry-run、retained Job diff 全部通过；
- Helm revision 42 于 `2026-08-26T12:02:46Z` 成功，Web/Worker 均 Ready；
- 外部 TLS `/version` 返回 Git SHA `d5557bfe5e57e9026cc72e4290a3bb7e0e6f5246`；
- migration、pki-init、postgres-bootstrap、realm-bootstrap、temporal-schema 与
  temporal-namespace Job UID 未变化；四个 PVC UID 未变化且均为 Bound。

## Revision 42 CLI 最终验收

重新 pack/install CLI 后，对同一 `thread:cli-deploy-8d3b289` 执行：

- `doctor` 的 health/business/meta probes 全部 200；
- `actions list` 发现 `pause`；
- pause dry-run 明确为 `effect: not executed`；
- pause live exec：`status=paused` 且默认 scope `context=[]`；
- 普通 `entities get`：`status=paused` 且 `context=[]`，与 exec 一致；
- CLI 只读 `request get ...&scope=publishing`：`context=["articles"]`；
- resume live exec：`status=open` 且默认 scope `context=[]`；
- audit 新增 seq 373/374 两条 `thread-status-changed`，与 369–372 连续构成完整证据。

最终结论：T26 生产重放、credential scope 响应、安装版 CLI 对照、immutable image、Helm
rollout 和持久资源保持均已闭环；T22 的全量质量门仍保持 pending，不能用本证据替代。
