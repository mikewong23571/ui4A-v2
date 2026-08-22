# T14 walkthrough 修复 — Plan(快速闭环版)

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。
> 用户指示:「快速闭环修复,最后统一验收」——任务级 TDD 与提交保留,Phase checkpoint 合并为末尾一次统一验收。

## Phase A: 数据契约修复(#5/#4/#3)

- [x] Task: append 效果合并源实例字段(参数优先、实例兜底、origin 各自留痕;DECISIONS D24;I5 重放一致)+ B1 断言补强(agent/human 两路 e2e 断言发布文章 category/tags)(TDD) — a836dda
- [x] Task: exec 表单预填与 label 人话化(动作字段与实例字段同名预填;publish title 补 description;表单 label 取 field-definition.title,seed 补人话标题;属性表机器名过滤)(TDD) — 4bd5a4c

## Phase B: 画布韧性(#6/#7 + T12 遗留)

- [ ] Task: deref 成员级降级(缺字段成员跳过 + 计数标注,零发明;结构性错误仍整面失败)+ per-surface 错误边界(单面抛错不拖死整页)(TDD)
- [ ] Task: caption grounding 核对 + 非聚合词条禁 dimension(renderSpecGroundingErrors 增 caption 可解析性;kanban/table/timeline bindSchema 去 dimension)(TDD)

## Phase C: 人类可读性(#1/#2)

- [ ] Task: 事件流可读投影(kind 注册表驱动的机械叙事摘要 + 时间戳 + detail 折叠下钻;chat-turn/agent-decision 回合级折叠;零 AI 源级断言同步)(TDD)
- [ ] Task: 文案人话化(stat 卡「执行中委托」+ 说明;导航/标题词汇走查统一)(TDD)

## Phase D: 统一验收(唯一 checkpoint)

- [ ] Task: 全量回归(`CI=true pnpm check` + `CI=true pnpm e2e`)+ walkthrough 复验 #1–#7(dev 库重置 + 脚本化复走 US-1/US-2/US-13/US-14)+ checkpoint git note + tracks.md 勾选
