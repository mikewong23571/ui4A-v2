# T14 walkthrough 修复 — Plan(快速闭环版)

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。
> 用户指示:「快速闭环修复,最后统一验收」——任务级 TDD 与提交保留,Phase checkpoint 合并为末尾一次统一验收。

## Phase A: 数据契约修复(#5/#4/#3)

- [x] Task: append 效果合并源实例字段(参数优先、实例兜底、origin 各自留痕;DECISIONS D24;I5 重放一致)+ B1 断言补强(agent/human 两路 e2e 断言发布文章 category/tags)(TDD) — a836dda
- [x] Task: exec 表单预填与 label 人话化(动作字段与实例字段同名预填;publish title 补 description;表单 label 取 field-definition.title,seed 补人话标题;属性表机器名过滤)(TDD) — 4bd5a4c

## Phase B: 画布韧性(#6/#7 + T12 遗留)

- [x] Task: deref 成员级降级(缺字段成员跳过 + 计数标注,零发明;结构性错误仍整面失败)+ per-surface 错误边界(单面抛错不拖死整页)(TDD) — 97f75b7
- [x] Task: caption grounding 核对 + 非聚合词条禁 dimension(renderSpecGroundingErrors 增 caption 可解析性;kanban/table/timeline bindSchema 去 dimension)(TDD) — fb8f47f

## Phase C: 人类可读性(#1/#2)

- [x] Task: 事件流可读投影(kind 注册表驱动的机械叙事摘要 + 时间戳 + detail 折叠下钻;chat-turn/agent-decision 回合级折叠;零 AI 源级断言同步)(TDD) — e4576ac
- [x] Task: 文案人话化(stat 卡「执行中委托」+ 说明;导航/标题词汇走查统一)(TDD) — f66e39f

## Phase D: 统一验收(唯一 checkpoint) [checkpoint: 391a419]

- [x] Task: 全量回归(`CI=true pnpm check` + `CI=true pnpm e2e`)+ walkthrough 复验 #1–#7(dev 库重置 + 脚本化复走 US-1/US-2/US-13/US-14)+ checkpoint git note + tracks.md 勾选 — 391a419

## Phase E: Application-as-Data 自举（#12）

- [x] Task: disposable probe + 应用制品/meta bootstrap 合同 TDD（业务 application/flow/capability/seed 迁出 TS；安装留痕、幂等、重放、旧库兼容） — 650ed67
- [x] Task: runtime 从 fold 快照枚举定义，移除 `businessFlowList`/`businessFlows` 生产 fallback 与 article 特权 imports；缺定义响亮失败 — 6a081f0

## Phase F: agent 与共享处境闭环（#8–#11）

- [x] Task: 单实体阅读解析 + binding-only detail focus；navigate focus SSE 驱动画布临时 surface（零 freeze/零业务事件） — 86b7e87
- [x] Task: 显式 fail 工具 + 无能力/重复处境停滞检测 + failed/chat-turn 审计（合同外目标有限步零副作用） — 03a70f1
- [x] Task: SSE 固定 deadline 改 idle timeout/heartbeat 生命周期，区分人工停止与空闲超时 — 9320577

## Phase G: chat 持久性与画布活性（#13/#14）

- [x] Task: turn-started/progress/final 追加式投影覆盖 inline/render/delegated/failed；session 首帧 + 刷新恢复/未完成轮询 TDD — e6ae9b8
- [x] Task: reasoning delta 合帧 + canvas latest-wins cancel/timeout + reload 并发门 + boundary 重置 TDD — 941650d

## Phase H: 增补统一验收（#8–#14）

- [ ] Task: targeted + `CI=true pnpm check` + `CI=true pnpm e2e`；真实浏览器复验查看第一篇/删除失败/focus/刷新恢复/画布压力；checkpoint git note + tracks.md 勾选
