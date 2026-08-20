# T2 业务平面基线 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 commit 短 SHA)。

## Phase A: 引擎核心(@ui4a/engine,纯单测 TDD)

- [x] Task: machine-as-JSON 类型与解析(flow/node/action/field-definition 类型;XState v5 createMachine 运行时构造与转移校验) `4f5e109`
- [x] Task: 三层裁决器(TDD:声明→guard→schema 每层拒绝/通过矩阵;拒绝带结构化原因) `8812b96`
- [x] Task: guard 谓词注册表(shared 放谓词实现,engine 只持注册表)与效果词汇表(TDD:transition/set-field/append;spawn stub 记事件) `50381e4`
- [x] Task: Siren 投影器(TDD:rel→实体四件组装 properties/actions/links/guard-results;集合 entities[] 子实体;子实体直达链接) `2c84e94`
- [x] Task: sitemap 推导(TDD:从 flow 常量生成界面清单/拓扑/节点 action schema/版本号) `dee2602`
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) `4f01f11`
  [checkpoint: 4f01f11]

## Phase B: 事件日志与投影重放(PG)

- [x] Task: events 表与 appendEvent(TDD:单调 seq、append-only(UPDATE/DELETE 被拒)、字段完整) `c4e9d0f`
- [x] Task: fold 投影(TDD:日志→实体状态;拒绝事件参与投影但不改状态) `16e3ff2`
- [x] Task: I5 重放测试(TDD:跑种子操作序列→hash;空库重放→hash 一致) `77b2294`
- [~] Task: /api/events 只读端点(TDD:seq 有序、含拒绝事件与 reason)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: HTTP 合同与种子域

- [ ] Task: /api/entity(TDD:已知 rel 200 Siren;未知 rel 404;guard-results 注入)
- [ ] Task: /api/exec(TDD:通过→效果+事件+新状态;三层各拒绝→4xx 结构化原因与日志一致)
- [ ] Task: /.well-known/ui4a.json sitemap 端点(TDD:结构与版本)
- [ ] Task: 种子域与种子数据(article-drafting 三步向导/post-status/comment-moderation;2 文章+3 pending 评论;启动时幂等 seed)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: rule driver 与 agent 循环(E2E B1–B3)

- [ ] Task: agent 循环协议(TDD:navigate/exec/done 步进、停止条件、拒绝即数据回流)
- [ ] Task: rule driver 决策器(TDD:目标相关性四层级次序与各层停止条件;done=完成类动作成功过)
- [ ] Task: E2E B1/B2/B3(Playwright request 级:跑循环断言业务结果与日志)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase E: LLM driver 与悬浮聊天(B4、I1)

- [ ] Task: LLM driver(TDD:工具投影生成器(动词5+动态动作工具,guard 嵌 description);GLM 端点接入 createOpenAI;无 key 回退 rule)
- [ ] Task: 聊天路由与悬浮窗(服务端跑 agent 循环,轨迹流式进对话;assistant-ui 悬浮组件)
- [ ] Task: E2E B4(坏 key→401 原文进对话、后续轮次存活)+ I1(无 key 环境 B1–B3 全过)
- [ ] Task: RUN_LLM_E2E 冒烟(标记 skip-unless-env;编排者验收时手动跑)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase F: :form runner 人类路径(双执行者走查)

- [ ] Task: 实体通用渲染页(TDD:actions→RJSF 表单/按钮;guard-results 驱动 disabled;提交走 /api/exec actor=human)
- [ ] Task: 入口页(文章列表/评论队列/发布向导入口;极简样式)
- [ ] Task: Playwright UI E2E:人类路径 B1/B2/B3(表单走查全过;日志含 actor=human)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)
