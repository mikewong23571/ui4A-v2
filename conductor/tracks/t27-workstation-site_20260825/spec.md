# T27 Workstation 站点 — Specification

## 类型

Feature(站点结构与首页;依赖 T24/T26 的产出)

## 背景与动机

当前前端没有"门":用户无法进入某个工作范围,打开应用回答不了三个问题——
我上次干到哪了?什么在等我?什么在动?导航栏是机器零件表(收件箱/事件流/
画布/委托监控/定义管理),应用最强的"活性"(一切皆进行中的投影)完全不可感。
讨论结论(product-vision.md §二/§三):站点是天然分割点,形态三种——
workstation/meta/raw;首页的主角是工作线;且 workstation 的内容面不得硬编码
(页面滑梯是本 Track 最大风险)。

## 站点归属

本 Track 即站点分割本身:workstation 站落地,meta 站维持现状仅做链接收口,
raw 降格为模式(抽屉实现归 T28,本 Track 摘其顶级入口)。

## 最终形态

1. **三形态路由坐实。** workstation = `/`(默认落点);meta = `/meta`(既有,
   进入定义层的显式意图不变);raw 不再是顶级导航项。导航按站点组织,零件表
   (收件箱/事件流/委托监控)折叠为 workstation 内的上下文到达或系统区。
2. **"我的事"首页。** 三个区块:在等我(关联我的 confirmation/activation/
   draft 待办)、在动(running 的 delegation/agent run/流水线投影)、我的
   工作线(T26 `threads` 集合,含进度与"上次停在哪")。区块内容全部来自
   合同实体——`inbox`/`delegations`/`threads` 都是 sitemap 里的实体。
3. **scope 常显与声明。** 页面常驻"你在哪、在看什么"(站点/scope/注视对象);
   进入一条工作线、切换 scope、跨站跳转是显式动作,并作为结构化上下文事实
   (clientView 扩展或事件)进入 chat 上下文——进入即声明,声明即留痕。
4. **内容面零硬编码页面。** 首页区块用 T30 组合模型描述:聚合虚主体
   (my-work = inbox∪threads∪delegations)+ 区域 × intent 声明,经同一台
   presentation 机器呈现;不出现每区块 React 特判组件(页面滑梯红线)。
   舞台机械(壳、导航框、chat 面板)是唯一合法硬编码。
5. **跨站双桥。** workstation 实体 →"在 meta 中编辑此定义"(显式越界,保
   scope);meta 定义 →"查看活实例"(回 workstation)。

## Scope 边界(非目标)

- 不做 raw 抽屉本体(归 T28);
- 不做实体动作一等按钮与 chat 引用可点(归 T28);
- 不改 meta 控制台内部视图;
- 不做业务应用内容(CVE/track 应用是后续 track 的验收场);
- 不做多用户/团队视图(单实验用户现状)。

## 施工纪律红线

- 首页零每区块 React 特判;区块 = 合同实体 + intent 呈现;
- scope 声明零自然语言启发式(显式动作与 clientView 事实);
- 导航文案面向任务语言,机器名只在辅助说明(product-guidelines 既有原则)。

## 验收方向

- 首页三区块数据源断言:全部来自 sitemap 可达实体(无前端私有数据源),
  且由 T30 组合 surface 承载(区块=区域声明,非组件);
- **CLI 对照:workstation 首页展示的"等我/在动/工作线"三类事实,经 CLI
  读同一合同实体可逐项核对一致(人机同源的合同层证明);**
- 无每应用/每区块特判组件(代码扫描 + review);
- scope 常显与进线/出线事实留痕(clientView/事件断言);
- e2e:从首页到工作线到 meta 编辑再回实例的双桥走查;invariants 全绿;
- Playwright 截图走查:首屏零机制词汇、三门问题一眼可答。
