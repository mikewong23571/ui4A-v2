# Phase A 探针

## 已观察事实

- 原会话 a6f8e1cf 的事件 407：scope/focus/thread 均 null；事件 410：起点 articles、
  系统提示 application=publishing、applications 仅 publishing。
- Situation 携带 thread/focus，但 Agent disclosure 仅消费 scope/currentRel。
- loop 的 DriverContext.entity 是必需项；直接改成可选会影响全部动作/工具消费者。
- business application:<name> 已存在；完整业务应用目录来自 authorized sitemap。
- 工作线已有目标、显式引用和状态指针；应该重新读取合同，不造新存储。
- delegated 入口强制应用 scope；需区分凭证授予和可选的应用注意力。

## 待验证

1. 使用真正的只读业务 applications 集合作为发现起点，是否能复用现有循环并保持
   人机同源（优先于到处传播可空 entity）。
2. 以一个工作线引用为锚，按步重读线程及有界相关对象，可否在现有 32 KiB wire
   预算内覆盖 S4/S5，且不累积旧事实。
3. delegated 的应用注意力如何保持可选，同时凭证/授权和执行审计不变。
