# T9 前端体验重构 — Spec

> Track ID: `t9-frontend-overhaul_20260821` · Type: Feature · 状态: approved(编排 agent 代行验收)
> 上下文:T8 已 DONE(功能面全绿);DECISIONS D13/D14(Tremor/recharts 偏差口径)、D16(本 track Phase A 决定);`conductor/product-guidelines.md`。

## Overview

T8 收口后功能完备但视觉散装(各页手写 tailwind、Tremor/react-chrono 风格不一、深色不一致)。本 track 做**纯前端体验重构**:立 shadcn/ui 设计体系基座(专业工程工具风:中性灰基底、单一蓝色强调、细边框、小圆角、信息密度高,Linear/Vercel dashboard 类),统一页面壳,逐页重构内容层,最后退出 Tremor 与 react-chrono。**合同面零改动**:data-nav/data-action/data-testid 属性值、词条 bind schema/目录/data-word、页面精确中文文本模板(如「文章(共 N 篇)」)全部不动;每页恰好一个 `<main>`(i3 fuzz 注入点)。

## 架构决定

1. **设计基座(Phase A)**:shadcn/ui new-york + CSS 变量 + Tailwind v4 CSS-first(`@theme inline` 映射语义令牌);深色 = `prefers-color-scheme` 媒体查询翻转 `:root` 令牌(demo 级,不引 next-themes);删 Tremor `@source` 扫描行。
2. **统一页面壳(Phase A)**:AppShell = sticky 顶栏(品牌 UI4A + 版本 muted + SiteNav 六链接)+ 唯一 `<main>` 统一栅格(max-w-5xl px-6 py-8);SiteNav 上移顶栏,各页 `<SiteNav />` 引用删除;`lang="zh-CN"`。
3. **逐页内容重构(Phase B/C)**:首页态势、实体页、BIOS 面、舰队页、事件流、画布逐页迁移到 shadcn 组件(card/table/badge/alert/skeleton/scroll-area 等),文本模板与 data-* 不变。
4. **依赖退出(Phase D)**:stat 词条 Tremor → shadcn Card 平替、timeline 词条 react-chrono → 自建平替;删 `@tremor/react`、`react-chrono` 依赖,同步收口 i3/invariants 的 chrono 白名单口径。

## Acceptance Criteria(本 track 整体;Phase A 只覆盖 1–2)

1. `pnpm --filter @ui4a/web typecheck` 绿;`pnpm exec eslint apps/web` 绿;`pnpm exec vitest run` 不回归;`PORT=3100` dev 可起,首页 200 且含新顶栏;
2. 硬约束全程成立:data-nav/data-action/data-testid 值不变、每页恰好一个 main、可点元素必带 data-action/data-nav(i3 fuzz 全过);
3. (后续 Phase)各页内容层 shadcn 化完成,Tremor/react-chrono 依赖移除,既有 e2e 全绿(chrono 白名单条目随依赖退出同步删除)。

## Out of Scope(Non-goals)

- 合同/API/引擎/词条 schema 的任何改动;next-themes 等显式主题切换;响应式移动端专项打磨;
- 新页面/新词条;文案改写(精确文本模板不动)。
