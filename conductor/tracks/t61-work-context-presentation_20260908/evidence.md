# T61 Evidence

- 开工基线：ea3bbe90，工作树清洁。
- 用户已确认交互设计及文案精简，随后明确要求产品实施。
- 本轮采用 Conductor 自治验收；材料选择器为独立子任务，根负责合同、呈现、集成与亲自复跑验证。

## 本地集成

- `pnpm check`：616 files passed，4494 tests passed，15 skipped（8 files）；类型、ESLint、strict governance 同次通过。
- `CI=true UI4A_E2E_SHOTS_DIR=/tmp/t61-e2e-shots pnpm e2e 'work-thread-'`：18/18 passed。含权限隐藏、批准回执、30材料读取有界、预览/选择零写入、显式两项添加、390px、200%布局及跨页历史上下文。
- `pnpm --filter @ui4a/web build`：通过。
- 聚焦：工作内容/源格式/刷新保持/选择器/恢复页测试均通过；Red 与 Green 日志位于 `/tmp/t61-*.log`，命令见 plan/review。
- 截图目录 `/tmp/t61-e2e-shots`；根已查看实际主工作面截图，材料未占据默认主区，真实当前对象与其动作可读。
- 全站完整 E2E 与真人长期试用未在本 Track 宣称通过；不关闭 T56/T58/T59 未完成范围。
