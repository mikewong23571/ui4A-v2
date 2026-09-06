# T57 P0 实施定案

基线 bf58603d，实施决定 D79；实施与集成提交 edb35f03、04a90058、416815dc、19ae4e49。
用户明确允许独立 worktree 与 T56 并行，重度验证集中于合并后。本文件记录已执行探针的选择，
精确运行数与最终复验以 evidence.md 为准，不把探针通过当作浏览器或真人验收。

## S1 通用成员姿态与责任保全

选择最小新增 `member-row` pattern/词汇，复用 Surface schemaVersion 1、现有 layout/slot/repeat，
catalog 提升 semantic-v11。列表逐项绑定 label/rel/status/detail/actions/fields/cognitive/members，
消费声明 overview 字段；table/compare 不要求 actions，显式 review-queue 保留 card。
普通有管理动作的对象以行展示，操作使用 disclosure；真实 human-responsibility 使用原决定卡，
已完成责任仍显示回执。只有显式 groupRole 且有 members 才是容器，空 entities 不吞自身责任。
未知认知安全回退可读合同，不从动作名或业务自然语言推断责任。

责任保全位于纯引擎 `presentation/surface/responsibility/coverage.ts`：从当前授权根递归收集声明责任，
验证可读必填绑定、身份/动作或明确嵌套责任链接，以及 view 折叠后的可达性。
Web 接在 generic/Recipe/Sidecar、直接 GET 和候选 patch/revert/promotion/pin 边界；省略或隐藏责任
返回 `409 presentation-responsibility-stale`，拒绝候选不写版本，旧缓存可单次重新规划，无递归重试。
新责任到来时旧折叠视图不能持续隐藏它。授权失败仍为原 403，跨用户存在性隐藏不由呈现改变。

没有新增业务责任清单、布局 DSL、新组件框架、每应用规则或另一渲染器。RJSF、ActionRunner、
ActionSubmit 与已安装 Radix Dialog 原样延伸。Root density 是当前实际消费的视觉变体；
非 root collapse 的既有持久化能力不被当作像素变化证据。

探针/回归：member-posture.test.ts、member-row.test.tsx、responsibility/coverage.test.ts、
Web responsibility/runtime.test.ts 与 sidecar/responsibility/mutation.test.ts；有初始 Red 与修复后 Green。
D54 将实际发现边界扩到 engine presentation、words、actions/action-runner，正负例均保留，无新增例外。

## S2 同一事件中的真实创建输入

选择 canonical `threads#create`：caller 只提交 `goal`，client-owned `commandId` 复用已有
`x-ui4a-input-owner` 注解。没有拓展业务字段定义语法。示例完整命令参数：

```json
{"goal":"核验这次发布的测试证据","commandId":"create-release-review"}
```

纯命令用 commandId 形成 thread id，将 goal 原文与 source=`thread-input:<id>` 放入同一
`thread-created` 事件。read-only thread-input 是该事件的重建投影，不是新事件/状态或伪造 chat message。
来源在创建接受时原子成立，owner 与工作线相同；被拒或插入失败不产生半成品。
相同 owner/key/goal 重试返回 replayed，不追加事件、不重开已完成/归档线；目标或owner冲突拒绝。

UI 保留同动作/同 schema/同参数的失败重试键，成功或修改输入后产生新键；隐藏字段不能伪造。
CLI 自动装配，显式重试用 `--command-id`，成功或不确定错误回执携带 clientParams；不自动重试 POST。
人工直接创建无需 LLM；AI/CLI 仍读取并提交同一合同。拒绝“先写一条随机message再创建”的方案，
也不保留旧 id/goalSource wire 双路径。历史原始事件重放按原事实，不补造历史来源。

探针/回归：work-thread-creation.test.ts、service-tests/service.thread.test.ts（事务失败、并发/重试）、
auth/thread-input.test.ts、CLI action-input-ownership.test.ts、UI action-host-retry.test.tsx。
浏览器额外真实丢弃已接受响应，再重开带草稿的 Dialog 重试，核对同键、唯一创建事件和原文回读。

## S3 首页来源与共同处境

唯一共享 `HOME_WORKSPACE_DECLARATION`（my-work v3）顺序：

| 区域 | 合同来源 | 覆盖 |
| --- | --- | --- |
| waiting-for-me | inbox | 当前可见责任，无归属工作线的责任同样到达 |
| work-lines | threads-current | 当前owner的open/paused线，不依赖有无delegation |
| in-motion | delegations-current | running委托，空态只陈述当前列表 |

threads-history 承载 completed/archived，links 回 canonical threads；delegations-current 同样回链完整集合。
这些均为只读投影，不引入第二状态/聚合服务。当前没有分页的工作线切片保留全部可见成员，不静默截断；
已有业务集合的分页由原合同链接与host处理。页面缓存按观测到的collection回链失效切片和分页变体，
不能因入口rel不同让暂停/完成后仍显示旧状态。

首页React只承载单H1、三个轻入口、共享呈现宿主和默认收起的应用发现（仍≤9，完整目录独立）。
内容标题用H2，空态为轻文本，普通行不展开低频动作。关系链接保持工作台导航与scope/thread/returnTo，
Meta/Draft明确去治理宿主，外部URL不重新解释。

实际 `/` 的clientView selection直接消费同一共享根声明；被页面忽略的focus/roots query不能冒充所见。
“与助手讨论”打开既有FloatingChat并保存实际opener，复用session/draft/SSE；“发起工作”进入canonical
创建合同，不自动建线或代发消息。无首页专属chat store或复制事实。真实LLM读证据与视觉验证另由G3/G4收口。

探针/回归：compositions、presence/location、home.test、work-thread-views；部分源授权、完整/部分Recipe
晋升和Sidecar重读保留既有故障边界；home-presentation/working-context常驻浏览器与模型故事验证同源。
