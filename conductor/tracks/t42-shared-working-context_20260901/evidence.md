# T42 验收记录

所有检查点由编排 agent 代行；不把协议桩测试当成真实 LLM 验收。

## Phase A

- 基线 2d691c12 干净；governance 通过。
- 可抛弃探针：applications Siren 可复用必需 entity 的 loop；跨应用观察与固定 app
  的冲突已复现；category-link 重读及预算可行。探针已删除。
- 目录2项Red；清空/起点/嵌入授权5项Red；后台起点和固定引用3项Red；UI首轮5项Red。

## 主进程复跑

- 主进程复跑12文件83测试通过（38.12s），包含真实 Temporal SIGKILL→恢复；
  `UI4A_WORKER_HEALTH_PORT=3199 pnpm vitest run` 加 Phase B 对应文件列表。
- Agent/Stage/Situation/Start/目录47文件342测试通过；V8核心变更模块覆盖率：
  statements91.95%、branches85.71%、functions92.85%、lines94.87%。
  为执行已有workflow覆盖率要求补充同版 @vitest/coverage-v8 开发工具。
- 真实 LLM：`node scripts/with-local-env.mjs env
  DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test
  TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test
  RUN_LLM_EVAL=1 CI=true pnpm exec playwright test
  --config=playwright.eval.config.ts --project=working-context`。
  两个故事均通过（20.0s）：全局应用概览；同线文章+评论跨应用关联解释。业务对象不变。
  仅测试库重置；开发数据库未清空。

## 审查修复

1. 真正的 Thread.resume 是状态文本而非rel；按其原始active来源判断是否披露。
2. threads 集合递归裁剪嵌套引用，避免根已裁剪而内层泄漏。
3. 引用其他owner工作线与缺失工作线同样不披露；事件本身不改写。
4. 切线必须导航新线实体，不只改thread参数而保留旧focus。
5. Meta集合无properties.title时，在exact成功前提下取同平面授权sitemap标题。

上述均补真实投影/行为Red→Green测试。子任务报告：授权10文件72通过，Stage25通过；
最终由主进程全量复跑确认，不仅依据子任务报告。

## 浏览器观察

- 实际 /meta/entity?rel=meta%2Fapplications：当前对象显示“应用定义”，不再是raw rel
  或“无法读取”；“应用”选择显示合同中文名。
- 390px 弹层在视口内，无横向溢出；未添加解释段落、教程或新卡片。
- 独立工作线桌面/窄屏交互与截图由 standing `e2e/interaction/working-context.spec.ts`
  验收，包含真实HTTP建线与跨应用引用以及切线。

## 最终门禁

- 完整 E2E 最终隔离复跑：65 passed、24 skipped（既有可选/退役项目；T42 实模单独跑），
  4.0m。命令为 `TEMPORAL_ADDRESS=localhost:7235 DATABASE_URL=.../ui4a_test
  TEST_DATABASE_URL=.../ui4a_test UI4A_WORKER_HEALTH_PORT=3199
  UI4A_DIST_DIR=.next-e2e-root CI=true pnpm e2e`。
- 最终覆盖率：49文件378测试通过；核心变更模块 statements93.89%、branches87.60%、
  functions95.78%、lines96.64%。
- 临时 Next 根缓存初次未被忽略导致 Tailwind 扫入二进制并产生非法 CSS；缓存已移至
  /tmp/ui4a-t42-cache.qniBod，Git/ESLint 对 `.next*` 构建产物统一忽略。应用断言未放松。
- 完整 check 最终通过：471文件通过、4文件跳过；3585测试通过、6项既有跳过。
  typecheck、ESLint零错误（16项既有警告）、governance:strict通过；format:check通过。
- 实模最终复验在最新授权实现和隔离前置检查下再次2项通过（18.5s）。
- 防复发：standing test-isolation 检查2项通过，Playwright/场景装置在写入前拒绝
  非_test数据库和默认开发Temporal（含省略端口的loopback），默认使用测试库/7235。
  未改变通知时限、审批或业务结果断言。

| 故事 | 结果 | 证据 |
| --- | --- | --- |
| S1 | 通过 | applications投影、loop-working-context、route、实模global-capabilities |
| S2 | 通过 | start-chain合法focus、Meta真实浏览器、授权sitemap标题测试 |
| S3 | 通过 | Situation null、workstation-situation E2E、真实切线 |
| S4 | 通过 | 工作线HTTP读取、独立线负例、实模workline-resources |
| S5 | 通过 | A→B观察不改选择、按步重读sitemap、授予收回负例 |
| S6 | 通过 | 真实Temporal SIGKILL恢复，原线新状态与引用；生产拒绝不冒充主体 |
| S7 | 通过 | Stage27测试、桌面/390px真实HTTP E2E和截图、重复chip去除 |
| S8 | 通过 | 32KiB wire、嵌套/来源/owner裁剪、全check、I5重放、I3/I4 E2E |

代码故事通过不等于开发环境已恢复；下面的操作事故仍阻止最终闭环。

## 开发环境恢复阻塞（需用户授权）

第一次完整E2E使用默认Temporal队列时，开发Worker误消费测试通知，在开发日志写入
seq=524，ts=2026-08-31T17:01:45.933Z，kind=notification-delivered，
rel=confirmation:c1，principal=user:mike，channel=notify，notificationId=notif:c1。
开发库没有对应confirmation，重启后引擎据实拒绝重放；未掩盖完整性错误。
该误写由本次编排操作造成，已向用户说明并请求“备份后仅移除这条测试记录”的授权。
未授权前不删除、不清库，不把Track标成完成。当前开发dev:all已重启，但业务读面因
该单条记录仍不可用。测试已改用临时内存Temporal7235，与开发7233隔离。

## 开发环境恢复结果

- 用户明确授权后，以事务锁定events表；先导出seq524完整行到
  `/tmp/ui4a-t42-event-524-backup.json`（0600），SHA-256为
  `ee2e240bfc51f09fad5463abae8885e210ce853249a8b732c3dbdc5edc6f1626`，
  校验文件为同路径加`.sha256`。
- append-only触发器先按设计拒绝DELETE，事务回滚。随后在同一锁定事务中临时停用
  `events_append_only_trigger`，以seq/kind/rel/actor/principal/channel/action/
  notificationId/1ms时间窗精确匹配并删除1行，立即恢复触发器、确认seq不存在后提交。
- 未清库、未重排序列、未改其他记录；备份校验通过，可据此手工恢复。
- 主进程用CLI重新验证：health/business/meta均200；8个Application定义可发现；
  业务`applications`目录7项（排除system-fallback）；articles保持2项。
- `pnpm dev:all` 已恢复并继续运行。Track现在满足可运行里程碑要求。
