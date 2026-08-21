# T10 Application 切片 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。

## Phase A: 定义层(packages/shared,纯单测) [checkpoint: 26d2097]

- [x] Task: ApplicationDefinition 类型 + parse 校验(name/title/intent 必填;rel 前缀 `meta/application:`)(TDD) — 85ae222
- [x] Task: FlowDefinition.app 可选字段 + parse 归一化(缺省 → `'default'`;显式值原样保留入定义)(TDD) — c3947e0
- [x] Task: 激活不变式第七条 `app-known`(submit 时归一化后的 app 指向已激活 application;非法引用拒且留痕)(TDD) — 26d2097
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase B: 定义入日志与 fold

- [ ] Task: boot seed 扩展(application 定义与 flow 同等作为 active 定义事件入日志;`default` app seed;既有 flows 按域归类 ≥2 个语义 app)(TDD:fold 出活跃 app 定义,业务行为不变)
- [ ] Task: 重放一致扩展(app 定义事件参与 fold;I5 重放 hash 一致)(TDD)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: sitemap 分组投影

- [ ] Task: deriveSitemap 增 `applications[]` 分组(name/title/intent/flows)+ flows 条目 app 字段 + surfaces 条目 app 字段;扁平 flows 保留;version hash 行为不变(TDD)
- [ ] Task: 合同测试(`/.well-known/ui4a.json` 形状;app 定义变更 → version bump)(TDD)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: agent 两层发现

- [ ] Task: agent loop 静态上下文按 app 分组呈现(name+intent+flows)(TDD/合同测试)
- [ ] Task: rule-driver app 定位层(目标相关性先匹配 app intent → 该 app 内入口优先;不做硬过滤,跨 app links 仍合法)(TDD)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase E: 全量回归与走查

- [ ] Task: 全量回归(`CI=true pnpm check` + `CI=true pnpm e2e` 既有零回归 + 新增用例)+ demo 走查(sitemap 分组人工确认)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)
