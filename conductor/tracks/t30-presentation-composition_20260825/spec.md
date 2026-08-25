# T30 呈现平面组合化 — Specification

## 类型

Architecture(呈现平面升级;T27 内容面的承载机)

## 背景与动机

presentation plane 的现行模型是"一个 subject → 一个 surface"(UserSidecarKey
= principal/scope/subject/intent/device),通用 planner 与 recipe 都围绕单
实体/单集合。workstation 首页是组合:多个区域(等我/在动/工作线)、多种
intent、跨实体聚合。模型缺了"工作区组合"这一维——这不是配置问题,是呈现
平面从"渲染实体"到"组装工作区"的物种升级。没有它,T27 只能手写页面
(传统软件陷阱的最大落点)。

## 站点归属

呈现平面(packages/engine 纯内核的组合规划 + apps/web 适配)。三个站点
通用:workstation 首页是首个消费方,meta/raw 不消费。

## 最终形态

1. **聚合虚主体。** 允许以"虚主体"(如 `my-work`)命名一个跨实体聚合视图:
   区域声明(数据)描述每个区域取哪个实体/集合、以什么 intent 呈现;
   聚合规则声明式,引擎按声明组装,零每区域代码分支。
2. **区域 × intent 组合规划。** Surface 模型扩展:根为区域布局,每个区域
   绑定一个虚主体切片 + intent;复用现有 words 词汇(table/stat/timeline/
   kanban 等)与 catalog 协商;新区域形态进词汇表,不进页面组件。
3. **组合级 recipe/sidecar。** sidecar key 扩展承载组合主体(虚主体 id +
   intent 集),个人 pin 与团队晋升通道与单实体 surface 同机制;依赖声明
   覆盖全部聚合源,任一源失效触发重规划(invalidate/rehydrate 语义沿用)。
4. **binding-only 不变。** 组合 surface 仍只含引用;事实实时解引用,动作
   实时裁决;虚主体不产生业务事实,只是呈现聚合。

## Scope 边界(非目标)

- 不做 workstation 首页本身(T27 用本模型描述首页);
- 不做实体动作一等按钮(T28;组合 surface 里的动作控件沿用 action gate);
- 不做 LLM 呈现生成路径调整(Recipe/Sidecar 机制沿用);
- 不做多用户/团队工作台。

## 施工纪律红线

- 区域/聚合规则声明式数据;新区域形态进词汇表,不进页面组件;
- 组合不产生真相:虚主体不可 exec、无业务 actions(动作仍指回真实实体);
- 与单实体 surface 同一台机器:planner/recipe/sidecar/deref 共用,不分叉。

## 验收方向

- 组合规划纯内核测试:区域声明 → surface 形状/binding 完整性;
- sidecar 兼容:组合主体与单实体主体同生命周期(pin/stale/rehydrate);
- 依赖失效:任一聚合源事件 → 组合 surface 按声明 invalidate;
- binding-only 不变量扩展覆盖组合 surface(I2 同口径);
- 不回归:T16 presentation 套件与 invariants 全绿。
