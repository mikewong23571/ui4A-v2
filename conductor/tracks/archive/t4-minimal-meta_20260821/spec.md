# T4 最小 meta 切片 — Spec

> Track ID: `t4-minimal-meta_20260821` · Type: Feature · 状态: approved(编排 agent 代行验收)
> 上下文:`conductor/refs/arch-brief.md` §10(附录 A 全文:九 rel/最小核四/编辑动词/definition-lifecycle/激活不变式/BIOS/权限平面/跨站规则)、§9.2(切片主张)、§11 铁律 5。

## Overview

flow 定义从代码常量挪进事件日志(XState machine-as-JSON);`_meta` 独立 HTTP 面(同引擎同日志);definition-lifecycle 用 XState 自举;非法定义被拒且留痕("非法动作被拒绝、非法定义也应被拒绝"变成测试);人类在机械 diff 上批准;激活后 sitemap 重生成,**agent 下一步即可用新动作,无任何 prompt 改动**。**S2 全链路自动化通过。**

## 架构决定

1. **最小核四 rel**:`meta/flows`(定义实体:节点/字段/动作/边)、`meta/activations`(激活队列)、`meta/registries`(谓词/效果/字段类型清单——从 shared 注册表投影)、`meta/self`(definition-lifecycle 自身定义)。其余五 rel 不建(到来时机见 arch-brief §10)。
2. **definition-lifecycle(A.4 原样)**:`draft --submit--> validating --checks-pass--> pending-approval / --checks-fail--> draft(附报告);pending-approval --approve--> active(写版本,重生成 sitemap,bump version) / --reject--> rejected / --timeout--> expired(T4 不实现 timeout——时钟 capability 体系后续,记非目标);active --revise--> draft(v+1) / --deprecate--> deprecated`。该 flow 自身也是 machine-as-JSON 实体(meta/self)。
3. **编辑动词(A.3,全部过同一三层裁决)**:T4 实现 `add-node`(is-draft, node-not-exists)、`add-action`(is-draft, node-exists, **to-exists**, **guards-registered**, effect-known)、`submit`(is-draft)、`revise`(is-active)、`approve`(**actor-is-human**;approver 有 mandate——demo 口径 human 即有)、`reject`(actor-is-human + reason 必填)、`deprecate`(no-live-instances)。remove-*/add-field 可缓(记非目标,S2 不需要)。
4. **激活不变式(种子集)**:edge-targets-exist、guards-registered、field-types-known、effect-known、initial-exists + terminal-reachable。作为 definition-lifecycle validating 状态的检查器(submit 时全跑,结果入 activation 实体 checks)。
5. **定义入日志**:boot 时日志无定义事件 → seed 三个业务 flow 为 active 定义事件(machine-as-JSON 全文入 detail);引擎从此**从日志 fold 出活跃定义**(代码常量仅作 seed 源);活跃定义变更 = 定义事件(修订/激活/废弃)。在途实例盖版本戳(arch-brief §10 三手段之"实例按出生版本走完"——T4 demo 口径:实例记录 bornVersion,激活不迁移在途)。
6. **/_meta 站点**:`/_meta/.well-known/ui4a.json`、`/_meta/api/entity?rel=`、`/_meta/api/exec`(同一引擎 service,rel 前缀路由);业务站 sitemap 的导航枚举排除 `_meta`(进入定义层必须显式意图,arch-brief §10 跨站规则)。
7. **机械 diff + BIOS 最小面**:deep-object-diff 计算 before/after(结构化 JSON diff);BIOS 页(T4 最小三面:定义查看 meta/flows、激活队列+diff+approve/reject、meta/self 查看)——**审批者看到的 diff 用内建 react-diff-view 渲染,零 AI、零扩展渲染器**(铁律 5:A.8 批准回链内建审查);RJSF 编辑表单(编辑动词的 fields schema)最小实现。
8. **S2 场景数据**:agent 对 `flow:article-drafting` 修订:revise → add-action(在 ready 节点加 `pin` 动作,to: done,guards: [])——第一版**故意缺 guard**(非负例:guards-registered 拒——嗯,guards: [] 空数组合法……非负例改为:add-action 的 to 指向不存在节点 → edge-targets-exist 拒且留痕)→ 修正(to: done)→ submit → checks 过 → pending-approval → human BIOS approve → sitemap version bump → **agent 立即可 exec pin(同一会话下一步,零 prompt 改动)**。S2 断言原文照测。

## Acceptance Criteria

1. `CI=true pnpm check` 全绿;`CI=true pnpm e2e` 全过(既有 18 + S2 新增);
2. **S2 E2E(agent 经 /_meta)**:非法定义(add-action to 不存在节点)被拒(422 guard/invariant 层)且 `/api/events` 留痕带原因 → 修正后 submit → pending-approval 实体(含机械 diff 与 checks)→ human BIOS 页 approve(actor=human)→ sitemap 重生成(version 变化)→ **agent 下一步 exec pin 成功**(B 场景文章上;零 prompt 改动断言:agent 循环无任何 prompt 常量变化,工具/合同动态发现);
3. meta approve 不委托:agent approve → 422 actor-is-human 拒且留痕(I4 延伸);
4. 在途实例:激活新版本后,已存在的在途向导实例按出生版本走完(不受新定义影响,测试);
5. 重放一致:定义事件参与 fold,重放后活跃定义与在线一致(I5 保持——扩展重放测试);
6. BIOS diff 渲染:react-diff-view 呈现 before/after(组件测试 + e2e 断言 diff 可见且含新增动作);
7. 业务站 sitemap/links 不含 _meta 入口(跨站规则);`/_meta/.well-known/ui4a.json` 可访问;
8. B1–B3/S1 回归全过(定义从日志加载后业务平面行为不变——seed 迁移正确性)。

## Out of Scope(Non-goals)

- meta/resources、projections、capabilities、policies、versions 五 rel(到来时机未到);
- remove-*/add-field 编辑动词;timeout/expired 转移(时钟 capability);定义迁移实操(洞 #6);
- Stately 可视化(BIOS 定义查看用文本/表格;React Flow 图 T7);
- Keycloak mandate(自报口径 D8);渐进信任;注入有界化(洞 #1 的完整解在后续);
- 多版本并存执行(实例盖戳即可,不实现按版本路由执行引擎)。
