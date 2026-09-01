# T42 实施计划

基线：2d691c12；初始工作树干净，governance 通过。验收由编排 agent 代行。

## Phase A：用户故事与探针 [checkpoint: 0bd39a0]

- [x] Task A1：先定义 S1–S8，验证发现起点/工作线读取/后台传递的最小路径，固化 D58 与详细接口。
- [x] Task A2：Phase Verification & Checkpoint（workflow）：探针完成并删除，目录2项Red晋升常驻测试；基线与选型见spike.md。

## Phase B：合同与 Agent 工作上下文 [checkpoint: bf9ad8f]

- [x] Task B1：Red→Green：发现起点、显式清空、工作线 HTTP 读取、按当前观察披露；S1–S5/S8。bf9ad8f
- [x] Task B2：Red→Green：inline/delegated 的引用传递、恢复与授权一致；S6。bf9ad8f
- [x] Task B3：Phase Verification & Checkpoint：主进程83/125定向测试、真实Temporal恢复、真实LLM2故事、typecheck/governance、覆盖率94.87%；详见evidence。bf9ad8f

## Phase C：简洁的人类入口 [checkpoint: db1bf65]

- [x] Task C1：Red→Green：应用标题选择与复用弹层的工作上下文链接；S7；不添加冗余描述。db1bf65
- [x] Task C2：Phase Verification & Checkpoint：27组件测试；主进程真实HTTP工作线E2E、1512/390px截图与目视检查通过。db1bf65

## Phase D：整体验收与闭环

- [x] Task D1：S1–S8代码验收：check3585通过、E2E65通过、实模2通过、覆盖率96.64%、format通过；见evidence。
- [x] Task D2：按 conductor-review 审查并修复，主进程复跑；测试隔离前置检查已加固。
- [~] Task D3：开发环境恢复：已获授权，备份并精确移除seq524，触发器恢复，CLI验证应用读面；待记录提交。
- [ ] Task D4：恢复后核对应用/工作树，归档 Track，提交闭环（不 push/deploy）。
