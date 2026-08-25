# T13 meta 可视化 + capability 定义面 — Spec

> Track ID: `t13-meta-visualization_20260822` · Type: Feature · 状态: approved(用户指示「可以,推动完成」;编排 agent 代行验收)
> 上下文:`DECISIONS.md` D19 第 7 条(meta 可视化是 approval gate 的可用性前提;路线 T4)+ 用户补充「capability 的定义目前不存在」;`conductor/refs/arch-brief.md` §10(激活不变式全集含 capability-registered/capability-schema-compatible)、第七层(capability 三类动词);T7 flow 词条 `apps/web/src/render/words/flow.tsx`(React Flow + 确定性分层布局);BIOS 面 `apps/web/src/app/meta/`、diff 渲染 `apps/web/src/components/meta/diff-render.tsx`;T10 的 application 定义面先例(seed 入日志 + fold + app-known)。

## Overview

两个同源缺口,都在「定义平面对人类与 agent 的可发现性」上:

1. **meta 可视化(D19 路线 T4)**:approve 永需 actor-is-human,但 BIOS 面的 flow 定义只有表格文本——人类审批者看不懂状态机就签不了字,自举循环断在人类身上。FlowEdge 数据现成(`packages/shared/src/definition.ts` flowEdges),React Flow 与确定性布局组件现成(T7 flow 词条)。activation 的机械 diff 已有(submit 时 before/after),但 definition-versions 历史(approve 沉淀,`packages/engine/src/meta.ts:460`)从未暴露成可读投影,无法做「任意两版前后对比」。
2. **capability 定义面缺失**:flow 定义引用 capability(proposal source 的 `capability: 'draft'`、spawn 效果的 capability、arch-brief 的 notify/clarify),但系统里没有 capability 目录——无实体、无注册表、无投影,人类与 agent 都无法发现「这个系统有哪些 capability、什么类别、输入输出是什么」。arch-brief A.5 种子集的 `capability-registered` 不变式因此从未落地。

本 track 一次性补齐:flow 拓扑图 + 版本历史两版对比 + capability 定义面(类型/seed 入日志/fold/BIOS 投影)+ 激活不变式第八条 `capability-registered`。

## 架构决定

1. **flow 拓扑图(只读)**:`/meta/flow/<name>` 与 `/meta/self` 页在既有表格之上增只读拓扑图。数据:定义实体投影已携带 node/action 声明,经 `flowEdges`(shared 已有)推导边;渲染复用 T7 flow 词条的 `@xyflow/react` + `layeredLayout` 确定性分层布局(BFS 深度 × 层内声明序,同输入同布局,快照对拍可断言)——**不引新依赖**。节点标注 title,边标注 action 名。**只读投影**:不做拖拽式图形编辑,编辑仍走合同动词(D19-7 原话);渲染零 AI(铁律 5)。flow 词条是渲染平面(canvas)产物,BIOS 拓扑直接复用其布局函数与 ReactFlow 组件,不经词条注册表/deref 通道。
2. **definition-versions 可读投影 + 两版对比**:meta 平面投影暴露版本历史——`/meta/flow/<name>` 增版本区(版本号/状态/激活事件来源);支持任选两版查看机械 diff(deep-object-diff 同算法,复用 `diff-render` 组件三视角)。数据面:`snapshot.definitionVersions` 已在引擎快照;在 meta 实体投影或 service 层增版本摘要与按版本取定义的读取路径(实现时选最小侵入方案并记录)。activation 详情页现有 submit 时 diff **不动**。
3. **CapabilityDefinition 定义面(与 application 同构,T10 先例)**:类型 `{name, title, kind: 'transform'|'extract'|'effect', intent, input?, output?}`(arch-brief 第七层:转换/提取/效应三类;artifact in → artifact out,input/output 为 schema 描述,可选);rel 前缀 `meta/capability:<name>`;`capability-seeded` 事件入日志(boot 补种,旧库迁移同哲学)+ fold 落 `snapshot.capabilities`(幂等、缺载荷响亮失败、不物化空表,I5 重放一致)。seed 覆盖**全部被引用 capability**(盘点:draft[proposal source]、notify[T3 确认门]、clarify[第九层 on-invalid];实施时以全仓引用盘点为准,宁多勿漏)。BIOS 面 `/meta/capabilities` 列表 + `/meta/capability/<name>` 详情,只读投影进 meta sitemap。
4. **激活不变式第八条 `capability-registered`**:submit 时 flow 定义中全部 capability 引用(field source `proposal.capability`、effect `spawn.capability`,以及实施时盘点的其他引用点)必须指向已注册 capability;非法引用拒且留痕。与 `app-known` 同模式:`DefinitionRegistries` 增可选 `capabilities`,未提供时 vacuous pass(过渡期),seed 后长牙;checks 精确名单断言处(e2e/s2)按 D21 先例机械适配 7→8。
5. **不动的口径**:只读投影零编辑通道;capability 沙箱/真实执行不接(spawn 仍只产 spawn-requested 审计事件,D15 L-3 口径);meta 编辑动词不扩展(add-capability/set-intent 等归后续,同 T10 缓 add-app 口径);既有七项不变式判定逻辑不动。

## Acceptance Criteria

1. `CI=true pnpm check` 全绿;`CI=true pnpm e2e` 全过(既有零回归 + 新增);
2. 拓扑图:`/meta/flow/<name>` 与 `/meta/self` 渲染只读拓扑(节点 title + 边 action 名),组件测试(布局确定性:同输入同坐标)+ e2e 断言可见;不可拖拽编辑(无编辑交互);
3. 版本历史:`/meta/flow/<name>` 版本区可读(经 S2 流激活 v2 后,v1/v2 均在);两版对比 diff 视图正确呈现 added/deleted/updated(组件测试 + e2e);
4. capability 定义面:seed ≥3(draft/notify/clarify);capability-seeded 入日志、fold 落表、I5 重放 hash 一致;`/meta/capabilities` 列表与详情可读(e2e);业务 sitemap 不含 capability 入口(跨站规则不破);
5. `capability-registered`:未注册引用(如 `capability: 'nonexistent'`)submit 拒且留痕(checks-fail 路径,单测/service 测试);已注册引用零误伤(既有 S2 e2e 通过);
6. 回归:B1–B4 / S1–S5 / I1–I6 既有断言零改动通过(D21 先例的 checks 名单机械适配除外);
7. demo 走查:拓扑图、版本对比、capabilities 页人工可读确认(脚本化等效)。

## Out of Scope(非目标)

- capability 沙箱与真实执行(spawn 消费、artifact 内容寻址存储)——arch-brief 洞 #7,后续专项;
- capability 的 meta 编辑动词与 lifecycle 接入(add-capability / deprecate-capability);
- `capability-schema-compatible` 不变式(spawn bind 与能力输入 schema 相容)——需 input schema 先真实化,归后续;
- 拓扑图的拖拽编辑/布局持久化;业务平面(canvas)拓扑渲染;
- D19 路线其余棒次(/app/<name> 默认页、角色 archetype)与版本 manifest 锁(D19-4 的 application 版本);
- diff 算法变更(deep-object-diff 不动)。

## 施工上下文(自包含:subagent 无需再做 discovery)

**模块地图(精确触点)**:

- 拓扑数据:`packages/shared/src/definition.ts` flowEdges(:240)/FlowEdge;布局与渲染:`apps/web/src/render/words/flow.tsx`(layeredLayout/graphPayload 可复用或抽取共享);BIOS 页面:`apps/web/src/app/meta/flow/[name]/page.tsx` → `apps/web/src/components/meta/flow-definition-view.tsx`(表格视图,拓扑图加在这里);`/meta/self` → `apps/web/src/app/meta/self/page.tsx`(同一 FlowDefinitionBody 复用)。
- 版本历史:`packages/engine/src/meta.ts:455-465`(approve 沉淀 definitionVersions);`packages/engine/src/fold.ts`(definitionVersions 重放);meta 投影:`apps/web/src/engine/service.ts`(:290-340,currentMetaSitemap/projectMeta 区域);diff 组件:`apps/web/src/components/meta/diff-render.tsx`(三视角);activation 页:`apps/web/src/components/meta/activation-view.tsx`。
- capability 定义面先例(T10 application):类型 `packages/shared/src/definition.ts`(ApplicationDefinition/META_APPLICATION_PREFIX);parse `packages/engine/src/parse.ts`(parseApplicationDefinition);seed `apps/web/src/domain/applications.ts`;boot 补种 `apps/web/src/engine/service.ts`(application-seeded 段);fold `packages/engine/src/fold.ts`(application-seeded 分支);`apps/web/src/db/events.ts` EventKind 镜像;`packages/engine/src/confirmation.ts`/effects.ts 表随行先例。
- 不变式:`packages/engine/src/invariants.ts`(validateDefinition 七项,第八条加在这里;app-known 的 registries 可选 + vacuous pass 模式照抄);submit 求值 `packages/engine/src/meta.ts:305-381`。
- BIOS 列表/详情页先例:`apps/web/src/app/meta/flows/page.tsx`、`apps/web/src/components/meta/meta-lists.tsx`、meta-client.ts(读 /_meta/api/entity)。

**既有断言红线(不得破坏)**:渲染零 AI(BIOS 组件源级断言有测试);业务 sitemap 无 _meta 入口、业务/meta 端点互拒(e2e 跨站规则);B1–B4/S1–S5/I1–I6 断言零改动;checks 精确名单断言(e2e/s2.spec.ts)只允许 D21 先例的机械适配(7→8 + 行数)。

**基础设施与命令**:PG `docker compose up -d --wait`(宿主 5433);单测 `CI=true pnpm vitest run <path>`;质量门 `CI=true pnpm check`;e2e `CI=true pnpm e2e`(自动起 3100,D5)。**改 apps/web 前必读 `apps/web/AGENTS.md`**(本仓 Next.js 是分叉版,先读 `node_modules/next/dist/docs/` 相关指南再写码)。actor/principal 自报口径(D8)。subagent prompt 四要素合同见 `conductor/workflow.md`。
