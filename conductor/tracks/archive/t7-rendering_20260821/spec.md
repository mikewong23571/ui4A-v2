# T7 骨架与渲染切片 — Spec

> Track ID: `t7-rendering_20260821` · Type: Feature · 状态: approved(编排 agent 代行验收)
> 上下文:`conductor/refs/arch-brief.md` §6.1(选型文档 A2UI 接线四条:词汇表身份/binding-only 落实/交互背书落实/骨架不走生成路径)、§10(词汇表词条表 + 同一词汇表两条使用路径)、术语表(凝固/骨架四判据);`conductor/tech-stack.md` §6 渲染词汇表与 A2UI;GOAL S5/I2/I3。

## Overview

渲染词汇表(A2UI 扩展目录形态)+ binding-only 渲染器(客户端拥有数据模型,agent 只发实体引用)+ 骨架五面 + 主页态势投影。**S5(聊天→A2UI surface 渲染图表,spec 零字面数值)+ I2(property test 解引用一致)+ I3(fuzz 可点元素必背书)全过。**

## 架构决定

1. **渲染词汇表注册表**(web 客户端):词条 = {名字, 组件, 绑定 schema};MVP 十词:`table`(TanStack Table)/`chart`(shadcn Charts[Recharts 3]}/`stat`(Tremor)/`timeline`(react-chrono)/`flow`(React Flow)/`form`(RJSF,已有)/`diff`(react-diff-view,已有)/`kanban`(dnd-kit)/`markdown`(react-markdown)/`detail`(shadcn Sheet/Card)。**词汇表即 A2UI 自定义扩展目录**(基础目录只有布局原语,数据词条我们补)。依赖按选型逐个装;某个集成受阻走偏差流程记 DECISIONS。
2. **render spec 与解引用**:spec = `{concern-key, component, bind}`——**bind 全部为实体引用**(entity-ref/field-ref/collection-ref),**schema 层禁止字面数值/字符串载荷**(validator 拒绝:模型发不出一个数字——I2 前提);客户端渲染器**拥有数据模型**:从 /api/entity 拉取被引用实体 → 解引用 → 喂组件;**解引用器纯函数**(entity cache + spec → props)。
3. **A2UI 协议形状**:四消息 `createSurface / updateComponents / updateDataModel / deleteSurface`(传输无关);**实现方式**:先查 npm 有无官方/A2UI 兼容 SDK——有则用,无则实现**薄协议层**(消息形状 + surface 管理器,记 DECISIONS 偏差),数据与组件分离、组件按路径绑定数据;**我们侧强制**:a) agent 只发 updateComponents+引用,不发 updateDataModel 数值;b) action 事件**渲染器拦截 → 映射实体已声明 action → /api/exec 裁决**(合同外按钮无法提交)。
4. **render capability 两条路径**:骨架路径(`:form`)——事件流/BIOS/收件箱**静态绑定**组件(写死,零 AI,审计通道隔离);生成路径(`:ai`)——画布 surface:聊天说"按分类展示文章" → LLM(rule 兜底)产 render spec(chart,series=articles 按 category 分组——分组/聚合在**客户端解引用器**做,spec 只声明维度引用)→ A2UI surface 渲染。**凝固**:首次生成的 spec 按 concern-key 持久化(事件 `render-spec-frozen` 入日志;同 concern 稳定)。
5. **骨架五面**:主页态势投影(stat:待确认/在飞委托/文章计数 + timeline:最近事件[原始数据零 AI 渲染])、收件箱(已有)、事件流页(/events timeline:react-chrono 渲染 /api/events 投影,零 AI)、BIOS(已有)、画布(/canvas:A2UI surface 宿主 + 词汇表全部可用)。首页改造为态势投影;导航一致。
6. **I3 fuzz 基础**:全站可点元素统一 `data-action`(已声明动作)或 `data-nav`(合同 links)属性;fuzz 测试枚举 DOM 所有 clickable → 断言必有其一;合成未声明按钮 submit 被渲染层拒(action-runner 白名单)。

## Acceptance Criteria

1. `CI=true pnpm check` 全绿;`CI=true pnpm e2e` 全过(既有 28 + S5/I2/I3 新增);
2. **S5 E2E**:聊天(agent 路径,rule driver 确定;LLM 真实冒烟可选)发"按分类展示文章" → 画布出现 A2UI surface 的 chart;**渲染 spec(日志/network 可查)不含任何字面数值/内容字符串,全部实体引用**(断言 spec JSON 递归无裸 number/content 值);
3. **I2 property test**:随机生成实体快照 × 随机合法 render spec(vitest property:快照引用字段 → 解引用 props 与快照值逐项相等);e2e 级:画布渲染出的图表数值与 /api/entity 实体快照一致(DOM/aria 断言);
4. **I3 E2E**:Playwright fuzz 全部页面(首页/事件流/收件箱/BIOS/画布/实体页/舰队页)所有可点元素 → 全部映射 data-action/data-nav;页面注入未声明按钮 → 提交被拒(渲染层白名单,无 /api/exec 调用发生);
5. 骨架五面可用:主页态势(数字与实体一致——I2 口径)+ 事件流 timeline(事件与 /api/events 一致)+ 画布(词汇表 ≥10 词条可列举,table/detail 至少手动渲染一例);
6. 凝固:同一 concern 二次渲染 spec 相同(frozen 事件);
7. 回归:既有 28 e2e 全过(悬浮聊天/收件箱/BIOS/舰队页不回归)。

## Out of Scope(Non-goals)

- calendar/map 词条;Stately 可视化(flow 词条用 React Flow 渲染 sitemap 拓扑即可,非必须);多画布管理/分享;
- A2UI 双向回写(updateDataModel 由渲染器私有);外部 MCP agent 接入画布;
- 性能/虚拟化;深色模式等样式打磨。
