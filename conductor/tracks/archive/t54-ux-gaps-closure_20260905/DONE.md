# T54 深度体验遗留缺口闭环(G01–G15)— DONE

> 完成:2026-09-05。输入与逐缺口证据:[remaining-gaps.md](../../../docs/ux-review/2026-09-05/remaining-gaps.md)、
> [evidence.md](./evidence.md)。自治编排协议执行,全部审批/验收由编排 agent
> 代行,决策留痕于 DECISIONS(D73/D74)与各 commit git notes。

## 结果一览

| 缺口 | 结果 | 关键提交 |
| --- | --- | --- |
| G01 严格策略确认批准 | 本地闭环(D74:批准经 executeMeta 同一事件计划) | 0aa984ab |
| G02 停用响应语义/稳定回执 | 本地闭环(D73:application_deprecated 分型+页面级回执宿主) | ada58d41 |
| G03 知情确认/决定回读 | 本地闭环(rejectedBy 双侧持久化;身份行/resume/decided-by) | 8d973ed8 |
| G04 激活证据时点 | 本地闭环(证据不可得如实;时点明细) | ada58d41 |
| G05 工作区预填 | 本地闭环(探针定位 actions-entity 切片) | 6f698882 |
| G06 业务收尾动作 | 本地闭环;部署站经同形状 Draft(todo done.archive;post offline edit/archive) | fad17ccd |
| G07 材料选择收敛 | 本地闭环(ActionGroup 收敛点+选择器主路径) | 3c5b37f4 |
| G08 处境/标签/通用 UI | 部分(处境读取+时区/标点;标签治理按复现收敛) | fad17ccd/1921d6cc |
| G09 捕捉流程身份 | 本地闭环(bundle role v8;存量按出生版本) | 3c5b37f4 |
| G10 助手注意力 | 部分(引用声明名标签;真实 LLM 项 NOT RUN) | a30eb1bb |
| G11 历史会话状态 | 本地闭环(「上次回合」历史口径) | fad17ccd |
| G12 错误恢复 | 保留开放(三类故障态定向复现未执行,零无证据修复) | — |
| G13 审计过滤 | 本地闭环(domain/kind 过滤+游标+空态) | fad17ccd |
| G14 message 引用 | 本地闭环(principal 受约束只读投影) | bbef6eb0 |
| G15 视觉/说明 | 部分(语义定型后小修;断点走查归部署站) | 1921d6cc |

## 全量门禁(终验,全部亲跑)

- `pnpm check`(typecheck + eslint + governance:strict + vitest)→ 4097 passed / 15 skipped / 0 failed
- `CI=true pnpm e2e` → 79 passed / 26 skipped / 0 failed
- `CI=true pnpm e2e invariants` → 20 passed / 8 skipped / 0 failed
- `CI=true pnpm eval:llm` → 16 skipped(provider 未配置;G10 真实 LLM 项 NOT RUN,先例 T39 US19)

## 决定与裁定

- **D73**:停用面 403 族细化 `application_deprecated`(D71.3 尾句修订)。
- **D74**:Meta 确认批准经同一 executeMeta 事件计划,伴随事件入决定事务。
- born-version 边界(G06):新动作仅对激活后出生实例;存量迁移需另立受治理决定。
- 本地浏览器门限制(G01):默认策略下 human 直通/agent 前置拒,pending 无法在
  本地 e2e 自然产生——服务层 db 测试为覆盖,严格策略浏览器复验归部署站。

## 遗留(如实)

- 部署站复验批次(P1 原故事+G05/G07/G09 主故事+G13 过滤+G10 真实 LLM+G15
  断点走查;部署 SHA/digest 与截图):待用户按 DEPLOYMENT 流程发布(先例
  T51 US7/T52 US7)。
- G08 主读面标签治理、G10 当轮重复注入收敛、G12 三类故障态复现:按
  remaining-gaps 收口注记保留,不做无证据修复。
