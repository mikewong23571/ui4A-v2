# T25 Assistant 上下文收窄 — Specification

## 类型

Feature(agent/chat 上下文工程;零合同语义变更)

## 背景与动机

生产实测(2026-08-25):单个五步 agent 回合的 decide prompt 近 300KB——整个
meta sitemap、每条 flow 定义的版本摘要(内嵌定义全文)一次性灌入,LLM 要在
里面捞一个 `next` 动作。起点解析则用动词与 surface 标题做词级交集逐个探测
(又一处启发式猜测,与已清除的平面正则同族)。有限上下文内,收窄决定质量;
这正是"scoped context is the most important"在 agent 侧的欠账。

## 站点归属

跨站上下文层(其披露以"用户当前所在站点/scope"为边界;站点形态本身归 T27)。

## 最终形态

1. **分层披露。** agent 首轮上下文只含:当前 scope 的 sitemap 切片、当前
   实体(合同全形)、可用动作。scope/focus/切片由 T29 处境装配唯一供给,
   本 Track 不另建 scope 推导。其他 scope 仅披露"可导航入口"(rel +
   title,不含实体全形)。跨 scope 内容靠 agent 显式导航获取,每次导航
   留痕(事件日志现状即支持)。
2. **起点即事实。** 删除 `resolveStartRel` 的 sitemap 词级交集探测:起点 =
   clientView.subject(用户正注视的实体)→ scope 默认入口 → `articles`
   兜底。无 clientView 时报事实缺失,不猜。
3. **prompt 预算。** 单次 decide prompt 设硬上限(目标 ≤32KB);超限即披露层
   bug,测试断言拦截。定义版本全文等大体积数据不进 prompt——按 rel 引用,
   需要时导航读取。
4. **失败语义不变。** 上下文收窄后"合同未暴露能力"的诚实失败路径保留;拒绝
   仍即数据。

## Scope 边界(非目标)

- 不做 LLM 意图分类器(已否决的方向:平面归属跟位置走,本轮同理);
- 不改 runAgent 循环协议与工具集形状(仅改披露内容);
- 不做 chat 对话面的措辞/轨迹呈现(归 T24);
- 不做工作线概念(归 T26;本 Track 的 scope 边界将来由工作线承接)。

## 施工纪律红线

- 披露规则零自然语言启发式(起点、scope 边界全部来自结构化事实);
- 分层逻辑按 scope/rel 归属机械计算,无每应用特判。

## 验收方向

- prompt 大小测试:典型回合(读文章/走向导/定义治理)prompt ≤ 预算;
- 回归测试:"新增一篇文章…介绍操作流程"端到端完成且无 meta 越界;
- 起点解析测试:clientView.subject 优先;无交集猜测调用被移除(探测请求数=0);
- 既有 chat 套件、Story Eval(T15 门槛)与 invariants 全绿。
