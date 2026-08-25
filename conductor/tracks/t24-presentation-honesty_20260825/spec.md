# T24 呈现诚实化(减暴露)— Specification

## 类型

Feature(纯呈现层减法;零引擎/合同/事件语义变更)

## 背景与动机

生产实测(2026-08-25 截图走查):canvas 首屏充满机制词汇——"A2UI surface
宿主"、"目录 已协商(https://ui4a.dev/render/v1/catalog.json)"、
`presentation-post%3Aitem` 表面 ID、sidecar 梳妆台(固定/版本/疏密/恢复);
chat 直播"思考·步骤 N",失败时甩给用户"检测到无进展导航循环;当前合同未暴露
完成目标所需的可执行能力"。系统最强大的东西(同一份合同、人/AI 同权、可重放)
全部隐形,用户看到的是管道工的标签。方向依据:product-vision.md §一/§五/§六。

## 站点归属

workstation 站(当前业务站点)。meta 站不动(其治理视图本就面向定义专家);
raw 模式不在本 Track(归 T28)。

## 最终形态

1. **canvas 首屏零机制词汇。** 页面不出现 surface 宿主/目录协商/表面 ID/
   sidecar 版本与生命周期控件。信息层级:内容主体 > 合同动作 > 机制。
2. **"为什么这样展示"抽屉承载全部机制。** 从 canvas/实体视图可达,内含:
   surface ID 与 catalog 协商信息、sidecar 元数据与生命周期操作
   (pin/revert/patch/promote/设为团队默认)、provenance 解释(explain 接口)、
   原始合同 JSON。机制从"首屏"降为"抽屉",能力零删减。
3. **chat 对话面只剩人话与进度。** 无"思考·步骤 N"直播帧;进行中仅一条克制
   指示(可点击跳到事件流审计);最终消息是带来源引用的人话。机械轨迹保留在
   agent-decision/事件流,审计能力不变。
4. **失败措辞分层。** 机械层只产出结构化 reason(数据,含 code/evidence);
   面向用户的表述由 LLM 生成(AI-first);LLM 不可用时降级为中性结构化展示
   (如 "失败 · code=no_progress_loop · 已尝试:…"),不硬编码"友好文案"
   模板(文案滑梯红线)。

## Scope 边界(非目标)

- 不改导航/站点结构(workstation/meta/raw 落地归 T27);
- 不做实体动作一等按钮(归 T28);
- 不做 chat 引用可点(归 T28);
- 不动 sidecar/presentation 的存储与裁决语义;
- 不动 meta 站任何视图。

## 施工纪律红线

- 无每应用/每实体类型特判代码(机制词表=固定常量清单,不是按实体分支);
- 抽屉内容来自合同与 provenance 数据,零硬编码页面;
- 文案分层守 AI-first:人话归 LLM,数据归机械层。

## 验收方向

- 机制词表断言:canvas/chat 渲染文本中不出现固定机制词清单(surface 宿主/
  catalog.json/sidecar:/deref-failed 等;诊断码只出现在抽屉);
- 组件测试:抽屉各操作(pin/revert/promote/explain)与现状能力等价;
- chat SSE 帧结构:thinking 帧不再渲染为消息流(协议保留,呈现降级);
- e2e:Golden Story 与 invariants 全绿;Playwright 走查截图对比。
