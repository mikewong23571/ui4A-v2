# T12 渲染增强:render LLM 接线 + 页面级实体缓存 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。

## Phase A: render LLM 路径接线

- [x] Task: 路由 fallthrough(rule miss → buildRenderPrompt[词汇表+sitemap 处境] → LLM → parseRenderResponse → validateSpec → freezeSpec;失败交回普通循环;无 key 跳过保 I1)(TDD:mock LLM;非法 JSON/零字面违规/假字段三拒) — 85f8854
- [x] Task: 门控实测(glm-5.3 真实端点:rule miss 意图 → spec → 凝固 → 画布渲染;RUN_LLM_E2E 口径) — da1b6c9
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase B: 页面级实体缓存

- [ ] Task: 缓存模块(rel 索引 + sitemap version 一致性戳;version 变全量失效)(TDD)
- [ ] Task: 精确失效接线(exec 成功 → 当前 rel + 所属 collection 失效;整面 reload 兜底保留)(TDD)
- [ ] Task: 页面/画布接入(page.tsx 临时 cache 替换;画布多 surface 共享;同 rel 二次渲染零重复 fetch)(TDD/组件测试)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: 全量回归与走查

- [ ] Task: 全量回归(`CI=true pnpm check` + `CI=true pnpm e2e` 既有零回归 + 新增)+ demo 走查(连续展示同集合不同视图、动作后数据 freshness)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)
