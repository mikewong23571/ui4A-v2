# T56 工作线工作台重构：目标、责任与共同上下文

状态：**new / 规划完成，未实施**。本轮用户仅授权规划与文档落地，不启动实现、部署或线上数据操作。

## 执行入口

按顺序阅读本目录；无需原聊天、浏览器登录态、个人 memory 或对话内示意图即可实施：

1. [Spec](./spec.md)：目标、范围、业务要求与不变量。
2. [Design](./design.md)：目标布局、事实来源、边界、探针与模块落位。
3. [Acceptance](./acceptance.md)：Given/When/Then、隔离数据、验证命令、证据口径。
4. [Plan](./plan.md)：依赖顺序、TDD、阶段 checkpoint、实现后 review 闭环。
5. [Planning Review](./planning-review.md)：规划复审与已修订的风险；不等于实现验收。
6. [Metadata](./metadata.json)：机器可读状态。

仓库裁判：从仓库根读取 `AGENTS.md`、`GOAL.md`、`DECISIONS.md`、
`conductor/product-vision.md`、`conductor/refs/arch-brief.md`、`conductor/workflow.md`，
编辑 Web 前另读 `apps/web/AGENTS.md`。本 track 摘录必要约束，不能覆盖更高层正典。

## 给 coding agent 的任务合同

- **Goal**：进入工作线即可看懂目标、当前工作与责任；主要对象有足够阅读空间；
  材料、聊天与历史依据指向同一份可追溯事实。通过 acceptance.md 的 US01–US12 与 G1–G7。
- **Non-goals**：不做部署、生产数据整理、全站重设计、工作流引擎改造、自动验收模型、
  新的会话所有权/工作线绑定模型、每应用专页或 LLM 规则替身。
- **Changes**：先执行 P0 的隔离探针和决策；再依次改工作线读投影/呈现、页面壳、
  材料动作、聊天历史与引用呈现；最后完整浏览器验收、review、修复、复审。
- **Blast radius**：以 design.md 的模块表为允许范围。shared/engine 保持纯语义，
  Web 负责 HTTP/授权/呈现适配。不得修改无关 track、生产配置、凭证或 worker 执行语义。
- **Governance**：新功能先 Red 再 Green，再执行对应 Gate。超限按功能拆解，不删功能、
  不删负例、不重新登记债务；P0 重测目录余量。所有业务 mutation 仍走声明→guard→schema。
- **Review**：P0 定案 review 与 P5 实现后 review 都是必需项；测试全绿不自动通过产品体验。

## 状态纪律

当前 plan 所有实施任务保持 `[ ]`。后续每项标 `[~]` 后执行，完成时记录 commit 与证据。
`evidence.md`、`review.md`、`DONE.md` 由实施期产生；不存在不等于通过。
未经实现后 review 与复审，不得完成/归档 track。部署状态单独报告，不以本地通过冒充线上已修复。
