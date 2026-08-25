# T13 meta 可视化 + capability 定义面 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。

## Phase A: flow 拓扑图(只读) [checkpoint: 4e849fd]

- [x] Task: 拓扑数据推导 + 布局复用(flowEdges → graph 形状;layeredLayout 复用或抽取共享;TDD:布局确定性单测——同输入同坐标) — 91d57ae
- [x] Task: BIOS 拓扑图组件 + 页面接入(/meta/flow/<name> 与 /meta/self 增只读拓扑,节点 title + 边 action 名;无编辑交互;组件测试 + e2e 可见断言) — 4e849fd
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) — 4e849fd

## Phase B: definition-versions 可读投影 + 两版对比 [checkpoint: 6fbb98a]

- [x] Task: 版本历史投影(meta 平面暴露 definitionVersions:版本号/状态/激活来源;/meta/flow/<name> 版本区)(TDD) — e4eaac6
- [x] Task: 两版对比 diff 视图(任选两版 → deep-object-diff 机械 diff,复用 diff-render 三视角;组件测试 + e2e:S2 流激活 v2 后 v1 vs v2 对比)(TDD) — 6fbb98a
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) — 6fbb98a

## Phase C: capability 定义面 [checkpoint: ab48d33]

- [x] Task: CapabilityDefinition 类型 + parse(name/title/kind/intent 必填,kind ∈ transform|extract|effect;rel 前缀 meta/capability:)(TDD) — 584efeb
- [x] Task: capability-seeded 入日志 + fold 落 snapshot.capabilities(seed draft/notify/clarify ≥3,以全仓引用盘点为准;boot 补种;I5 重放一致;EventKind 镜像 + 表随行)(TDD) — 8313e37
- [x] Task: BIOS capabilities 投影(/meta/capabilities 列表 + /meta/capability/<name> 详情;meta sitemap 携带;业务 sitemap 不含;组件测试 + e2e)(TDD) — ab48d33
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) — ab48d33

## Phase D: capability-registered 不变式 + 全量回归 [checkpoint: d9081ba]

- [x] Task: 激活不变式第八条 capability-registered(全部引用点盘点;未注册拒且留痕;registries 可选 + vacuous 过渡;s2 checks 名单机械适配 7→8)(TDD) — d9081ba
- [x] Task: 全量回归(`CI=true pnpm check` + `CI=true pnpm e2e` 既有零回归 + 新增用例)+ demo 走查(拓扑图/版本对比/capabilities 页脚本化确认) — 证据挂 d9081ba note(check 1073 / e2e 45+4skip / curl 走查)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) — d9081ba
