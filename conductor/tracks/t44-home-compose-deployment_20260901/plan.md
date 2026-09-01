# T44 实施计划

计划遵循 `intent → initial plan → disposable spike → detailed plan → implementation`。正式代码任务执行
Red → Green，并以 `home` 实机 Ready 与 Tailnet HTTPS 为最终完成条件。

## Phase A：现场盘点、清理与 Disposable Spike

- [x] Task: 盘点 home 运行环境与冲突
  - [x] 验证 Debian x86_64、Docker/Compose、Tailscale、Caddy、资源与端口
  - [x] 确认 Plane 占用 `8443`，现有 gateway 占用 Tailnet `443`
- [x] Task: 清理低风险空间
  - [x] 清理可重建缓存、废纸篓、APT、Docker build cache 与 VS Code staging
  - [x] 对旧 Rust target 执行精确 `cargo clean`
  - [x] 不触碰用户数据、Docker volumes 和现有服务
- [x] Task: 执行 Web image disposable spike
  - [x] 当前 SHA 的 linux/amd64 production image 构建成功
  - [x] 临时 PostgreSQL + Web 的关键页面返回 200
  - [x] `/ready` 诚实报告 migration required，证明正式路径必须使用完整 Compose
  - [x] 删除 Spike 容器、网络、镜像和源目录
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md)
  - [x] 记录空间、路由、镜像 revision 与 readiness 证据

## Phase B：公共 Origin 合同 [checkpoint: dfbeee6]

- [x] Task: Red — Operator-defined public origins dfbeee6
  - [x] 为完整 HTTPS Web/Keycloak origin、默认值、非法 origin 与 canonical settings mismatch 编写失败测试
  - [x] 为宿主 edge bind address/port 与内部 listener 分离编写失败测试
  - [x] 运行测试并确认预期失败
- [x] Task: Green — Compose renderer 与静态投影 dfbeee6
  - [x] 扩展严格 Compose input、renderer、静态 YAML 和 contracts
  - [x] Keycloak hostname、PKI host、edge aliases 与 worker origins 使用同一受控输入
  - [x] 保持内部 admin/Runner listener 不公开且默认行为不变
- [x] Task: D60 与 runbook dfbeee6
  - [x] 在 `DECISIONS.md` 记录 public origin 和内部 listener 分离
  - [x] 更新 Compose operator 文档与部署运行手册
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) dfbeee6
  - [x] 运行 focused tests、format、typecheck、lint 与 governance

## Phase C：Home Release 与 Compose 上线

- [ ] Task: 构建 digest-pinned OCI inventory
  - [ ] 以 exact release SHA 构建 Web、Worker、Runner linux/amd64 镜像
  - [ ] 固定 PostgreSQL、Temporal、Temporal UI/Admin、Keycloak 与 Caddy digest
  - [ ] 核对 UI4A image revision labels
- [ ] Task: 创建 home operator inputs
  - [ ] 创建 canonical settings、Secret JSON、九个独立 Secret files 和 manifest
  - [ ] 所有文件为绝对路径、普通文件、`0600`，且不打印 Secret
  - [ ] 运行 production preflight
- [ ] Task: 启动完整 Compose
  - [ ] 初始化 PKI、PostgreSQL roles、Temporal schema/namespace、Keycloak realm 和 migration
  - [ ] Web、Worker、Runner、edge 达到 healthy/ready
- [ ] Task: 接入 home gateway
  - [ ] 使用独立 UI4A/Keycloak host 与 Tailnet-only Caddy route
  - [ ] 反向代理信任 UI4A public CA，不跳过 TLS 校验
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)
  - [ ] 记录 preflight、container health、digests 与入口证据

## Phase D：实机验收与闭环

- [ ] Task: HTTP、认证与关键页面验收
  - [ ] 验证首页、Applications、Meta、Siren discovery、OIDC discovery 与版本
  - [ ] 验证登录跳转与 callback origin
- [ ] Task: Runtime 与持久性验收
  - [ ] 验证 Worker、Temporal 与 Runner 状态
  - [ ] 重启长期服务并确认重新 Ready、volume identity 不变
- [ ] Task: 运维与回滚记录
  - [ ] 记录 status、日志、普通 down、backup plan 和 digest rollback 命令
  - [ ] 明示 experimental/known-risk 与未执行项
- [ ] Task: Phase Verification & Track Closure (Refer to workflow.md)
  - [ ] 运行最终 focused gates 与 home smoke
  - [ ] 更新 evidence、metadata、registry 并归档 Track
