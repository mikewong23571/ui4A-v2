# T60 Evidence

2026-09-07，通过 home PostgreSQL 只读查询核实：

- 会话：d334af87-7d2e-44fa-b694-3a63b12c5da8。
- 用户创建消息 seq1438，回合 443d7e94-7eba-486e-9dea-935430e2248b。
- thread-created seq1447/1458/1466，actor=agent，同一授权消息、同一 quote。
- chat-turn seq1478：navigate → create → create → create → clarify。
- 决策 seq1475/1476 已披露之前的成功执行；三次不是 HTTP 自动重试。
- 决策 seq1486（下一轮否认）没有创建审计；披露的八条执行全部为该 principal
  之前的人类操作，最近止于 seq1342。
- projectExecutionAudit 只识别 action-executed / confirmation，漏掉 thread receipt；
  conversation dialogue 只重放 user/assistant 原话，不包括工具执行轨迹。
- withObservedClientParams 每个模型 exec 提议重新 randomUUID；HTTP 断线重试本身复用 payload。

诊断不支持“本次 sessionId 串线”的结论；已证实的是命令身份与执行上下文缺口。

## 本地验证

- Red：真实 kernel 三次出生（期望一次）；thread audit 返回空（期望四类记录）；
  session s1 错收 s2 的最近执行。
- Green 初验：5 文件、11 测试通过，包含既有 transport retry 与 confirmation audit。
- GR3：chat 目录新增会话关联后为 4023 行，按历史投影职责将 audit-context 与对应测试
  移至既有 chat/history 子域；未削减功能或测试。
- 完整纳入新增测试后 engine/execution 为 4055 行，按执行审计职责将实现与两份测试
  移至 execution/audit，公共 engine barrel 保持同一导出；常驻验收索引同步新路径。
- 最终 focused：8 文件、24 测试通过；local turn identity：6 测试通过；governance 通过。

## 真实模型

常驻用例：e2e/eval/working-context.spec.ts 的
`chat creates one work thread and recalls its own execution on the next turn`。
配置来自本机既有 .env.local，不复制 secret；数据库固定 ui4a_test。

```sh
RUN_LLM_EVAL=1 DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test \
TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test \
node scripts/with-local-env.mjs pnpm exec playwright test \
  --config=playwright.eval.config.ts --project=working-context \
  --grep 'chat creates one work thread' --retries=0
```

- 首跑 54.8s：出生一次，下一轮承认创建。但回答暴露 local GET principal 默认 local-user，
  创建 principal=user:session；且把审计字段当成实体 pointer。没有按退出码直接宣告验收。
- 修正 local transport 与审计引用说明后，增强测试并复跑：27.4s，1 passed。
  一次出生，下一轮 answered，零新增业务事件，集合 count=1；三条引用均真实 HTTP 回读。
- 回答摘录：“根据执行记录：我创建了 1 条工作线……创建动作是由我（agent）执行、
  经你授权……本轮只读，未再创建。”原模型措辞仍有 identity/open 等内部语言残留，
  不将本 Track 宣称为全面对话表达质量收口。
- 原始事故只读重放：使用 seq1486 保存的当时实体观察、原始 user/assistant 消息
  （包含错误总结）及由 seq1447/1458/1466 重建的执行审计，经配置的真实模型 decide。
  未提供业务执行 transport，结果为 answer；明确承认一次指令被重复执行三次。
  结果见 [incident-replay.json](./incident-replay.json)。这是历史观察重放，不是线上已发布复验。

## 收口门禁

- `pnpm check`：exit 0；类型检查、ESLint、governance:strict 通过；612 文件通过，
  4464 tests passed / 15 skipped（8 files skipped），93.04s。
- `CI=true pnpm e2e chat.spec.ts`：7 passed，15.1s，含 session 双轴、新会话与失败恢复。
- `git diff --check`：通过。未增加依赖、数据库 schema 或事件类型。
- 验收由编排 agent 按 workflow 自治代行。常驻回归已进入普通 unit 与现有 real-LLM
  working-context suite；临时历史重放脚本不留在仓库。
- 完成范围：本地修复与验证。未 push/部署，未修改三条生产工作线，未改变线上事件。
- 剩余边界：命令身份复用仅覆盖同一 run 内声明 client-owned commandId 的动作；
  新 run、进程恢复、不同参数提议和未声明命令键的动作不由该机制做去重。
  模型回答仍需持续语义验收，不把两次模型实测视为任何措辞的确定性保证。
