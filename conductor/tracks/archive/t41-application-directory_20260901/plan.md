# T41 实施计划

## Phase A：合同与信息架构 [checkpoint: 76b4bf96]

- [x] Task: 确认 D46/D51/D54 边界、入口路由、成员判定和首页最多 9 个的缩略预算。
- [x] Task: 记录 D57；核对技能目录，无需引入新技能或依赖。
- [x] Task: Phase Verification & Checkpoint（workflow 自治验收）：用户明确纠正为最多 9 个。

## Phase B：共享目录、缩略入口与导航 [checkpoint: 779200b8]

- [x] Task: Red：目录读取/错误/未知应用、搜索、上下文和缩略形态测试。
- [x] Task: Green：提取共享 reader，新增目录页，首页改为最多 9 个缩略入口，接入稳定导航。
- [x] Task: 更新受影响的首页/E2E 与 source governance，保留 D51/D54 约束。
- [x] Task: Phase Verification & Checkpoint：32 项聚焦 Vitest、typecheck、lint、governance 通过。

## Phase C：可扩展性与用户路径 [checkpoint: 779200b8]

- [x] Task: 浏览器 7/30 应用（首页分别 7/9、目录分别 7/30）、搜索→应用、键盘和 390/640/768/1512px 回归。
- [x] Task: 实际授权 HTTP 与人类目录比对并截图。
- [x] Task: Phase Verification & Checkpoint：相关常驻 E2E、全量 check，记录准确证据。
- [x] Task: 同步有变化的说明、归档 Track 与审计提交，不推送。

## 验证记录

- Red：首页 30→9、用途降级、导航、目录组件/链接测试均先失败。
- 聚焦 Vitest：8 文件 / 32 测试通过，typecheck/ESLint/governance:strict 通过。
- 首轮 5 项 E2E 通过；视觉复查发现 640px 固定顶栏裁切导航，已补几何断言先验红再修复。
- 旧 Meta 修改不属于 T41 完成证据，不在本 Track 提交范围。
- `UI4A_WORKER_HEALTH_PORT=3199 pnpm check`：exit 0，463 文件通过 / 4 跳过，
  3529 测试通过 / 6 跳过；typecheck、ESLint（17 条既有警告、0 error）、严格治理通过。
- `pnpm exec playwright test e2e/interaction/application-directory.spec.ts --workers=1`：5/5。
- `UI4A_WORKER_HEALTH_PORT=3199 pnpm exec playwright test e2e/workstation/workstation-home.spec.ts --workers=1 --grep 'workstation home and'`：1/1，真实 CLI/人类继续读取同源首页实体。
- 自治验收：浏览器截图、原场景与增量应用 fixture 通过；功能提交 `779200b8`。
- 文档同步仅 D57 与本 Track；不改变产品使命、技术栈或视觉品牌。E2E 已作为 standing suite 留在
  `e2e/interaction/application-directory.spec.ts`，无一次性脚本/专用配置遗留。
