# T47 实施计划

## Phase A：现网 Probe 与架构合同

- [x] Task: Disposable Probe — 验证 Home Tailscale-only HTTP published port c3612c8
  - [x] 用临时容器验证 Home 自身与 `aliyun-sz` 能经 HTTP 访问、普通绑定不扩张
  - [x] 记录 Docker NAT source IP 限制、Tailnet bind 决策并移除临时容器
- [x] Task: Red — 双入口、纯 HTTP edge 与受信 Origin 合同 585049c
  - [x] 为 canonical settings、Compose renderer/operator 和 edge allowlist 写失败测试
  - [x] 为 Chat/internal callback 的受信 Origin 选择写失败测试

## Phase B：最小实现 [checkpoint: ab48c43]

- [x] Task: Green — canonical browser origins、身份绑定与纯 HTTP gateway ab48c43
  - [x] 扩展平台中立 deployment settings 和 Web request-origin/auth adapter
  - [x] 扩展 Keycloak Web client callback contract，保持唯一 issuer
  - [x] 将 UI/Keycloak public edge listener 改为 HTTP，保留 allowlist 和内部 TLS listener
  - [x] 生成 Tailscale-only bind，更新静态 Compose 与 operator inputs
  - [x] 记录 superseding DECISIONS 条目并更新 standing deployment docs
- [x] Task: Phase A+B Verification & Checkpoint ab48c43

## Phase C：Home 原地升级与双入口切换 [checkpoint: 2a0c4c4]

- [x] Task: 构建 exact SHA images 与不可变 digest inventory 2a0c4c4
- [x] Task: Home 原地升级 2a0c4c4
  - [x] 备份/核对数据身份，更新 canonical settings 与 operator inputs
  - [x] preflight、up、edge reload、八服务 healthy 与 HTTP source-policy probe
- [x] Task: 切换 Home 与 aliyun-sz Caddy 为并列 HTTPS -> HTTP 2a0c4c4
  - [x] Home 入口 HTTP 回源同一 gateway
  - [x] Aliyun 入口经 Tailscale HTTP 直达同一 gateway并保留 public Host
- [x] Task: Phase Verification & Checkpoint 2a0c4c4

## Phase D：端到端验收、文档与关闭

- [~] Task: 公网与 Tailnet 双入口验收
  - [x] TLS、live/version、UI/API 未登录分流、OIDC discovery/account/logout
  - [~] 公网与内部 Authorization Code + PKCE 登录及 Chat 真实请求（两入口登录通过；等待 CPA Kimi OAuth 续期后重放最终 Chat）
  - [x] admin/internal route 负例、重启恢复与日志复核
- [x] Task: 同步仓库外部署 runbook 与 Home mirror，比较 SHA-256
- [ ] Task: 完成 evidence/DONE、归档 Track、推送 exact release
- [ ] Task: Phase Verification & Checkpoint
