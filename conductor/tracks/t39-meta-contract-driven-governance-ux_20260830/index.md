# T39 Meta 合同驱动治理与 Application 入口体验

- 类型：Feature | 状态：in_progress | 创建：2026-08-30
- 方向依据：[`../../product-vision.md`](../../product-vision.md)（§二同一扇门、§三 Meta 工具间、§五减暴露加聚合、§六不做传统软件）
- 规格：[`spec.md`](./spec.md)
- 计划：[`plan.md`](./plan.md)
- Application 入口审计：[`application-entry-audit.md`](./application-entry-audit.md)
- 元数据：[`metadata.json`](./metadata.json)
- 验收模型：Agent 浏览器实操 + 截图 + DOM/URL/焦点断言；不新增 per-track Playwright 脚本
- 执行模型：每实现任务一个自包含 subagent；编排者做任务级轻验收、Phase 完整验收和 Track 末 US1–US19 E2E
- 用户故事：US1–US19，覆盖 Meta 治理、Application 图书馆与默认组合、八应用入口、Assistant 共同注视、响应式、未来 surface 与双门一致
