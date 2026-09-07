# T59 Plan

## P0 基线与合同
- [x] Task: 核查 review、正典、工作树、线上版本、运行服务与治理；授权已含修复部署。
- [~] Task: 记录必要决定与实施分工；定位模型提供方和线上定义版本。
- [ ] Task: Phase Verification & Checkpoint。

## P1 修复（分离范围并行实施，主会话复跑）
- [~] Task: F01/F02 Red→Green：消息成员解析与声明状态标签、跨 principal 负例。
- [~] Task: F05/F08 Red→Green：上下文导航与成员变更失效同步。
- [~] Task: F03/F04/F06/F07 Red→Green：动作/移出/校验与机械信息披露。
- [~] Task: F09 Red→Green：提供方会话请求与真实成功；失败历史和恢复。
- [ ] Task: F10/F11 Red→Green：新建清空、待办声明更正/收尾、线上治理与存量边界。
- [ ] Task: Phase Verification & Checkpoint：主会话复跑每项 focused tests 与 governance。

## P2 集成与审查
- [ ] Task: check、适用 E2E/invariants、build、格式；修复失败并重新验证。
- [ ] Task: 按 F01–F11 复审最终代码、授权/重放/声明边界与效果。
- [ ] Task: Phase Verification & Checkpoint：固定发布 candidate SHA。

## P3 部署与公网验收
- [ ] Task: exact SHA 导出、三镜像构建与 digest/OCI 核验、备份 manifest。
- [ ] Task: preflight/up/status、live/version、保留卷与公网状态合同。
- [ ] Task: 浏览器复验原消息、新消息、导航、移出、表单、状态与真实模型；补窄屏与缩放。
- [ ] Task: 同步 DEPLOYMENT.local.md 至 home 并比较 SHA256；更新 evidence/DONE/registry。
- [ ] Task: Phase Verification & Checkpoint：交付修复、部署与未解决边界。
