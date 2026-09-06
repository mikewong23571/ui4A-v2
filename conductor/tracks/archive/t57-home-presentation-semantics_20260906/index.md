# T57 首页工作简报与组件呈现语义

> 2026-09-06 执行修订：用户明确授权在独立 worktree 与 T56 并行实现，覆盖此前等待 T56 完成的串行限制。
> 基线 bf58603d（T56 P3 已提交），worktree `/Users/mike/projs/playground/ui4A-t57`，分支 `codex/t57-home-presentation`。
> 中间执行必要 Red/Green 定向测试；阶段重度/E2E/真实模型/全量验证集中在合并主仓库后执行。
> 合并必须保留 T56 在途修改，先集成其最终提交；未完成统一门禁不标 DONE。


**状态：completed。** 独立worktree实现已合并master；统一验收、修复与实施后复审通过；不包含部署或T58真人试用。

[完成报告](./DONE.md) · [执行证据](./evidence.md) · [最终复审](./review.md)

## 自包含执行入口

1. [Spec](./spec.md)：问题、目标、范围、FR01–FR10。
2. [Architecture Review](./architecture-review.md)：本轮整体结构审查、证据、风险和架构结论。
3. [Design](./design.md)：组件选择、首页处境、来源、探针与改动边界。
4. [Acceptance](./acceptance.md)：US01–US12、隔离 fixtures、门禁与复验步骤。
5. [Plan](./plan.md)：P0–P5、TDD、实施后 review/fix/re-review。
6. [Planning Review](./planning-review.md)：规划自审，不能替代实施验收。
7. [Metadata](./metadata.json)：状态及依赖。
8. [Spike Report](./spike-report.md)：S1–S3 的实证定案与最终接口。
9. [Evidence](./evidence.md) 与 [Review](./review.md)：执行证据和实际 diff 复审。

无需原聊天、个人 memory、线上测试账号或临时示意图即可理解范围。仓库根的 `AGENTS.md`、
`GOAL.md`、`DECISIONS.md` 优先；另读 `conductor/product-vision.md`、`product.md`、
`product-guidelines.md`、`tech-stack.md`、`workflow.md`、`refs/arch-brief.md`。
编辑 Web 前读取 `apps/web/AGENTS.md` 和版本匹配的 Next.js 本地指南。

## 与 T56 的接手合同

T56 负责**进入一条工作线后**的主面、材料/pin、响应式助手、历史上下文/引用和责任到达。
T57 负责**首页**的注意力组织、通用组件姿态/动作披露、低成本发起及相关机械门禁。
两者共用 generic、ActionGroup、Presentation host、chat 壳与线程读投影，不能同时各造一套。

- 规划时 T56 已提交 P0/D78，plan 有 P1/P2 在进行；metadata/registry 仍写 new，存在状态不同步。
  不能只凭 registry 判断未开工，也不由 T57 改写其他正在执行的 track。
- 用户后续授权覆盖原串行依赖：T57 从 T56 P3 提交 bf58603d 独立实施，再集成其 P4.1/P4.2。
  T56 在途修改由原 agent 负责；合并前检查 clean 状态，冲突保留双方故事与新创建合同。
- 统一验收覆盖双方共用模块；不由 T57 改写或关闭 T56，不降低 T57 自身验收。

## 给 coding agent 的任务合同

- **Goal**：首页可看清当前可见责任、继续工作和发起入口；列表/决定卡/表格/表单按任务语义选择；
  内容来自同一合同与 Presentation，换 application 不改通用 UI。通过所有 FR/US/G 与最终复审。
- **Non-goals**：不做新仪表盘框架、布局 DSL、业务状态库、规则助手、全站换皮、部署或线上数据清理。
- **Changes**：先验证 P0 三个不确定边界并登记决定，再补呈现语义/门禁、首页与输入宿主，最后验证。
- **Blast radius**：以 design.md 模块表为准；不改 T56 在途文件，不扩散到 worker/runner 执行体系。
- **治理**：Red→Green→Gate；贴限模块按功能拆，不删功能或测试凑行数；仅提交本 track 变更。
- **Review**：规划自审已落盘；实施后必须另审实际 diff、运行证据和截图，修复后复审再完成。
