# T55 DONE:架构治理落地(审查结论 → 决策 → 门禁 → 重构)

- 完成:2026-09-05;类型:remediation;验收协议:workflow.md 自治编排(编排 agent 代行)。
- 输入:arch-review-2026-09-05.md(v2,双重审核);本目录 spec.md(AC-0–AC-6)。
- 证据:每 Phase checkpoint 的 git notes(commit + 验证命令 + 输出摘要)为三元证据主档;本文件为汇总索引。

## AC 证据索引

| AC | 内容 | 关键 commit | checkpoint |
| --- | --- | --- | --- |
| AC-0 | 事实复核(环/route.ts/测试清单/贴限占比/D52 原文)+ D75/D76/D77 入 DECISIONS | 9edbdd9f | 9edbdd9 |
| AC-1 | GR2 中文词形(33 存量=27 改写+6 登记)、相对 import 逃逸检测(t22 改声明依赖)、fsReadDisclosures 披露、check-size 测试/非测试分列(definition 非测试 1134 精确) | 5e6a0d20 / 316f186f / dae74a92 / 1f69a8dc | 1f69a8d |
| AC-2 | AGENTS.md 补 agent-runner(引 D34/D36);arch-brief §8.1 陈旧路径修正;grep 零残留 | e3bd2031 | e3bd20 |
| AC-3 | chat POST 四段重构:route.ts 有效行 47(≤200)/ POST 体 41(≤150);9 测试断言零删除;e2e chat.spec 7 passed | 269fe4c8 | 269fe4c |
| AC-4 | ExecOutcome/EngineRuntime 类型下沉 service-outcome.ts;exec 六段归位(exec/coding-result/spawn/event-log/confirmation);service.ts 497→211;service 相关环 7→0;service-tests 113 全绿 | 8fd9ddfa | 8fd9ddf |
| AC-5 | t22 工作流文件迁 scripts/t22/(D77);.next* 根 5→2(pnpm next:recover-roots 演示,释放约 1.2GB) | 85ba2470 | 7457088 |
| AC-6 | 复测报告 + arch-review 落地表;GR5 全部常驻晋升;pnpm check(4147 测试)+ e2e(79)+ invariants(20)全绿 | 142bc997 / 7457088e | 7457088 |

## 实施期裁定与拆解记录

- D75/D76 各有一条实施期 GR3 拆解修订(chat/post/ 与 engine/exec/ 子域;既有模块零移动,size-baseline 全程为空)。
- D77 批准 t22 位置迁移(修订 D52,范围仅 t22-temporal-probe-workflows.ts 一个文件)。
- Phase 0 复核补正:definition 目录占比 65% 系递归口径误测,直含文件口径 72%/非测试 1134 与 spec 精确吻合(补正记录于 9edbdd9 note)。

## 遗留与移交

- madge 余 1 环:presentation/broker.ts ↔ presentation/app-workspace/authorization.ts(非 service 链路,既有现状,未纳入本 track 范围)。
- 10 个贴限目录(≥90%)持续由 check-size 分列输出可读;A04「测试行主导」结论维持。
- 部署站无涉;本 track 零行为/合同变更(chat 与 service 重构均为行为不变重构,既有测试断言零删除)。
