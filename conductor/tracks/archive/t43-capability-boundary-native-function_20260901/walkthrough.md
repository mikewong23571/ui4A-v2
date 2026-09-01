# T43 产品走查

日期：2026-09-01。环境与截图见 `evidence.md`、`screenshots/`。

## 走查路径

1. Application 目录发现“安全响应”并落到 `cves`；首页仍受最多 9 个入口预算约束。
2. CVE identified 页面从合同投影“补充影响分析”，Human renderer 与 CLI dry-run/live 使用同一 Action。
3. 执行中只显示“正在补充影响信息”，无 Function/Temporal 控件或日志。
4. 完成后显示“影响信息已补充”、严重度、组件和明示参考来源；raw audit 才显示 handler/profile/hash。
5. Work Thread 只在显式 attach 后出现 CVE 成员；390px 下目标、状态、成员与责任动作仍可读。
6. 缺 profile 的真实 Assistant story 零 mutation，并以用户可见失败结束，不泄漏 stack/handlerRef/Temporal。

## 注意力判据

- 发起：用户只表达“补充这个 CVE 的影响信息”，无需选择 handler、profile、task queue 或重试策略。
- 跟进：正常路径不要求用户轮询 Run 页面；Application 状态和 Work Thread 承担进度。
- 责任：extract 首切片不制造无意义确认；callback 仍不能冒充 human。
- 验证：来源、effect origin、原始合同和 terminal receipt 可按需下钻，不占工作台首屏。

结论：没有把旧的函数平台操作负担转嫁给用户，确认次数为零，页面切换不是完成工作的必要条件。

## 观察项

- 结构化 `enrichment` 当前由通用 JSON 值渲染为紧凑文本，信息完整但密度偏高。本 Track 不添加
  CVE 专用 renderer；若第二个真实领域也出现同类阅读摩擦，应新增通用结构化值 vocabulary，先以跨
  Application 用户故事证明重复性。
- 本地默认 `.env.local` 未自动写入 Native Function profile；未部署时 fail closed。现场成功路径使用
  明确的 server-owned profile，配置示例已加入 `.env.example`。
