# T40 深路径体验闭环:应用内实体页 × Chat 共同注视的走查修复

- 类型:Remediation | 状态:done(2026-08-31 闭环,S1–S10 全过) | 创建:2026-08-31
- 方向依据:[`../../product-vision.md`](../../product-vision.md)(§一 AI as assistant / Native context aware、§二同一扇门、§三 workstation 是家 raw 是验钞灯、§五减暴露加聚合)
- 规格:[`spec.md`](./spec.md)
- 计划:[`plan.md`](./plan.md)
- 用户故事(验收准绳):[`user-stories.md`](./user-stories.md)
- 走查登记:[`findings.md`](./findings.md)
- 终审:[`review.md`](./review.md)
- 证据:[`evidence/2026-08-31-walkthrough/`](./evidence/2026-08-31-walkthrough/)
- 元数据:[`metadata.json`](./metadata.json)
- 验收模型:编排 agent 以使用者身份在真实浏览器按故事步骤实测,视觉对照 `user-stories.md` 逐条判定,截图存 `evidence/<date>-<story>/`;不新增 per-track Playwright 配置
- 执行模型:每实现任务一个自包含 subagent;编排者做任务级轻验收、Phase 完整验收与 Track 末 S1–S10 深路径终审
- 用户故事:S1–S10,覆盖应用深路径(待办/写作)、实体页读面、Chat 共同注视与降级、Chat 推进闭环、工作线深路径、首页读面、Meta 治理深路径、双门同径与窄屏
