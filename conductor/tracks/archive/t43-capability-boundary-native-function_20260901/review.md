# T43 Principal Engineering Review

## 结论

初审发现 1 个 Critical、7 个 High/Medium 合同缺口；均已在 `a3ebf0d` 内闭环。修复没有增加
新的 Run、权威存储或 Application/Capability 名称分支，依赖方向和 D59 的 Capability Port / Adapter
边界保持不变。

## Findings 与处置

| Severity | Finding | Resolution |
|---|---|---|
| Critical | 公开 `/api/exec` 与 exec-plan 可直接命中隐藏的 capability callback Action | `judge` 新增 trusted ingress 声明门；HTTP body 不能构造该字段；Agent/Function callback 由受保护组合显式注入 |
| High | 非法 success output 在 Web 二次验证时返回 422，实体永久停留进行中 | 非法 output 归一化为稳定 `output-invalid` failure，并经声明的 `on-error` 重新裁决、原子落 receipt |
| High | reconciler 遇 already-started Workflow 会阻塞后续 orphan | start 写 invocation hash memo；仅 hash 对齐的 already-started/completed 视为幂等成功 |
| High | 并发 callback 可在队列外同时 miss receipt，第二次形成 collision/500 | engine 串行队列内二次读取 receipt；DB collision 后读取胜出 terminal 并返回结构化幂等/冲突结果 |
| High | `kind=effect` 可绕过 T43 对外部 effect 的延期决定 | 激活门明确拒绝 Native Function external effect，等待后续幂等协议 |
| High | raw Function receipt 可跨 Application grant 读取 | receipt 的 audit rel 指向业务 source rel；production events feed 对每条 rel 使用 D51 audience predicate |
| High | Governed Draft 的注册表缺失 Native Function profile/availability | Draft 与 Meta activation 共用 combined executor 与 Native Function availability registry |
| Medium | JSON Schema 仅在运行时编译，非法/超预算 schema 可激活 | 激活时完成 bounded schema budget 与 Ajv compile |
| Medium | Profile payload/timeout/retry 合同不能被 birth 身份完整证明 | input/output ceiling 与实现对齐；limits/network hash 固定进 birth、identity 和 receipt |
| Medium | service 没有把 artifact-ref 接入真实 binder | 只选择 action 参数显式引用、且 source entity 相同的已物化 artifact 内容 |
| Medium | 第二 Capability 只证明 prepare，没有证明激活/执行 | 增加 activation gate 与第二 handler 执行证据 |

## 复验

- focused review regressions: 79 passed；扩展 DB/Agent 回归集合: 97 passed。
- unit project: 397 files passed / 3128 tests passed；3 files、5 tests skipped。
- DB project（`UI4A_WORKER_HEALTH_PORT=3199`）: 93 files passed / 555 tests passed；1 file、1 test skipped。
- real Temporal durability: 2 passed，覆盖 Worker SIGKILL recovery 与 cancellation。
- `pnpm format:check`、`pnpm governance`、`pnpm -r typecheck` 全绿。

最终 `pnpm check`、E2E 与运行态复验记录在 closure evidence 中。
