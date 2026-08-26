# Track: T26 工作线投影(work thread):一件事的纯投影聚合(spike 先行)

把"一件事"聚成一等投影对象:一个目标 + 一包上下文(跨 scope 实体)+
进行中的 flow/run + 待批准项 + 最近事件。纯 fold,零新真相。这是 scoped
context 的真正载体、workstation 首页与 AI 上下文边界的共同地基。
成员资格语义未定,必须先 spike 再实施。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [Plan](./plan.md)

当前状态:`completed`。方向依据:`conductor/product-vision.md` §一.3(scoped
context)、§三(workstation 是家)、§四(工作线概念)、§六(规则滑梯)、
§八.3(复合投影)+ CLI 纪律二(显式引用聚合)。

2026-08-26 细化:spec 补齐方向依据、T29/T25/D41 依赖事实、现状代码锚点
(fold/project/sitemap/授权/chat/agent-run/CLI/GR3/I5)与 spike 五问的候选
分析;新增 plan.md(Phase A spike → D44,Phase B fold 内核,Phase C 合同
暴露,Phase D 锚定接线,Phase E 验收收尾)。同日补充:验收目标纠偏原则
(验收与 track 目标相悖时干掉验收目标)与全量误导性验收排查结论(两处闭式
sitemap 断言须先开放化,I5 enumerateEntityRels 静默缺口必堵);关联备注已
同步至 T27/T28/T30 spec。实施会话无需此前聊天上下文,从 spec.md 起步即可。

2026-08-26 完成：D44、纯 fold、Siren/sitemap/principal scope、受治理动作、
chat presence 显式锚定与真实 CLI headless 流程均落地；`pnpm check` 与目标 E2E
全绿。`dev:all` 在当前节点因缺 Temporal CLI fail-closed，用户授权部署环境后验证。
