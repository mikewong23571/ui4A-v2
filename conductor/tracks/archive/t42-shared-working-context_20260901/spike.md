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

## 结果与选型

- executable tsx probe 证明真实 applications Siren 可直接进入现有 loop；不需要
  DriverContext.entity 到处可空。探针已删除；目录行为提升为常驻测试，2 项预期 Red。
- agent probe 证明现状在 alpha→beta 导航后仍披露 alpha；工作线 category-link
  读取可以观察 revision1→revision2；拒绝目标无事实。34 项现有基线通过。
- scoped prompt 存在二次切片，观察应用必须贯穿 loop/prompt；工作线引用需进入
  navigate 枚举，但不能直接成为当前 action tools。
- 固定 `contextRel?: string`，application attention 改可选；共享 loader 的相关读取
  最多4项、prompt工作段最多6KiB，原32KiB总预算不变。无旧实体快照恢复。
- delegated基线5文件41测试通过；生产service credential仍遵循owner检查，拒绝
  不变成扩权。浏览器换线不改已持久化Workflow参数。
- 新发现：Thread嵌入成员可能无href而有properties.rel，旧filter只检查href。
  在主进程补授权负例，同时审查resume等派生落点。
- 选型由D58固定。没有引入新运行时依赖、数据库或可管理Scope资源。
