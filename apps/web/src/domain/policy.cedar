// UI4A 确认门风险策略(T3 初始版;spec 架构决定 3:策略即数据)。
//
// 实体模型(由 web 服务层在求值时组装,见 apps/web/src/domain/cedarPolicy.ts):
//   UI4A::Executor::"<actor>"   attrs: { actor: "human" | "agent" }   —— exec 请求的 actor
//   UI4A::Resource::"<rel>"     attrs: { risk: "high" | "medium" | "low" | "none" }
//                                                               —— 动作声明的 requires-confirmation
//                                                               标注(无标注注入 "none")
//   UI4A::Action::"executeAction"                                —— 所有 exec 动作映射到同一 Cedar 动词
//
// 语义映射(isAuthorized → 确认门):
//   allow → 直通(动作照常执行);deny → 挂起为 pending 确认,等待人类 approve。
//
// 初始规则:
//   agent + high 风险 → 不 permit(挂起);human 一律 permit;low/medium/none 直通。
//
// 注:策略 id 由 Cedar 按声明顺序自动分配(policy0、policy1、…);本 API 路径的
// @id 注解不生效(2026-08-21 实测)。id 随求值原因入 confirmation-requested 事件
// detail 留痕(spec 验收 5)。改本文件 → 重启 web 生效;策略文本挪进 _meta 实体
// 在 T4+(届时热更新)。

permit(
  principal,
  action == UI4A::Action::"executeAction",
  resource
)
when {
  principal.actor == "human" ||
  resource.risk != "high"
};
