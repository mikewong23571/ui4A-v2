# T60 Plan

## Phase 1: 取证与协议修复

- [x] 核对生产事件与逐步 prompt，确认重复提议及审计漏项。
- [x] 写失败测试：同 run 命令身份、真实 kernel 重放、工作线审计、会话过滤及成功披露。
- [x] 实现宿主命令身份复用、工作线审计接入、会话关联与成功回执披露。
- [x] Phase Verification & Checkpoint：focused 24 tests 与 governance，自治验收。

## Phase 2: 回归与验收

- [x] 跑 pnpm check（4464 passed）；隔离 HTTP 真实模型创建后追问与原始事故只读重放。
- [x] 真实模型发现项补正：local GET/exec 同 principal、审计与实体引用分离；6 focused
  tests 与增强真实模型用例通过，所有实体引用经 HTTP 逐一回读。
- [x] Phase Verification & Checkpoint：聊天浏览器 7 passed；模型证据与部署边界已记录。
- [x] 归档 Track；功能提交 `0cf8df10`，验收记录见 evidence.md。
