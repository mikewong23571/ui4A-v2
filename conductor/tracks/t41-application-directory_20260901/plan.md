# T41 实施计划

## Phase A：合同与信息架构

- [ ] Task: 确认 D46/D51/D54 边界、入口路由、成员判定和缩略高度策略。
- [ ] Task: 记录 D57；核对技能目录，无需引入新技能或依赖。
- [ ] Task: Phase Verification & Checkpoint（workflow 自治验收）。

## Phase B：共享目录、缩略入口与导航

- [ ] Task: Red：目录读取/错误/未知应用、搜索、上下文和缩略形态测试。
- [ ] Task: Green：提取共享 reader，新增目录页，首页改单行缩略，接入稳定导航。
- [ ] Task: 更新受影响的首页/E2E 与 source governance，保留 D51/D54 约束。
- [ ] Task: Phase Verification & Checkpoint：聚焦 Vitest、typecheck、lint、governance。

## Phase C：可扩展性与用户路径

- [ ] Task: 浏览器 7/30 应用、搜索→应用、键盘滚动和 390/640/768/1512px 回归。
- [ ] Task: 实际授权 HTTP 与人类目录比对并截图。
- [ ] Task: Phase Verification & Checkpoint：相关常驻 E2E、全量 check，记录准确证据。
- [ ] Task: 同步有变化的说明、归档 Track 与审计提交，不推送。

## 验证记录

待实施后记录命令与实际结果；旧 Meta 修改不属于 T41 完成证据。

