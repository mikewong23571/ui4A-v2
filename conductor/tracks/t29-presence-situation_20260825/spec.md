# T29 在场与处境 — Specification

## 类型

Architecture(前置架构层;T25/T26/T27 的共同地基)

## 背景与动机

愿景 program 要修的每个病都是"处境在多处各自计算"的症状:平面归属曾用正则
猜、scope 归属由 scopeCoverage 按 rel 反推、起点用词级交集探测、首页不知道
用户在哪、agent prompt 放弃计算直接灌全量。五处在回答同一个问题——"用户
此刻在哪里、在看什么、能做什么"——五个算法,五处漂移。更深的信仰欠账:
一个以"一切皆是事件投影"为信条系统,人的处境恰恰是唯一不是投影的东西
(clientView 只是消息附件,不可重放、不可审计、人机各自解释)。

## 站点归属

跨站事实层(服务组合层 apps/web;engine 内核不动)。三个站点都是消费方。

## 最终形态

1. **presence 事件(有界)。** 站点切换、scope 声明、进入/离开工作线、注视
   对象(focus)变化,作为新事件 kind 进同一事件日志。只记**变化点**,不记
   高频移动(每次滚动/点击不进日志);来源为客户端显式上报,服务端校验身份
   后落库。presence 是关于注意力的事实,不是业务状态,不触发裁决。
2. **presence 投影。** 独立 fold(与 presentation 事件同族,不进业务
   snapshot,避免主投影膨胀)出"当前在场"视图(principal → 最近
   site/scope/thread/focus),可重放、可审计;clientView 协议直接演进到
   引用在场事实的形状——项目未发布,按 GR2 不留新旧双路径,一次性切换。
3. **处境装配(唯一回答者)。** 服务组合层单一模块,输入 = 已认证身份 +
   granted scopes + presence 投影 + 显式参数;输出 = site/scope/focus/
   disclosure 切片。agent prompt 构造(T25)、chat 路由、前端 scope 常显
   (T27)全部消费同一输出,禁止各自重算。
4. **显式是正典(CLI 纪律一)。** presence 推断的任何上下文,必须同时可用
   显式参数(scope/rel/thread)表达且显式优先;无 presence 时(CLI/headless)
   装配照常工作——presence 是辅助信号,不是必需输入。

## Scope 边界(非目标)

- 不改事件裁决语义(presence 事件不经 judge,无 guard/effect);
- 不做披露策略本身(T25 消费切片定义);
- 不做工作线(T26;本 Track 只提供 thread 在场锚点);
- 不做任何 UI(T27 消费);
- 不做多用户在线状态/协作感知(单实验用户,无此需求)。

## 施工纪律红线

- 装配零启发式:全部输入是结构化事实(身份/scope/presence/显式参数);
- 装配输出只有一处实现,消费方不得自行推导(防五处漂移复发);
- presence 事件有界:事件种类与频率上限入合同测试。

## 验收方向

- presence 事件→投影→重放 hash 一致;
- 装配单测:显式优先、presence 辅助、无 presence(CLI 形态)正常装配;
- clientView 协议演进:一次性切换测试(GR2,无新旧双路径);
- 消费方矩阵断言:agent prompt/chat 路由/scope 常显同一来源(测试切面);
- 不回归:invariants、chat 套件全绿。
