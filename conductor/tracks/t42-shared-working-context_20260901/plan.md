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

- [~] Task D1：S1–S8 逐故事验收，真实 LLM 阅读故事、全量 check/format/e2e，系统启动与健康验证。
- [~] Task D2：按 conductor-review 审查并修复，复跑验证，记录证据及 git notes。
- [ ] Task D3：同步必要文档、清理探针、归档 Track，提交闭环（不 push/deploy）。
