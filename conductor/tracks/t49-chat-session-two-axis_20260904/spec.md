# T49 聊天会话双轴:principal 所有权 × sessionId 会话 — Spec

> Track ID: `t49-chat-session-two-axis_20260904` · Type: Bug(含架构决策 D68)· 状态: approved
> 审批口径:按 workflow「自治编排协议」(2026-08-21 授权)由编排 agent 代行审批;决策与验收证据经 git notes 与本 track 文档事后可审计。

## Overview

**症状**:生产部署(UI4A_DEPLOYMENT_PROFILE=production)下,前端聊天「历史会话」清单永远只有一条会话;「新会话」按钮只清空 UI,Assistant 仍带着旧会话的全部上下文继续跑。

**根因链**(2026-09-04 调查确认):

1. `apps/web/src/app/api/chat/route.ts:211-212` 在生产模式下把客户端传入的 sessionId 强制替换为认证 principal:`const sessionId = productionIdentity?.principal ?? parsed.sessionId`。所有 chat 事件落库为 `rel=chat:<principal>`、`sessionId=<principal>`。
2. 读侧 `/api/chat/sessions` 先按 principal 过滤事件、再按 sessionId 分组——写侧两轴已折叠为一轴,分组结果恒为 1。
3. 该折叠引入于 `c18eaadc`(2026-08-24,"feat(auth): wire experimental agent credentials");T22 evidence 仅以观察口吻记录"turn 事件落库(sessionId=credential sub)",未作为产品决策记入 DECISIONS.md。T9 时代建立的多会话 UI(新会话/清单/切换)从未按新现实收口。
4. 附带缺陷:`loadAgentConversation`(回合前的 agent 会话上下文装配)经 `readLog` 读全量事件,`conversationView` 只按 `rel=chat:<sessionId>` 过滤、**不按 principal 过滤**(conversation.ts:108)。一旦 sessionId 恢复为客户端自报值,跨 principal 的 sessionId 碰撞可污染他人 agent 上下文——必须随本修复一并收敛。

**定性**:按 principal 隔离读写是正确的安全设计(保留);把 sessionId 整个折叠成 principal 是实验性认证接线中的实现捷径(修正)。本 track 将两轴解耦,并以完整用户故事(U1–U10)作为验收闭环。

## Decision(D68,随 Phase 1 落入 DECISIONS.md)

**聊天会话双轴模型:principal 是唯一所有权/授权轴,sessionId 只是会话分组键。**

1. **sessionId(会话轴)**:客户端铸发(现行为 `crypto.randomUUID()`,use-chat-session.ts:353)或服务端代铸(缺省时,request-body.ts:77 已有)。服务端只做输入卫生校验:有界字符集 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`(覆盖 UUID、既有本地测试 fixture 如 `i1-e2e`);缺省 → 服务端代铸 UUID v4;存在但非法 → 400 结构化拒绝。**生产模式下 sessionId 绝不参与身份推导**。
2. **principal(所有权轴)**:生产 = 认证主体(`productionIdentity.principal`,T22「不信任客户端自报身份」立场不变);本地 demo = `user:<sessionId>`(T2/T9 既有口径不变)。一切 chat 事件写入:`principal=<所有权轴>`、`rel=chat:<sessionId>`。
3. **读侧三路全按 principal 过滤,sessionId 仅作组内分组/选择键**:`/api/chat/sessions`、`/api/chat/history`(已按 principal 过滤,锚定即可)与 `loadAgentConversation`/`conversationView`(补 principal 过滤,修复碰撞污染面)。
4. **测试意图迁移**:`route.production-auth.test.ts` 的 forged-root 断言(客户端自报 sessionId 绝不出现于任何可观面)原生于 sessionId 即身份的实验期;D68 下合法自报 sessionId 作为分组键落库/回显是**预期行为**,安全断言迁移为「伪造值绝不进入任何身份绑定字段(principal),事件 principal 恒为认证主体」。
5. **旧数据诚实投影(GR2)**:不写兼容/迁移路径。已落库的 `sessionId=<principal>` 旧事件自然投影为一条以 principal 字符串为键的历史会话行;生产客户端 localStorage 中的旧 principal 形状值(字符集合法)继续作为该旧会话的延续,用户点「新会话」即获得新会话。不回填、不改写、不双轨。
6. **语义统一**:本地与生产对同一套用户操作(新会话/清单/切换/刷新)行为一致;「新会话」在两个 profile 下都同时重置 UI 与 agent 上下文。

## Functional Requirements

### FR1 sessionId 输入合同(request-body)

- 缺省 → 服务端代铸 UUID v4(既有行为,保留)。
- 存在 → 必须匹配 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`,否则 400 结构化错误(可行动原因,不 5xx)。
- 校验是纯函数,双 profile 同一实现,不出现 profile 分支。

### FR2 写侧解耦(route)

- 生产:`sessionId = 校验后的请求值`,`principal = productionIdentity.principal`;删除 `sessionId = principal` 折叠。
- 本地:`principal = user:<sessionId>` 不变。
- inline/delegated/render 三种回合的 chat 投影事件(chat-turn-started/progress/chat-turn、chat-message-appended、chat-context-updated、chat-navigation-completed)全部携带解耦后的两轴;SSE `session` 帧与 final/render/JSON 回执的 sessionId 为解耦后值(客户端持久化自愈链路既有,锚定即可)。

### FR3 会话上下文装配双键收敛

- `loadAgentConversation` 改为按 principal 过滤的事件读(`listEvents` principal 过滤,不再 `readLog` 全量),`conversationView` 在 (principal, sessionId) 双键下装配。
- `executionAuditContext` 与会话装配同源喂数(一次过滤读,两投影共用),principal 口径不变。

### FR4 会话清单/历史投影

- `/api/chat/sessions`:同 principal 下按 sessionId 分组多行,按 lastTs 倒序;跨 principal 不可见(既有逻辑,补锚定测试)。
- `/api/chat/history?sessionId=`:仅返回该 principal 名下该 sessionId 的回合。

### FR5 「新会话」完整语义

- 「新会话」后,UI 清空且下一轮 `loadAgentConversation` 对新 sessionId 返回空会话(近期原文与结构化 context 均不含旧会话回合);生产与本地一致。

### FR6 旧数据诚实投影

- 升级前已落库的 principal 键回合在清单中保留为一条可读会话行;无迁移、无改写、无双轨(GR2)。

## Non-Functional / 不变量

- 服务端零会话态不变:会话仍是客户端对事件日志的投影(不引入会话注册表/会话生命周期端点)。
- 不触碰 I1–I7;不改变 Presentation Sidecar 的 durable key 合同(禁 sessionId 的口径仅约束 Presentation,D28/D51 不动)。
- GR1–GR5:`packages/db`、`packages/engine` 零改动(纯内核与存储合同已足够);新逻辑落位 `apps/web/src/chat/`(route.ts 有效行 ≈460/500,余量 ≈40,只做替换式修改);例外注册表保持为空。
- 爆炸半径:`apps/web/src/chat/*`、`apps/web/src/app/api/chat/*`、`apps/web/src/components/chat/*`(如需)、`e2e/chat.spec.ts`、`DECISIONS.md`、`conductor/tracks/t49*`。禁改:worker、engine、db、CLI、Meta、Presentation。

## Acceptance Criteria

1. **用户故事闭环**:U1–U10(见 [user-stories.md](./user-stories.md))逐条通过,每条故事在 plan.md 中有具名自动化锚点(单测/路由测试/组件测试/E2E);无裸奔故事。
2. **机械门禁**:`pnpm check` 全绿(含 governance:strict,例外注册表为空);`CI=true pnpm e2e` 全绿。
3. **系统可运行**:按自治验收协议实际启动系统完成用户路径验证(e2e 即用户路径,本地 profile 全覆盖;生产行为由 route 级测试锚定)。
4. **决策留痕**:D68 已入 DECISIONS.md;本 track evidence 记录测试→故事映射与验证命令原文。

## Out of Scope

- 会话重命名、归档、删除、置顶、搜索;会话条数上限与清理策略。
- 会话级 presence/thread 语义(thread 归 principal 属工作投影,不随会话切换,维持现状)。
- 限流/配额(客户端可自造 sessionId 属既有威胁面,与本 track 无关)。
- CLI/Agent 侧会话 UI;旧数据迁移或改写(GR2 明确不做)。
