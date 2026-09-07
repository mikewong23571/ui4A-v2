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

## 发布与公网

- 发布源码：`fcd9640268faa45061bbde00c9c0411f7de6bb77`。`CI=true pnpm e2e invariants`：20 passed / 8 skipped。
- home exact Git archive 构建 web/worker/runner 三镜像，linux/amd64 与 OCI revision 一致；digest 在本地 gitignored DEPLOYMENT.local.md 及 home 运维记录中固定。
- preflight / up / status 成功，8 个长期服务 healthy；9 个 retained volume 名称与 settings hash 不变，无 schema/realm/edge/model 配置变更。
- 公网 `/version` 与 `/live` 200，目标 SHA 已核对；匿名首页/meta 307、API 401、account 302。
- 原生浏览器重新完成 mike 登录，复验原工作线：材料默认收起，空线无移出，弹层指向当前目标；搜索、单项预览、返回保留搜索，勾选后仅显示待提交数，取消后仍是材料 0。本次公网走查未提交业务写动作。
- 本地/home 运维文档 SHA-256 同为 `6f7868a64bb07a1e50c77c98db26104916b76ab2dff2656cd349e22e7cb9be44`。
- 持久证据：`/Users/mike/Documents/UI4A-ops/evidence/t61-work-context-20260908/` 与 `home:/home/mikewong/services/ui4a-ops/evidence/t61-work-context-20260908/`。
