# Tracks Registry

> Completed Track documents are immutable implementation history. Their original assumptions may be superseded by later Tracks or `DECISIONS.md`; only `[~]` Tracks define active work. 已完成的 Track 归档于 [tracks/archive/](./tracks/archive/)(T23 FR5)。

## 活跃 Tracks

- [ ] **Track: T48 Application Genesis 产品内闭环与 Meta 人机同门**（application-bundle 受治理 Draft → 原子 seed 事件 → scope 全集自动生长；集合级 create 人类渲染与 agent 同门） *Link: [tracks/t48-application-genesis-meta-parity_20260904/index.md](./tracks/t48-application-genesis-meta-parity_20260904/index.md)*

- [x] **Track: T47 双 HTTPS 入口与纯 HTTP Origin**（Review Fixes：生产请求期账户/改密/退出操作恢复与真实 logout 验收） *Link: [tracks/archive/t47-peer-https-http-origin_20260902/index.md](./tracks/archive/t47-peer-https-http-origin_20260902/index.md)*

- [x] **Track: T46 CLI Device Credential 与长期 Agent 访问**（Keycloak Device Authorization + 90 天 Offline Access + macOS Keychain） *Link: [tracks/archive/t46-cli-device-credential_20260902/index.md](./tracks/archive/t46-cli-device-credential_20260902/index.md)*

- [x] **Track: T45 Tailnet Edge 公网 Origin 与内部 TLS Host 分离**（`aliyun-sz` Caddy → Tailscale → `home` UI4A edge） *Link: [tracks/archive/t45-tailnet-edge-origin-separation_20260902/index.md](./tracks/archive/t45-tailnet-edge-origin-separation_20260902/index.md)*

- [x] **Track: T44 Home Compose 部署：公共 Origin 可移植性与实机上线**（`home` 完整 Compose healthy；Tailnet HTTPS、OIDC 登录、重启持久性闭环） *Link: [tracks/archive/t44-home-compose-deployment_20260901/index.md](./tracks/archive/t44-home-compose-deployment_20260901/index.md)*

- [x] **Track: T43 Application Capability 边界：Native Function Adapter 与受治理结果回流**（首个 `cve.enrich` 垂直切片；S1–S14 用户故事；Capability 是 Application Port，函数只是部署侧 Adapter） *Link: [tracks/archive/t43-capability-boundary-native-function_20260901/index.md](./tracks/archive/t43-capability-boundary-native-function_20260901/index.md)*

## 归档 Tracks(T1–T42,只读历史)

- [x] **Track: T42 共同工作上下文：全局发现、跨应用工作线与简洁处境入口**（2026-09-01：S1–S8全过；check3585、E2E65、真实LLM2、核心行覆盖96.64%；真实Temporal恢复、授权负例、桌面/390px与开发环境恢复闭环） *Link: [tracks/archive/t42-shared-working-context_20260901/index.md](./tracks/archive/t42-shared-working-context_20260901/index.md)*

- [x] **Track: T41 Application 发现入口分层：缩略书架与独立应用目录**（2026-09-01：主页最多 9 个、30 应用目录增量验收、四屏宽及真实 HTTP/CLI 同源通过；全量 check 3529 tests passed） *Link: [tracks/archive/t41-application-directory_20260901/index.md](./tracks/archive/t41-application-directory_20260901/index.md)*

- [x] **Track: T40 深路径体验闭环:应用内实体页 × Chat 共同注视的走查修复**(2026-08-31 完成:S1–S10 深路径用户故事全部浏览器/CLI 实测通过,S4/S6 真实 LLM;F-01~F-12 全闭环;S6 引用点击白屏经 dev/生产对照定案为 dev 编译开销;全量门禁绿) *Link: [tracks/archive/t40-deep-path-experience_20260831/index.md](./tracks/archive/t40-deep-path-experience_20260831/index.md)*

- [x] **Track: T39 Meta 合同驱动治理与 Application 入口体验：语义 Trait + 有界 Hint、canonical Renderer、任务优先 UI/UX 与八应用双门验收**(2026-08-31 完成：US1–US18 通过，US19 真实 LLM 因 provider 未配置记为 NOT RUN；根级 Browser/CLI/390px/第九 fixture/full E2E/invariants/check 全部闭环) *Link: [tracks/archive/t39-meta-contract-driven-governance-ux_20260830/index.md](./tracks/archive/t39-meta-contract-driven-governance-ux_20260830/index.md)*

- [x] **Track: T36 治理例外清退:重构与功能拆解(反模块膨胀)**(2026-08-29 完成:GR3 基线 12 条+GR1 例外 2 条全数清偿,`governance:strict` 并入 `pnpm check`(D53);附带对齐 T34/T35 陈旧 e2e 断言、修复 3 处产品缺陷;全量 e2e/check 双绿) *Link: [tracks/archive/t36-governance-exception-retirement_20260828/index.md](./tracks/archive/t36-governance-exception-retirement_20260828/index.md)*

- [x] **Track: T22 生产形态部署、身份认证与双后端 Agent Runtime：mothership K8s/Istio、Docker Compose all-in-one、Keycloak、灾备与首个试验性版本(已发布 `v0.1.0-experimental.1`;过期实机验证按 D52 裁定不再补跑)** *Link: [tracks/archive/t22-production-deployment-auth-runtime_20260824/index.md](./tracks/archive/t22-production-deployment-auth-runtime_20260824/index.md)*

- [x] **Track: T34 授权与注意力范畴分离:凭证集合裁决 + presence 单点镜头,破坏性剥离单值 policyScope** *Link: [tracks/archive/t34-authority-attention-separation_20260827/index.md](./tracks/archive/t34-authority-attention-separation_20260827/index.md)*

- [x] **Track: T35 持续试用与走查修复**(2026-08-28 完成:R1–R3 走查,S1–S11 全过;findings 27 rechecked + F-20 wontfix 终判 + F-05/F-26 方向项;门禁全绿) *Link: [tracks/archive/t35-ux-walkthrough-remediation_20260827/index.md](./tracks/archive/t35-ux-walkthrough-remediation_20260827/index.md)*

- [x] **Track: T33 读面姿态与责任点:读多写少落地(表单退位、决策卡一击、任务语言;ASCII 用户故事为验收方向锚;mothership 现场验收显式遗留)** *Link: [tracks/archive/t33-reading-posture-decision-cards_20260827/index.md](./tracks/archive/t33-reading-posture-decision-cards_20260827/index.md)*

- [x] **Track: T32 交互与组合质量修复:T28/T30 实现质量发现项登记与修复(评审修复 track;Q6/Q7 与 T31 R12 同文件,建议 T31 闭环后执行该组)** *Link: [tracks/archive/t32-interaction-composition-quality_20260827/index.md](./tracks/archive/t32-interaction-composition-quality_20260827/index.md)*

- [x] **Track: T31 质量评审修复:T24–T30 实现质量发现项登记与修复(评审修复 track;建议 T27 闭环后启动,并行须避开其冲突面)** *Link: [tracks/archive/t31-quality-remediation_20260826/index.md](./tracks/archive/t31-quality-remediation_20260826/index.md)*

- [x] **Track: T24 呈现诚实化(减暴露):机制 chrome 退出首屏与对话面** *Link: [tracks/archive/t24-presentation-honesty_20260825/index.md](./tracks/archive/t24-presentation-honesty_20260825/index.md)*

- [x] **Track: T28 一等交互与引用:动作上肩、引用可点、raw 模式** *Link: [tracks/archive/t28-first-class-interaction_20260825/index.md](./tracks/archive/t28-first-class-interaction_20260825/index.md)*
- [x] **Track: T27 Workstation 站点:三种工作形态落地与"我的事"首页** *Link: [tracks/archive/t27-workstation-site_20260825/index.md](./tracks/archive/t27-workstation-site_20260825/index.md)*
- [x] **Track: T30 呈现平面组合化:区域 × intent × 聚合虚主体(前置架构)** *Link: [tracks/archive/t30-presentation-composition_20260825/index.md](./tracks/archive/t30-presentation-composition_20260825/index.md)*
- [x] **Track: T26 工作线投影(work thread):一件事的纯投影聚合(spike 先行)** *Link: [tracks/archive/t26-work-thread-projection_20260825/index.md](./tracks/archive/t26-work-thread-projection_20260825/index.md)*
- [x] **Track: T25 Assistant 上下文收窄(limited scope):分层披露,起点用事实** *Link: [tracks/archive/t25-assistant-scoped-context_20260825/index.md](./tracks/archive/t25-assistant-scoped-context_20260825/index.md)*
- [x] **Track: T29 在场与处境(presence & situation):人机同源的处境事实层(前置架构)** *Link: [tracks/archive/t29-presence-situation_20260825/index.md](./tracks/archive/t29-presence-situation_20260825/index.md)*
- [x] **Track: T23 项目治理：规则基线 GR1–GR5、依赖方向与例外登记、未发布窗口兼容性清理、文件/模块大小门禁，类 TDD 红绿执行并入 pnpm check** *Link: [tracks/archive/t23-project-governance_20260825/index.md](./tracks/archive/t23-project-governance_20260825/index.md)*
- [x] **Track: T1 工程基建:pnpm monorepo + Next.js 壳 + Postgres docker compose + 测试基座** *Link: [tracks/archive/t1-infra_20260821/index.md](./tracks/archive/t1-infra_20260821/index.md)*
- [x] **Track: T2 业务平面基线:引擎 + 事件日志 + Siren 合同 + 双 driver + 聊天 + 表单(B1–B4, I1/I5/I6)** *Link: [tracks/archive/t2-business-plane_20260821/index.md](./tracks/archive/t2-business-plane_20260821/index.md)*
- [x] **Track: T3 确认门切片:guard 挂起 + pending 实体 + Cedar 风险策略 + Temporal notify + 收件箱(S1, I4)** *Link: [tracks/archive/t3-confirmation-gate_20260821/index.md](./tracks/archive/t3-confirmation-gate_20260821/index.md)*
- [x] **Track: T4 最小 meta 切片:定义入日志 + lifecycle 自举 + 激活不变式 + 机械 diff + BIOS(S2)** *Link: [tracks/archive/t4-minimal-meta_20260821/index.md](./tracks/archive/t4-minimal-meta_20260821/index.md)*
- [x] **Track: T5 委托实体切片:Temporal workflow 即委托实体(并发裁决/崩溃续跑/N 路并行/舰队页)(S3)** *Link: [tracks/archive/t5-delegation_20260821/index.md](./tracks/archive/t5-delegation_20260821/index.md)*
- [x] **Track: T6 plan-exec 切片:一次决策批量裁决(S4)** *Link: [tracks/archive/t6-plan-exec_20260821/index.md](./tracks/archive/t6-plan-exec_20260821/index.md)*
- [x] **Track: T7 骨架与渲染切片:词汇表 + binding-only 渲染器 + A2UI 画布 + 骨架五面(S5, I2, I3)** *Link: [tracks/archive/t7-rendering_20260821/index.md](./tracks/archive/t7-rendering_20260821/index.md)*
- [x] **Track: T8 验收收口:不变量持续套件 + 全量重放 + 双执行者 + demo 清单 + 终审 review + DONE 报告** *Link: [tracks/archive/t8-acceptance_20260821/index.md](./tracks/archive/t8-acceptance_20260821/index.md)*
- [x] **Track: T9 前端体验重构:shadcn 设计基座 + 统一页面壳 + 逐页重构 + Tremor/react-chrono 退出** *Link: [tracks/archive/t9-frontend-overhaul_20260821/index.md](./tracks/archive/t9-frontend-overhaul_20260821/index.md)*
- [x] **Track: T10 Application 切片:定义平面实体 + sitemap 分组投影 + agent 两层发现(D19 路线 T1)** *Link: [tracks/archive/t10-application_20260822/index.md](./tracks/archive/t10-application_20260822/index.md)*
- [x] **Track: T11 agent 可观测性与蒸馏留痕:结构化轨迹 + agent-decision 审计 + 思考流(GLM-5.3 探针)** *Link: [tracks/archive/t11-agent-observability_20260822/index.md](./tracks/archive/t11-agent-observability_20260822/index.md)*
- [x] **Track: T12 渲染增强:render LLM 路径接线 + 页面级实体缓存** *Link: [tracks/archive/t12-render-llm-cache_20260822/index.md](./tracks/archive/t12-render-llm-cache_20260822/index.md)*
- [x] **Track: T13 meta 可视化 + capability 定义面:flow 拓扑图 + definition-versions 两版对比 + capability 注册表与 capability-registered(D19 路线 T4)** *Link: [tracks/archive/t13-meta-visualization_20260822/index.md](./tracks/archive/t13-meta-visualization_20260822/index.md)*
- [x] **Track: T14 walkthrough 修复:数据契约 + 画布韧性 + 人类可读性(walkthrough 问题 #1–#14)** *Link: [tracks/archive/t14-walkthrough-remediation_20260822/index.md](./tracks/archive/t14-walkthrough-remediation_20260822/index.md)*
- [x] **Track: T15 AI-first 动态助手:多轮理解、合同治理与 U1–U23 用户故事 Eval 闭环** *Link: [tracks/archive/t15-ai-first-dynamic-assistant_20260822/index.md](./tracks/archive/t15-ai-first-dynamic-assistant_20260822/index.md)*
- [x] **Track: T16 Presentation Plane:Chat 薄 Request、Application Recipe 预生成、用户级跨 Session Sidecar fastpath、A2UI/Action/人类优化与 S1–S32/TS1–TS18 验收** *Link: [tracks/archive/t16-semantic-a2ui-sidecars_20260823/index.md](./tracks/archive/t16-semantic-a2ui-sidecars_20260823/index.md)*
- [x] **Track: T17 External Agent CLI 与 Governed Draft Ingress:第三方 Agent 业务操作、应用完善、SubmissionPolicy、系统内 Draft 缓冲、human approval 与 U1–U24/TS1–TS20 验收** *Link: [tracks/archive/t17-external-agent-cli-drafts_20260823/index.md](./tracks/archive/t17-external-agent-cli-drafts_20260823/index.md)*
- [x] **Track: T18 Coding Capability Executor Host:通用 Coding Agent 执行器、workspace backend、capability-run、Codex reference、结果治理与 U1–U22/TS1–TS18 验收** *Link: [tracks/archive/t18-coding-capability-executors_20260823/index.md](./tracks/archive/t18-coding-capability-executors_20260823/index.md)*
- [x] **Track: T19 Specialized Agent Contracts:基础 Agent 经 Prompt、Task/Result、Runtime/Tool/Policy 合同派生 Coding/Writing 等特化 Agent，并支持 Agent Definition Draft、人类激活与 U1–U26/TS1–TS20 验收** *Link: [tracks/archive/t19-specialized-agent-contracts_20260823/index.md](./tracks/archive/t19-specialized-agent-contracts_20260823/index.md)*
- [x] **Track: T20 Meta Human Control Plane:Meta sitemap 驱动发现、Application/Agent Definition/Draft 人类治理闭环、优雅任务视图、scope/action 安全与 U1–U22/TS1–TS18 验收** *Link: [tracks/archive/t20-meta-human-control-plane_20260823/index.md](./tracks/archive/t20-meta-human-control-plane_20260823/index.md)*
- [x] **Track: T21 Assistant 双焦点事实与 AI-first Presentation 一致性:保留 lastNavigation/clientView、LLM 冲突理解、多步呈现回答与协议失败安全** *Link: [tracks/archive/t21-assistant-dual-focus_20260823/index.md](./tracks/archive/t21-assistant-dual-focus_20260823/index.md)*
- [x] **Track: T37 应用默认展示治理:导航合同修复(流→产物正向链接、全通道归属)+ 默认落点组合化(T30 组合机器消费;agent 浏览器视觉审核 U1–U5,覆盖三应用流程)** *Link: [tracks/archive/t37-app-default-composition_20260829/index.md](./tracks/archive/t37-app-default-composition_20260829/index.md)*
- [x] **Track: T38 集合查询治理:合同层分页(无参数全量承诺)+ 声明式过滤 + 实体显示 hint(声明式概览列);agent 浏览器视觉审核 US1–US6,全应用横扫** *Link: [tracks/archive/t38-collection-query-governance_20260829/index.md](./tracks/archive/t38-collection-query-governance_20260829/index.md)*
