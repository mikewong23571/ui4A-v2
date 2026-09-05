# T58 目标工作台：连续两周真实使用与冻结验收

**状态：new；本轮只创建 track，未实施、未发布、未开始两周计时。**
用户目标：应用经过真实使用验证，用起来方便，能承接目标、持续跟踪并支持目标达成，
在最终验证窗口内不再依靠修改 UI4A 代码或临时救火完成工作。

## 自包含执行入口

1. [Spec](./spec.md)：目标、范围、业务要求与 DONE。
2. [Human Feedback](./human-feedback.md)：此前网络第一手反馈、可信度与验证假设。
3. [Design](./design.md)：允许的验证/重构/编码/UIUX redesign、架构与冻结前出口。
4. [Trial Protocol](./trial-protocol.md)：14 天真实计时、冻结边界、样本、指标、失败/重启规则与记录模板。
5. [Plan](./plan.md)：P0–P6、准备期修整、review、冻结、两周使用与终审。
6. [Planning Review](./planning-review.md)：规划自审；不能替代真人使用和实现 review。
7. [Metadata](./metadata.json)：依赖与未开始的试验状态。

必读正典（仓库根）：`AGENTS.md`、`GOAL.md`、`DECISIONS.md`、`conductor/product.md`、
`product-vision.md`、`product-guidelines.md`、`tech-stack.md`、`workflow.md`、`refs/arch-brief.md`。
编辑 Web 前读 `apps/web/AGENTS.md`。部署/回滚前必须重读不入 Git 的 `DEPLOYMENT.local.md`，
不把本 track 当作生产权限、业务 human approval 或凭证授权的替代。

## 依赖与工作范围

- T56 交付本线、材料与协作连续性；T57 交付首页、组件姿态与直接创建来源。
  T58 接手它们**完成且通过 review 的版本**，不并行重做同一功能。
- P0 文档/用户样本准备可先做；产品修整、候选发布和 T0 开始须先完成实际交接。
  registry/metadata 的陈旧状态不能代替提交、plan、review 与运行证据。
- 这是“验证驱动修整 → 冻结 → 真人试用”的收敛 track，允许必要编码/重构/UIUX redesign，
  不等于开放范围地再建一个平台。
- 首轮默认使用者为用户本人 Mike，主要场景为个人/小团队技术负责人的真实开发、调研、验证与评审目标。
  这是单用户可用性验证，不作市场占有率、群体留存或付费意愿结论。

## 给执行 agent 的任务合同

- **Goal**：交付一个冻结候选，经真实连续 ≥336 小时、足够实际工作样本，通过 protocol 的 M1–M8，
  人能独立发起、离开、返回、跟踪、决定、验收；没有 UI4A 产品修补或开发者救援才能完成。
- **Non-goals**：不自动扩授权/审批、不修改业务结果以过关、不造第二状态库/规则助手；
  不用脚本快跑/模拟时间替代两周，不承诺以后永远无需改代码。
- **Changes**：只为发现并复现的范围内阻断/高成本问题做最小修整；每项 GAP 必须有故事、来源、
  根因、修改边界、Red/Green、浏览器证据与 review。正式期只能使用冻结版本。
- **Blast radius**：design 的模块表；生产操作按实际授权和 runbook；其他在途变更保持不动。
- **状态纪律**：所有实施任务当前 `[ ]`。准备完成只叫 ready-for-trial；T0 未开始不得填写日期成果。
  缺真人使用、缺真实经过时间、缺必需样本/反馈都不能完成。

试验报告是观察证据，不是 UI4A 业务真相。目标与结果仍来自应用合同、原始输入、事件和真实产物。
