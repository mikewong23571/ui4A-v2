# T30 呈现平面组合化 — Plan

> 遵循 `conductor/workflow.md` 的 Story TDD、任务提交、Git notes 和 Phase Checkpoint 协议。
> spec:`./spec.md`(含代码锚点与 D45 已决五问,实施前以仓库现状复核)。
> TDD 顺序:每 Task 先 Red(声明 parse/组合规划/sidecar 内核测试),再 Green。每 Phase
> 结束复跑 `pnpm check` 与 `CI=true pnpm e2e invariants`。
> Phase B–F 固定执行 D45: `workspace:<id>` 字符串、shared parser + web registry
> adapter、layout + 每区域 slot(含单主体统一 wrapper)、每区域 Recipe slot、
> 逐区域 diagnostic + partial-authorization；不得重新引入已否决候选。
> 治理纪律:GR3 行数上限不驱动裁剪(业务优先原则);组合内核新逻辑落 packages/engine
> 新模块,不回填 validate.ts(504)/recipe.ts(464);例外登记由编排 agent 统一执行,
> subagent 只如实报告。

## Phase A: Spike → DECISIONS(分歧先于代码) [checkpoint: e325ac0]

- [x] Task: spike 五问决断,落 DECISIONS.md D45 `9bb2003`
  - 已采纳:`workspace:<id>` 字符串、shared parser + web registry adapter、
    layout + 每区域 slot 与单主体统一 wrapper、每区域 Recipe slot、逐区域
    `region-unavailable` diagnostic 与 `partial-authorization`;其余候选已否决
  - 可用纯函数原型验证组合规划/退化等价语义(不提交或提交为 spike 测试);
    锚点:spec.md"现状事实"节
  - 验收:DECISIONS.md 新增条目,编号顺延(当前最新 D44);五问各有明确采纳/否决;
    否决项写明理由(防复辟)
- [x] Task: spec/plan 回改对齐 D45 `e325ac0`
  - 将 D45 已决形状同步进 spec 最终形态和 Phase B–F 任务合同，清除开放问题与
    推荐默认措辞；tracks.md 无需动(本 Track 已登记)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) `e325ac0`

## Phase B: 组合声明模型(数据 + 严格 parse)

- [x] Task: CompositionDeclaration 类型与严格 parse `fab35f2`
  - 在 `packages/shared` 定义声明类型并提供严格 parser(id/version/
    regions[{region, source rel, intent, mode}])；纯组合语义留在 packages/engine。
    虚主体固定为 `workspace:<id>` 字符串，id 规则(参照 D44
    thread id 口径 1–64 字符 `[a-z0-9][a-z0-9._-]*`)、字段白名单与有界(区域数
    与字符串长上限,参照 `MAX_DATA_LENS_SELECTORS=32` /
    `MAX_PRESENCE_VALUE_LENGTH` 口径)；region 唯一，同 id 内容变化必须换 version
  - `RenderSubject`/thin request 维持 string 现形；shared parser 负责声明及其中
    id 的严格校验，只有 web Presentation Broker 识别 `workspace:` 前缀并经
    registry adapter 解析到声明；未知/非法 workspace fail-closed，既有禁键清单不变
  - Red:非法声明/未知字段/超界/非法 id/未知源 rel 形态一律拒绝的解析测试
- [x] Task: 内建声明注册表与 my-work 首声明 `c123629`
  - apps/web Presentation adapter 提供内建纯数据 registry + 查找(版本化,零分支);
    注册 `my-work`:在等我(`inbox`)、在动(`delegations`)、工作线(`threads`)——
    区域源全部为 sitemap 可达合同实体，区域 intent 明确写入声明
  - Green:注册表单测(查找/版本/未知 id 拒绝);声明数据零代码分支自查
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: 组合规划内核(packages/engine,新模块)

- [ ] Task: 区域组装 planner
  - 新模块(如 `presentation/compose.ts`,不回填 validate.ts/recipe.ts):声明 →
    每区域源经既有 `planGenericSurface`/recipe 路径按区域 intent 规划子树 → 根
    layout + 命名 slot 组装单棵 SurfaceTree;区域由来落每节点既有 provenance;
    依赖并集(entity-contract / 集合源加 collection-membership / definition=
    声明版本 / catalog / policy)落树并产出 sidecar 依赖输入
  - Red→Green:声明 → 树形状/binding 完整性(零字面量,I2 口径)/依赖并集覆盖
    全部聚合源 + 声明版本的断言
- [ ] Task: 单主体退化统一
  - 单主体 surface 只经同一组合路径产出，固定形状为
    `layout → slot(subject) → subtree`，不保留旧规划旁路；validate/normalize/hash
    覆盖该形状(新校验逻辑进新模块)，compiler `root`/`node:<id>` 约定保持确定
  - 测试:退化等价(呈现语义)+ 组合树校验/规范化/hash 稳定
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: sidecar/recipe/promotion 组合化

- [ ] Task: key 与 recipe slot 一般化
  - `UserSidecarKey.subject` 固定承载 `workspace:<id>`，key.intent 只承载组合 intent；
    `ApplicationRecipeKey.subjectShape` 按
    `composition:<declaration-id>@<version>[<region>:<kind>,...]` canonical 化，
    单主体同样使用单个 `subject` 区域；每区域精确一个 slot，name 等于 region id，
    kind 来自源合同形状('collection' 首次产出)，模板 subject 固定为
    `$slot:<region>`，实例化后不得残留 `$slot:`；
    `promotion.ts:108/119` 与 `apps/web/src/engine/presentation/runtime.ts:141-156`
    的单 slot 硬编码同步一般化(按完整有序 `{name,kind}` 匹配,不再按数量==1)
  - Red→Green:sidecar key/fingerprint 单测、recipe 注册/解析/晋升的多 slot 测试
- [ ] Task: fastpath 与失效同机制
  - 组合主体走同一 fastpath 阶梯(user-pinned → user-cache → promoted-recipe →
    candidate-recipe → generic → planner);依赖失效(任一聚合源/声明版本漂移)
    按声明 mode rehydrate/invalidate;stale/evict/pinned 语义沿用
  - 测试:命中重授权发生、任一源失效触发重规划、pin 优先、evict 不删 pinned
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase E: web 运行时、canvas 与误导验收迁移

- [ ] Task: 误导验收前置迁移(spec"误导性验收排查"清单)
  - 按清单逐条处置(开放化/迁移/删除),处置记录进任务 notes;先于组合形状
    落地——保绿即冻结旧形状 = 方向错误,本任务是纠偏原则的首次执行
- [ ] Task: broker 授权与运行时接线
  - broker authorize 对组合主体解析声明并逐区域源 fresh getEntity 重授权;
    不可授权区域保留无 binding/目标 rel/policy 细节的
    `diagnostic(code='region-unavailable')` slot；至少一个区域可见时 receipt 为
    `ready`/`partial-authorization`，全部不可见时为 `failed`/
    `authorization-failed` 且不生成可复用 Sidecar；生命周期事件沿用，
    surfaceUrl/surface id 约定沿用
  - 测试:授权逐源发生、越 scope 降级不泄漏、收据诚实、无 LLM 时 generic 退路(I7)
- [ ] Task: canvas 挂载与抽屉组合信息
  - canvas 单树挂载组合 surface(零分叉验证);why 抽屉/explain 呈现区域清单、
    声明版本与 provenance(机制信息留抽屉,T24 口径)
  - 测试:编译/渲染 layout+slot 组合树、抽屉区域信息可达、新控件遵守 i3 fuzz
    注记规则(data-action/data-nav)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase F: 端到端验收与收尾

- [ ] Task: my-work 端到端 proof
  - `POST /api/presentation`(subject = `workspace:my-work`)→ receipt ready →
    canvas 渲染三区域;binding-only(I2 口径:deref 值与实体快照一致);
    presentation 域重建与业务 fold 隔离各自一致(I5 口径)
- [ ] Task: 全量验收
  - `pnpm check` 全绿;`CI=true pnpm e2e invariants` 全绿;T16 presentation 套件
    与 chat 套件全绿;`pnpm dev:all` 实际启动走查(里程碑约束)
- [ ] Task: Track 收尾
  - `conductor/tracks.md` 状态流转;track 目录按 GR5 处置(无 bespoke 脚本/配置
    残留);metadata.json 归档;T27 spec 的组合消费口径如有偏差回改一行备注

## 验收标准(Track DoD)

1. spike 五问落 DECISIONS.md(D45,采纳与否决项齐全),spec/plan 与之一致;
2. 组合声明为数据:shared parse 严格、web registry adapter 零分支；虚主体固定为
   `workspace:<id>`；my-work 三区域全部来自 sitemap 可达合同实体，零每区域/
   每实体类型特判;
3. 组合与单主体同一台机器(planner/recipe/sidecar/deref/compiler 零分叉),
   单主体固定为 `layout → slot(subject) → subtree`;binding-only 与薄 chat 边界不变;
4. sidecar 组合主体同生命周期(pin/stale/rehydrate/promote);依赖并集任一源
   失效按声明 mode 触发;命中逐源重授权,部分授权逐区域输出
   `region-unavailable` diagnostic 和 `partial-authorization` 且不泄漏；全部
   不可见时 `authorization-failed` 且不生成可复用 Sidecar;
5. 虚主体不进 sitemap、不可 exec、无业务事件;presentation 域与业务 hash 各自
   重放一致;
6. `pnpm check` + `CI=true pnpm e2e invariants` + T16/chat 套件全绿;系统实际
   可运行。
