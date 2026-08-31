# T42 实施计划

基线：2d691c12；初始工作树干净，governance 通过。验收由编排 agent 代行。

## Phase A：用户故事与探针

- [~] Task A1：先定义 S1–S8，验证发现起点/工作线读取/后台传递的最小路径，固化 D58 与详细接口。
- [ ] Task A2：Phase Verification & Checkpoint（workflow）：运行可抛弃探针、记录事实和选型，删除探针代码或晋升为常驻测试。

## Phase B：合同与 Agent 工作上下文

- [ ] Task B1：Red→Green：发现起点、显式清空、工作线 HTTP 读取、按当前观察披露；S1–S5/S8。
- [ ] Task B2：Red→Green：inline/delegated 的引用传递、恢复与授权一致；S6。
- [ ] Task B3：Phase Verification & Checkpoint：复跑上述测试、typecheck/governance、覆盖率与 HTTP。

## Phase C：简洁的人类入口

- [ ] Task C1：Red→Green：应用标题选择与复用弹层的工作上下文链接；S7；不添加冗余描述。
- [ ] Task C2：Phase Verification & Checkpoint：组件测试、浏览器桌面/390px、同源合同验收。

## Phase D：整体验收与闭环

- [ ] Task D1：S1–S8 逐故事验收，真实 LLM 阅读故事、全量 check/format/e2e，系统启动与健康验证。
- [ ] Task D2：按 conductor-review 审查并修复，复跑验证，记录证据及 git notes。
- [ ] Task D3：同步必要文档、清理探针、归档 Track，提交闭环（不 push/deploy）。
