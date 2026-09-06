# T57 DONE：共享首页、任务呈现语义与低成本发起

完成日期：2026-09-06；生产代码基线：3ae4a24c。按用户授权在独立worktree与T56并行实现，
保留T56 P4.1/P4.2提交后合并master，统一运行重度验收；关闭协议由编排agent自治代行。

## 已交付

- 首页共用my-work v3和实际clientView：inbox、threads-current、delegations-current；历史独立到达，应用发现默认收起。
- 摘要行/决定卡/表格由通用语义选择；低频动作按需展开，短任务用可访问Dialog；普通管理动作不冒充待决责任。
- 只填goal即可建线；commandId提供重试身份，thread-input从同一创建事件回读原文；人、CLI、Agent同合同。
- Recipe/Sidecar及候选调整不能省略、无效绑定或折叠隐藏责任；直接读、重试、授权失效和缓存切片保持真实。
- 原文/未知回执、完整决定信息、键盘/触屏/缩放/密度重载和跨页上下文已闭环；没有新业务状态库、规则助手或应用专页。

## 验收

| 项目 | 结果 |
| --- | --- |
| 全仓check | 593files / 4393tests通过；类型/lint/strict全过 |
| 完整浏览器 | 100passed / 29专项skip；包含invariants与T56工作线回归 |
| 最新首页专项 | 4passed：四viewport、touch/keyboard、重试来源、责任保全负路径 |
| 真实模型 | 首页强引用/目标/状态案例、generic→Recipe→Sidecar改版、S24五种提问通过；前序四个协作case另留证据 |
| 实际像素 | 四viewport、原生200%与Dark表单、compact/spacious重载已亲看 |
| production build / format | 均通过；未部署 |
| 实现后review | 所有范围内finding已修复并复测/复审，无阻断 |

精确代码/运行时间/重叠及skip口径见 [evidence.md](./evidence.md)，实际差异复审见 [review.md](./review.md)，
S1–S3接口与事务定案见 [spike-report.md](./spike-report.md)。保留的是精简fixture证据，无完整构建目录、报告或凭证。

## 边界

真人便利性与连续两周使用未验证，属于T58；本次模型首页回答约3分钟，未声称提升模型响应速度。
D78.4既有thread确认门差异未扩大或宣称修复；非root collapse持久化不被当成像素改版。
T56保持原agent负责，T58未冻结，线上未发布。
