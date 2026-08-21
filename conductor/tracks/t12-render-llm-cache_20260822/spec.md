# T12 渲染增强:render LLM 接线 + 页面级实体缓存 — Spec

> Track ID: `t12-render-llm-cache_20260822` · Type: Feature · 状态: approved(编排 agent 代行验收)
> 上下文:`DECISIONS.md` D12(A2UI/binding-only)、D18(binderless、整面 reload);`packages/agent/src/render.ts`(rule 路径 + LLM 接口已建未接线)、`apps/web/src/app/api/chat/route.ts`(render 短路)、`apps/web/src/render/validator.ts`(零字面校验)、`apps/web/src/render/deref.ts`(EntityCache)、`apps/web/src/app/page.tsx`(临时 cache)。

## Overview

同属一个主张——**让 agent 方便、快速地展示数据**:

1. **render LLM 路径接线**:`buildRenderPrompt` / `parseRenderResponse` 已建好(处境披露 prompt + fail-safe 解析,`render.ts:191-260`),但 chat 路由只调了 rule 确定路径(`renderSpecFor`,词表只覆盖 chart/table 两个模板)。rule miss 的展示意图(词汇表内其余词条:kanban/timeline/stat/…)目前直接落回普通循环。接线后:rule miss → LLM 生成 → 同一零字面校验 → 凝固 → 渲染。
2. **页面级实体缓存**:`EntityCache` 目前每次渲染临时构建(page.tsx 现取现填),动作后整面 reload 是唯一失效策略;agent 连续展示同一集合(先 table 后 chart)会重复拉取。提升为页面级缓存,`rel + sitemap version` 键控(版本号即缓存键,正典已有原则),exec 成功精确失效。

## 架构决定

1. **LLM render 接线(chat 路由 render 短路内)**:rule `renderSpecFor` miss → `buildRenderPrompt`(词汇表 `/api/render/catalog` + sitemap 处境)→ LLM(glm-5.3)→ `parseRenderResponse`(fail-safe)→ `validateSpec`(**同一零字面校验器**,不新辟通道)→ `freezeSpec` 凝固留痕 → 响应;解析失败/校验失败/端点失败 → 原路交回普通 agent 循环(诚实失败口径不变)。**I1 保持**:无 key 时跳过 LLM 路径,rule 路径完整工作。
2. **双闸不动**:零字面校验(validator)+ 假字段 deref 响亮失败(deref)是铁律 2 的既有防线,LLM 产出必须过同一对闸;词条形状(bindSchema)校验同 rule 路径。**render 动词对 agent 循环的开禁不在本 track**(工具投影保留动词口径不变——LLM render 只走 chat 路由短路)。
3. **页面级实体缓存**:缓存模块按 `rel` 索引实体,携带 sitemap `version` 一致性戳;**version 变 → 全量失效**(定义/拓扑变了,投影口径可能变);**exec 成功 → 精确失效**:当前 rel + 其所属 collection rel(宁可多失效不可脏读,I2 约束);整面 reload 保留为兜底路径。纯前端模块,不引 react-query/SWR(自选型外依赖零新增)。
4. **agent 展示受益**:同 rel 二次渲染(换 concern/换词条)零重复 fetch;画布多 surface 共享页面缓存;首屏行为不变。

## Acceptance Criteria

1. `CI=true pnpm check` 全绿;`CI=true pnpm e2e` 全过(既有零回归 + 新增);
2. LLM 接线:rule miss 的展示意图经 LLM 路径产 spec、过校验、凝固、渲染(mock LLM 单测 + 门控实测;断言 bind 零字面、component 取自词汇表);
3. 诚实失败:LLM 产非法 JSON / 零字面违规 / 假字段 → 校验器拒,交回普通循环(测试;不留半成品 spec,不凝固);
4. I1:无 key 时 rule 路径完整(测试);S5 既有断言零改动;
5. 缓存:同 rel 二次渲染零重复 fetch(测试);exec 成功后当前 rel 与所属集合失效重取(测试);sitemap version 变化全量失效(测试);
6. 回归:B1–B4 / S1–S5 / I1–I6 既有断言零改动通过。

## Out of Scope(非目标)

- render 保留动词对 agent 循环开禁(模型在循环内自主发起渲染——需要时另立 track 评估);
- agent 增量更新数据模型 / A2UI updateDataModel 通道(D18 口径不变:渲染器私有,action 后重建);
- react-query / SWR / service worker 等外部缓存方案(明确不引);
- 跨页面共享缓存、离线缓存;
- 渲染词汇表新词条(词汇表扩充按需另立)。
