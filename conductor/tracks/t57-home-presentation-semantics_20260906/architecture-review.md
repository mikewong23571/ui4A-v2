# 架构承载与愿景审查 — 2026-09-06

## 1. 结论及证据边界

**现有架构支持本次演进，不需要推倒重建；承载前提是扩展通用呈现语义，继续复用合同/投影/裁决，
并限制组件与适配层的代码增长。** 当前风险集中在“结构字段替代用户任务”的呈现选择、门禁覆盖盲区、
窄模块接近大小上限与部分执行语义不一致。界面难用不等于业务内核失败，门禁全绿也不等于愿景已经实现。

本轮是跨模块结构审查与选定链路验证，非逐行全仓安全审计、生产容量压测或部署认证。
代码基线 `0b14b89e4143378832b8a60d5ae5ccbb26ed3234`；开始时仅 T56 plan 存在他人未提交修改。
本轮未修改产品源码、T56 或 DECISIONS。前几轮首页截图是已观察证据，未与线上部署 SHA 对齐。

## 2. 整体结构是否支持持续迭代

```text
已激活定义 + 事件日志
        ↓ fold / project
    授权 Siren 实体与动作 ───────────────→ CLI / 外部 Agent
        ↓                                  │
认知声明 + intent + PresentationRequest     │
        ↓                                  │
Broker → Recipe / Sidecar → Surface         │
        ↓ fresh authorize + dereference     │
通用词汇 / 人类界面 → ActionSubmit → HTTP / exec
                                         ↓
                                 纯裁决 + 同一事件日志
                                         ↓
                              Temporal 编排 → activities I/O
```

| 边界                | 当前核对                                                                                       | 对本次重构的意义                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| shared/engine/agent | workspace manifests 与 GR1：shared 无平台依赖；engine 依 shared 与纯库；agent 依 engine/AI SDK | 认知字段和呈现策略可留在纯边界，不必把 Web 拉入内核               |
| db/事件真相         | db 为独立平台包；service boot/readLog/fold，execCore 复用队列、日志和投影                      | 首页不需要数据库“今日摘要表”或另一任务状态库                      |
| 业务定义            | 活跃定义由 fold 注册，Application 通过数据提供语义                                             | 扩展域的成本应落在定义/声明，不落在每应用组件                     |
| 授权/注意力         | Broker 输入 grantedApplications，逐源 getEntity；D51 与 D78.3 限定可见口径                     | 折叠、排序、助手上下文不能扩大授权或披露被裁对象                  |
| Presentation        | 现有 composition、generic、catalog、Recipe promotion、Sidecar dependencies                     | 列表/决定卡的变化有现成接入点，不需新模板平台                     |
| 提交/确认           | SurfaceActionAdapter fresh read/schema/dependency 检验；服务端裁决、确认专用路径               | 改按钮位置或表单宿主可以保留执行通道；仍须验证各 specialised 分支 |
| Chat/CLI            | Chat 是日志投影；CLI 只依 HTTP，无 Web/DB 依赖                                                 | 首页助手入口只能复用现有 session 与上下文，不能成为第二入口协议   |
| 能力平面            | workflows 通过 proxyActivities 编排，I/O 在 activities；runner 独立于 HTTP 读面                | 本次 UI/语义重构无须修改 Temporal、Runtime Backend 或 provider    |
| 治理                | strict 检查通过，但部分组件路径不在 D54 扫描集；多个模块贴限                                   | 有执行工具，但还需将本次 recurring 坏模式纳入适当门禁             |

上述为抽样源码与机械检查支持的结构结论，不声称每条调用路径都已全量验证。

## 3. 已发现的具体风险

### A1 — 高：可操作性被过度当作“需要决定”

`packages/engine/src/presentation/surface/generic.ts` 的 `membersDeclareActions = entities.some(...)`
参与整组成员的 card/table 选择；`render/words/member-card.tsx` 把整组 actions 交给 ActionGroup。
`intent.ts` 已支持认知 traits，但当前默认姿态仍不足以区分浏览、责任、比较。
后果是带管理动作的工作线占满首页；某个成员有动作也可能改变整个集合的呈现。

处置：T57 FR02/03，先修订 D50 与 D78.2 关于“有动作→决策卡”的局部假设，保留 D78 单线程主体路线、
责任可达和现有真实确认卡。不能用“隐藏所有动作”或每实体类型分支替代。

### A2 — 高：组件层的“无应用特判”不能由当前 D54 全面证明

执行 `checkD54()` 并检查其 runtimeFiles，得到：

| 文件                                                          | 扫描集包含 |
| ------------------------------------------------------------- | ---------- |
| packages/engine/src/presentation/surface/generic.ts           | false      |
| apps/web/src/render/words/member-card.tsx                     | false      |
| apps/web/src/components/actions/action-group.tsx              | false      |
| apps/web/src/engine/presentation/app-workspace/composition.ts | true       |

不能仅看 glob 表面就断言子目录遗漏：现有 git pathspec 实际包含 app-workspace 子目录。
问题是前述 pure planner、words、actions 的明确边界未覆盖；且扫描已安装名字的规则也无法证明所有语义特判。
处置：T57 FR10 扩展有针对性的路径/反例测试，保留合法核心 rel/协议分发；用“应用重命名/新应用”的
跨域 fixture 补语义证据。避免把所有字符串比较一律封禁，也不新增大而全架构扫描平台。

### A3 — 中：模块增长空间紧，改 UI 可能迫使临时补丁堆叠

strict 实测有效行：engine/execution 3986、engine/definition 3979、web/chat 3974、
components/chat 3937、service-tests 3918、engine/presentation 3707；上限均 4000。
“未超限”不代表适合继续堆功能，尤其新增测试同样占目录计数。
处置：按相邻功能拆 posture/collection/action-host 子模块，迁移保留测试；不删故事、不恢复例外。
本次不顺手重构 worker/runner 或无关贴限目录。

### A4 — 中：当前首页聚合的覆盖范围与人话承诺不完全匹配

`app/page.tsx` 将 ApplicationEntryStrip 置于主面之前；`presentation/compositions.ts`
的 my-work 来源为 inbox/delegations/threads。“在动”来自 delegations，却显示“没有正在推进的工作”；
空集合、工作线 lifecycle 与整个业务世界不能等同。原始列表还把完成/归档项与当前工作混在一起。
处置：先界定来源覆盖，按已声明工作角色组织；默认只陈述“当前可见”范围，缺证据不生成进展/验收结论。

### A5 — 高（已知执行边界，不在本 track 修复）：确认标注不总等于服务端确认门

D78.4 与本轮 `engine/exec/service-exec.ts` 复核一致：thread:* 直入 execThreadAction，
不经过普通业务 executeWithGates；D78 记录 agent archive 可 accepted 的探针。
不能把 UI 上的 high/“危险操作”当成服务端必需人批的证明，也不能声称所有 specialised 动作裁决完全等价。
本轮未重跑这一 DB 行为，行为证据来自当前 D78，路由由源码确认。

T57 只要求风险文案不虚构服务端承诺、卡片不以 high 推断不可逆，并保留原服务端行为测试。
线程生命周期确认语义的修复需独立执行合同决策，不由组件重构暗改，也不标已解决。
若实施需要承诺“thread archive 必须经服务端确认”，必须先提出新增范围与决定，不能靠前端多一步蒙混。

### A6 — 中：任务状态文档出现漂移

T56 plan 已有 P0 checkpoint/P1、P2 在途，metadata/registry 仍写 new/未开工。
这不证明代码结构失效，但会使接手者重复规划或同时修改相同模块。
T57 以实际提交、细任务与证据为交接输入；本 track 关闭前校验自己的三处状态一致。
不改写其他执行者的在途文档，也不把这项低成本校验扩展成新项目管理系统。

## 4. 与原始愿景的关系

符合愿景的变化：让日常工作可扫读；重要决定集中事实与依据；输入来源由真实记录承载；
通用词汇和语义声明随应用扩展；AI 保持理解/解释/规划主体，人和 AI 仍从同一合同进入。

会脱离愿景的变化：

1. 在首页 React 中固定拼“研发/安全/写作”面板，或用业务名/状态词猜组件。
2. 为展示增加独立“当前任务、完成率、AI 简报”数据库真相。
3. 用模板、正则、优先级评分器代替 AI 判断目标；或反过来让 LLM 决定隐藏真实责任。
4. 把组件名、颜色、像素尺寸塞进业务 cognitive 定义，演化成新的页面 DSL。
5. 为自然语言入口新造 chat session/store、写入通道或自动扩大工作线成员。
6. 用手工缩略首页获得好截图，却让 generic、Recipe、个人 Sidecar 和未知应用失效。

因此允许“确定性的界面安全与表达规则”，但不得把它包装成 Assistant 智能。
需要新增的应是小而通用的语义/词汇，不是越来越多的应用专页。

## 5. 本轮已执行验证

`pnpm governance:strict`：退出 0，GR1–GR5 相关常驻检查、D54、Meta 路由检查通过，空例外。

```bash
TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_t57_audit_test \
NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run --project unit \
  packages/shared/src/definition/cognitive-semantics.test.ts \
  packages/engine/src/contract/cognitive-semantics.test.ts \
  packages/engine/src/presentation/surface/intent.test.ts \
  packages/engine/src/presentation/surface/surface.test.ts \
  packages/engine/src/presentation/recipe/promotion.test.ts \
  packages/engine/src/presentation/compose/composition-fastpath.test.ts \
  packages/engine/src/execution/confirmation.test.ts
```

结果：**7 个文件、91 个测试通过，退出 0**。使用独立命名测试库，避免干扰 T56 探针。
另执行 D54 runtimeFiles 精确成员检查，结果见 A2；不把 governance PASS 解释成这些缺口不存在。
未执行 full check/E2E/build/真实模型/生产压测；不以 pure 测试证明首页体验或线上效果。
