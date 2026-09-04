# T49 聊天会话双轴:principal 所有权 × sessionId 会话 — Plan

> 执行纪律:严格 TDD(先红后绿);每任务完成即 commit + git note;Phase 结束跑
> Phase Checkpoint(workflow.md;审批点由编排 agent 按自治协议代行,验证证据记入
> git notes)。GR1–GR5 全程生效;GR3 红线现状:route.ts ≈460/500(余量 ≈40,只做
> 替换式修改,新逻辑一律落 `apps/web/src/chat/`)、conversation.ts 320/500、
> session-events.ts 172/500、request-body.ts 83/500;例外注册表保持为空。
> 故事验收入口:[user-stories.md](./user-stories.md);每任务标注覆盖故事(U#),
> U1–U10 全部闭环方可 DONE。
> Subagent 派发遵守自治编排协议四要素(Goal/Non-goals/Changes/Blast radius);
> subagent 遇治理失败只如实报告,不自行裁剪(D53)。

## Phase 0 — 决策先行(先记录,再动代码)

- [x] Task: DECISIONS.md 落盘 D68(spec §Decision 全文:双轴模型/sessionId 输入合同/读侧三路 principal 过滤/forged-root 测试意图迁移/旧数据诚实投影) [U1–U10] [a2f2772]
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: a2f2772]（自治验收:Phase 0 仅 DECISIONS.md 非代码变更,governance OK 复跑绿;无代码文件需测试覆盖）

## Phase 1 — 请求体合同:sessionId 输入卫生(FR1 · U5/U10)

- [x] Task: request-body.test.ts 先红——缺省代铸 UUID v4(既有)、合法字符集 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` 通过、非法(超长/非法字符/空串)→ 400 结构化错误;校验为纯函数、零 profile 分支 [U5/U10] [3a7009e]（红 8 例→绿 19/19）
- [x] Task: request-body.ts 实现校验(替换式修改;不引入 UUID-only,保住本地 fixture 如 `i1-e2e`) [U5/U10] [3a7009e]
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: 3a7009e]（自治验收:编排 agent 复跑 19/19 + tsc + eslint + governance 全绿;改动文件均有对应测试;e2e fixture 'session:a' 含 ':' 合法)

## Phase 2 — 会话装配双键收敛(FR3 · U2/U7)

- [ ] Task: conversation.test.ts 先红——双 principal 同 sessionId 碰撞:conversationView 只装配请求 principal 名下事件;loadAgentConversation 对同 principal 新 sessionId 返回空会话 [U2/U7]
- [ ] Task: session-events.ts — loadAgentConversation 由 `readLog` 全量改为 `listEvents` principal 过滤读,conversationView 与 executionAuditContext 同源喂数(principal 过滤一次、两投影共用) [U7]
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 3 — 生产路由解耦:写侧两轴分离(FR2 · U1/U2/U5)

- [ ] Task: route.production-auth.test.ts 先红——同 principal 两个 sessionId 各一回合 → 事件落两组 rel、principal 恒为认证主体;forged 用例语义迁移(伪造 principal 形状 sessionId 只作分组键,绝不进身份字段);缺省 sessionId → 代铸 UUID 经 session 帧下发 [U1/U5]
- [ ] Task: route.ts 解耦——删除 `sessionId = productionIdentity?.principal` 折叠(211 行),principal 保持 `productionIdentity?.principal ?? user:<sessionId>`;delegated 回执落请求会话(sessionId 解耦值) [U1/U2/U5]
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 4 — 读端点投影锚定(FR4/FR6 · U1/U6/U8/U9)

- [ ] Task: sessions/history route tests——同 principal 多 sessionId 多行(lastTs 倒序、回合数聚合);跨 principal 不可见(空态非错误);混合旧形状(sessionId=principal)与新 UUID 事件的并存投影 [U1/U6/U8]
- [ ] Task: 审计口径锚定——同 principal 全量 chat 事件可查,actor/principal/channel 口径断言复用既有 credential 用例(不松动 T22 语义) [U9]
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 5 — 前端与用户故事闭环(FR5 · U1/U2/U3/U4/U8/U10)

- [ ] Task: use-chat-session/floating-chat 组件测试——新会话语义(消息清空、不回放旧会话、principal 不变 sessionId 换新)、清单多行、selectSession 重放不串台 [U1/U2/U3]
- [ ] Task: e2e/chat.spec.ts——本地 profile 全路径:两轮对话 → 新会话一轮 → 清单两行 → 切换旧会话重放并继续(指代可解析)→ 新会话上下文干净;刷新重放回归(含 running 轮询);预置 principal 形状旧事件验证并存 [U1–U4/U8/U10]
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 6 — 收口:门禁、系统验证与 DONE

- [ ] Task: 全量门禁——`pnpm check`(含 governance:strict,例外注册表为空)+ `CI=true pnpm e2e`;实际启动系统完成用户路径验证(自治验收协议;本地 e2e 即用户路径,生产行为由 route 级测试锚定) [U1–U10]
- [ ] Task: evidence 文档——故事→测试→命令映射与验证输出原文;registry 勾选;GOAL.md 如需修订
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## 故事 → 阶段映射(验收闭环总表)

| 故事 | 锚定阶段 | 自动化锚点 |
| --- | --- | --- |
| U1 多会话并存 | P3/P4/P5 | 路由测试 + sessions 分组测试 + 组件/E2E |
| U2 新会话干净上下文 | P2/P3/P5 | 装配测试 + 路由测试 + 组件测试 |
| U3 切换旧会话继续 | P5 | 组件测试 + E2E |
| U4 刷新续会 | P5 | E2E 回归 |
| U5 自报 sessionId 不构成身份 | P1/P3 | 校验单测 + 路由测试(代铸/伪造/400) |
| U6 跨用户不可见 | P4 | 双端点路由测试 |
| U7 碰撞不污染上下文 | P2 | 装配测试 |
| U8 旧数据诚实投影 | P4/P5 | 混合投影测试 + E2E 预置 |
| U9 审计口径不回退 | P4 | 全量查询 + actor 口径断言 |
| U10 双 profile 同语义 | P1/P3/P5 | 纯函数单测 + 本地 E2E 与生产 route 测试同构 |
