# T57 Acceptance

> 2026-09-06 执行修订：用户明确授权在独立 worktree 与 T56 并行实现，覆盖此前等待 T56 完成的串行限制。
> 基线 bf58603d（T56 P3 已提交），worktree `/Users/mike/projs/playground/ui4A-t57`，分支 `codex/t57-home-presentation`。
> 中间执行必要 Red/Green 定向测试；阶段重度/E2E/真实模型/全量验证集中在合并主仓库后执行。
> 合并必须保留 T56 在途修改，先集成其最终提交；未完成统一门禁不标 DONE。


本文定义实现完成标准；当前按用户授权将浏览器/重度验证集中到主仓库合并后。各故事结果见 evidence.md；未执行项不得以规划完成代替。

## 1. 隔离 fixtures

复用现有 E2E/Story Eval kits 与 T56 完成后的领域 fixtures。每次用唯一 runId，数据库名以 `_test`
结尾并与其他执行者隔离，Temporal 使用隔离测试地址。不得写开发/生产库或复用线上 ux0905 数据。

- F1：首页一条当前责任、一条 open 工作线、一项已完成工作、一项归档工作，关联来自两个应用。
- F2：无当前责任，有 open/paused 工作线，无 delegation；以及仅历史、全空的独立情形。
- F3：同一集合含有管理动作对象、人类责任对象、历史责任、无动作对象；同对象分别做 overview/review/compare。
- F4：目标很长、30 条工作线、分页跨页有责任；来源延迟/网络失败/权限收回，另 principal 隔离。
- F5：新的、改名的 application/flow，语义相同；另有缺语义合同。不能改组件适配名字。
- F6：generic、已保存 Recipe、个人 Sidecar 三种形态；尝试藏责任、字段更新、schema/授权变化。
- F7：直接创建的输入 provenance、重复提交/id 冲突/失败重试，配置无效模型后再创建。
- F8：首页 session 有未发草稿/在途 SSE，进入 T56 工作线再返回；Meta 责任需显式进入治理宿主。

测试的 actor=human 仅使用隔离 harness 的既有合法测试身份；产品不能通过伪造 actor 让 agent 批准。

## 2. 用户故事与需求追踪

| Story                     | Given / When / Then                                                                                                                                               | FR / Phase           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| US01 首页恢复处境         | F1 打开首页：责任、可继续目标优先可见，应用书架不是默认首要内容；历史独立到达，状态不重复                                                                         | FR01/07/08；P2/P3    |
| US02 空与覆盖诚实         | F2/F4 打开首页：open 线在无 delegation 时仍可继续；全空简洁可发起；错误不当空，被裁只陈述当前可见，不泄露名称/数目                                                | FR01/09；P2/P4       |
| US03 组件按任务变化       | F3 同对象换 intent、混合集合逐项呈现：普通可操作对象是摘要行，当前责任保留决定入口，比较表格不依赖有无 actions；未知不猜责任                                      | FR02/03；P1          |
| US04 决定完整且当前       | F1/F8 查看并完成责任：对象/动作/可得前后/依据/未知边界集中，fresh 提交和回执保留；agent approve 拒绝；Meta 显式治理桥与回程正确                                   | FR03/09；P1/P3/P4    |
| US05 低频动作可达         | F3 摘要行使用更多菜单→选择需输入动作：菜单只选命令，合法操作不丢，目标不串行，旧 schema/双次点击/被拒均诚实                                                       | FR03/04；P1/P3       |
| US06 输入宿主可用         | 直接创建或局部编辑使用适当宿主：不无谓推走首页内容；Escape/取消/焦点恢复/重开/错误保留输入，菜单与 modal 语义正确                                                 | FR04/07；P3          |
| US07 只填目标建线         | F7 human 从首页只输入目标且来源可选：实际创建成功，id/来源真实可追溯，重试无重复；CLI/agent 同合同；无 LLM 直接创建可用                                           | FR05/09；P0 S2/P3    |
| US08 助手同源协作         | F1/F8 用户问“这里哪些在等我，只读取”：真实 LLM 谈对当前可见事实且给有效来源；讨论与直接创建意图区分，首屏加载零自动提问/建线                                      | FR06/09；P3/P4       |
| US09 跨页不断线           | F8 首页→本线/对象→返回、开关助手：沿 T56 client navigation 保留草稿/session/SSE，实际 clientView 跟当前位置，来源不丢                                             | FR06/08；P3/P4       |
| US10 任意合法应用         | F5 新增/改名语义等价定义：无需改 generic UI 即呈现同类姿态/动作；完整应用发现可达、书架不超九项、未知合同不消失                                                   | FR02/08/10；P1/P4    |
| US11 缓存与责任保全       | F4/F6：Recipe/Sidecar 尝试折叠/省略责任后仍明确可发现；分页不漏到达；新责任/值/动作/授权变更使视图及时失效/重取，无旧许可复用                                     | FR01/09；P1/P2/P4    |
| US12 视觉/可访问/架构门禁 | 1440×900、1080×820、768×1024、390×844 与桌面 200%：正文/标题/按钮可读，无 body 横滚，键盘/触屏可操作；模型失败仍可人工完成；扩展 D54 可抓新违规且合法协议分支通过 | FR07/09/10；P1/P4/P5 |

“只读”允许既有 chat/presence 日志和本次 user message 的显式 owned-thread attach；
按 channel/messageId 精确对照，不能放行其他领域写入、生命周期变更或额外材料挂接。
“已完成/归档”不等于验收通过；无历史前值、来源或实际时间时明确缺失，不用今天的事实补造。

## 3. Gate 与执行命令

完整需求映射（避免斜线简写在机器校验/交接中丢项）：FR01→US01/02/11；
FR02→US03/10；FR03→US03/04/05；FR04→US05/06；FR05→US07；
FR06→US08/09；FR07→US01/06/12；FR08→US01/09/10；
FR09→US02/04/07/08/11/12；FR10→US10/12。

从仓库根运行；P0 按 T56 最终落位更新必要迁移路径。新增 E2E 放常驻领域目录，不新建 per-track config。
所有命令先确认独立 TEST_DATABASE_URL 与对应 DATABASE_URL、端口/Temporal隔离；不杀无关服务。

### G1 纯语义、词汇与防特判

```bash
pnpm governance:strict
pnpm vitest run scripts/governance/check-d54.test.mjs
pnpm vitest run --project unit packages/shared/src/definition/cognitive-semantics.test.ts packages/engine/src/contract/cognitive-semantics.test.ts packages/engine/src/presentation/surface/intent.test.ts packages/engine/src/presentation/surface/surface.test.ts
pnpm vitest run apps/web/src/render/words apps/web/src/render/presentation
```

新增用例覆盖 US03/10/11 的语义反例，不以某段 className 或静态截图代替组件选择行为。
D54 既测试 inspect 函数，也测试实际扫描路径集合：generic.ts、words、actions 在作用域内，
合法协议分发/核心 thread rel 分支不得误报；无例外注册表逃生。

### G2 动作/创建与首页读源

```bash
pnpm vitest run apps/web/src/components/actions apps/web/src/engine/presentation apps/web/src/engine/service-tests/work-thread
pnpm vitest run packages/engine/src/projection/work-thread.test.ts packages/engine/src/execution/confirmation.test.ts
```

按 S2 最终 schema/ingress/CLI 落位补精确 source、幂等、拒绝、回执与 replay 测试命令。
若有存储/事件变化必须补 DB replay；不只验证“表单没展示字段”。
危险色/确认文案调整不能改变服务端身份与合法性，D78.4 差异保留可见测试证据而非宣称修复。

### G3 浏览器故事

在 `e2e/workstation/home-presentation.spec.ts` 新增上述首页故事，复用现有 suites：

```bash
CI=true pnpm e2e e2e/workstation e2e/interaction/application-directory.spec.ts e2e/interaction/working-context.spec.ts e2e/interaction/chat-citations.spec.ts e2e/chat.spec.ts
```

截图至少：责任优先、有工作无委托、历史/全空、列表与决定卡混合、直接创建前后、输入失败、
菜单/Dialog 键盘路径、窄屏助手、来源不可读与 Sidecar 责任保全。标明 viewport/route/fixture/SHA。
review 实际看像素与 DOM，检查标题层级、控件辨识、滚动/焦点/草稿；不得仅据测试绿灯宣称好用。

### G4 真实 LLM 与生成式呈现

将 US08 加入既有 `e2e/eval/working-context.spec.ts`；将相关 Recipe/Sidecar 场景加入
`e2e/eval/t16-real-llm.spec.ts`（读取现行项目名，不创建额外配置）。

```bash
RUN_LLM_EVAL=1 RUN_LLM_E2E=1 \
DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_t57_eval_test \
TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_t57_eval_test \
pnpm eval:llm --project=working-context --project=t16-real-llm
```

通过安全环境装配提供 LLM_API_KEY/LLM_BASE_URL/LLM_MODEL，不在文档/日志写值；
若新增独立 spec 必须注册现有 `playwright.eval.config.ts` 的 project 并更新命令。
缺配置/零用例/skip 记 NOT RUN，不可完成本 track；真实模型回答要人工核对任务与来源，
机械检查事实指向与零未授权 effect，禁止只用关键词评价“答得对”。

### G5 集成收口与愿景验证

```bash
pnpm check
CI=true pnpm e2e
CI=true pnpm e2e invariants
pnpm --filter @ui4a/web build
```

精确文件 Prettier、适用新代码 >80% 覆盖率及 T56 接手回归另记录。脚本/路径调整同步到本文件。
基于同一 fixture 前后对照：找当前责任/继续工作所需步骤、发起必须手填的机器字段数（目标=0）、
决定前跨页次数、是否要重新解释背景、无关按钮数量。真人时间/厌烦感未测须写未测，不能伪造收益。

### G6 Review → Fixes → Re-review

P5 reviewer 审查实际 base→HEAD diff、FR/US证据、截图、T56 回归、91 项基线未涵盖的新增边界。
记录 reviewer 身份/独立性；无独立 reviewer 时明确自审限制，仍另起 review pass。
所有范围内失败故事和阻断性 P0/P1/P2 必须修复并复测复审；无 finding 不造修复提交。
architecture-review A5 是显式已知非目标，不得标修复或误当本次新引入漏洞；新增扩大该差异则阻止完成。

## 4. 证据和完成纪律

实施期创建 evidence.md，按 US/FR/G 编号登记被测 SHA、dirty状态、命令、退出码、用例数、
fixture、截图、合同/事件对照、PASS/FAIL/NOT RUN、finding/修复 commit/复审结果。
保留精简证据，不提交 credentials、DB、`.next*` 或完整 Playwright 输出目录。
探针代码转为常驻门禁或删除；最终 DONE 分列实现/单测/浏览器/真实模型/真人观察/部署。
不包含发布，线上状态写未部署未验证；所有必需门禁通过后才完成/归档，metadata/registry/plan 同步。
