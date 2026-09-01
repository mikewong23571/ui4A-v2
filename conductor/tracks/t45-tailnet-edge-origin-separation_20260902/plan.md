# T45 实施计划

## Phase A：合同 Red/Green [checkpoint: 357270a]

- [x] Task: Red — public origin 与 internal TLS host 分离 357270a
  - [x] production config 接受不同 host，同时保持 issuer/callback cross-check
  - [x] Compose renderer/operator generator 分别投影 public 与 internal host
  - [x] 非法 origin、TLS host 和环境 mismatch 继续拒绝
- [x] Task: Green — 最小实现与 D61 357270a
  - [x] 更新 shared parser、Compose types/services/static projection
  - [x] 更新 standing tests、runbook 与 DECISIONS
- [x] Task: Phase Verification & Checkpoint 357270a
  - [x] focused tests、format、typecheck、lint、governance、`pnpm check`

## Phase B：Home 原地升级 [checkpoint: 51fc479]

- [x] Task: 构建 exact SHA linux/amd64 images 与 digest inventory 51fc479
- [x] Task: 更新 operator public origins，保留内部 TLS hosts、CA 和 data volumes 51fc479
- [x] Task: preflight、up、status 与 volume identity 验证 51fc479

## Phase C：Aliyun Caddy 与公网验收

- [x] Task: 配置两个公网 host，经 Tailscale TLS 回源 home 51fc479
- [x] Task: HTTPS/OIDC/真实登录/重启验收
  - [x] 两域名公共证书、关键路由、issuer/callback 与 Keycloak 登录表单 action 正确
  - [x] `mike` 账户 enabled、无 required action，密码登录通过
  - [x] 用户在实际浏览器完成 Authorization Code + PKCE 登录确认
- [ ] Task: 记录 evidence、DONE、归档并推送

## Review Fixes：认证体验闭环

- [x] Task: 未登录页面边界 74b3185b
  - [x] 无 session cookie 的 UI 页面在渲染前跳转 `/auth/login?returnTo=...`
  - [x] API、Siren、health、auth callback 与静态资源保持既有 401/公开语义
- [x] Task: 账户与会话入口 74b3185b
  - [x] 顶栏系统区增加“账户与密码”和 POST“退出登录”
  - [x] Compose Keycloak edge 放行固定 realm account console，禁止 admin 扩张
- [x] Task: Review Fixes Verification 74b3185b
  - [x] focused tests、全量 check、公网未登录跳转、API 401、logout 与 account 验收
