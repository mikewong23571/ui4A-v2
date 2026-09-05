# T57 Design

## 1. 设计边界与默认形态

```text
稳定壳：我的事                           应用/工具、账户
紧凑的目标/提问入口（复用现有会话；直接创建意图可区分）
────────────────────────────────────────────────────
当前最值得关注的授权内容（声明/Presentation 组织）
  待决定：对象、变更、依据、责任入口
  可继续：工作目标、当前状态、有效变化、进入链接
最近结束 / 完整列表 / 能力发现，按需到达
```

这里是信息层级示意，不是新固定三分区。来源集合与内容区域由声明提供；壳只有导航、输入宿主、
布局与动作机制。不得将首页改成手工 `HomeDashboard` 聚合器，也不把首页业务数据塞到 chat 状态里。
“无责任/有工作/历史/无工作”的摆放是版本化呈现规则，不写成自然语言助手或隐藏事实的评分模型。

## 2. 组件选择合同

| 用户任务          | 默认形态                                        | 证据/语义来源                                  | 不允许                                       |
| ----------------- | ----------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| 扫读和选择工作    | 标题＋状态/关键变化的列表行＋进入链接＋次级操作 | 已声明工作角色、overview intent、canonical rel | 有任一 action 就将整集合铺为决定卡           |
| 当前需要人判断    | 决定卡、就地依据、当前动作组                    | fresh 人类责任/确认投影，保留逐成员语义        | 只因 high 或 action 非空宣称当前责任         |
| 横向比较          | 语义表格，列来自声明字段                        | 比较意图/已声明 overview 列                    | 纯因有无动作决定能否用表格；把长文塞进小格   |
| 查看历史/辅助信息 | disclosure＋有限活动列表                        | 声明历史、来源事件/时间                        | 全量流水强制首屏、归档=成功                  |
| 创建/编辑         | 现有 RJSF 输入核＋合适任务宿主                  | action schema、输入语义、是否需要参考内容      | 每 action 名写一个表单组件；跨菜单嵌套大表单 |
| 选择来源材料      | 授权对象选择器                                  | canonical 对象、可读身份、关联状态             | 默认要求裸 rel、用输入文本猜对象             |
| 空/加载/失败      | 单行状态/必要 skeleton/可恢复错误               | ready/empty/error 及可见覆盖                   | 加载显示“没有”，把拒绝当成功空态             |
| 工作状态/风险     | 简明文字与 badge，风险需要准确原因              | 声明状态/风险及真实裁决结果                    | high=不可逆；颜色成为唯一状态信息            |

主动作的强调必须与当前意图及声明匹配，不能用“第一个 action”当推荐；未知 action 全部仍可到达，
缺推荐语义时用中性的操作入口，不凭动词猜轻重。摘要行不得变为“点击整行执行危险动作”。

### 复用与最小新增

- 优先扩展既有 member-link/card/table pattern 的表达能力；如缺无框摘要行，允许新增一个通用
  member-row 词汇或等价最小变体，先在两域 fixture 证明必要性。命名/shape 在 P0 定案。
- 继续使用 ActionGroup/ActionRunner/ActionSubmit，不复制 exec、Cedar 或 RJSF validation。
- 本地已有 button/card/collapsible/table/tooltip/skeleton 等 primitives；Dialog/Menu 缺 wrapper
  时优先用已安装 Base UI 做薄封装。需新增依赖必须先证明必要并更新技术决策，不能默认安装新库。
- “popover/side sheet/modal”是宿主形态，不进入业务 cognitive traits；需要双方同时操作时采用非模态，
  模态则实施焦点限制、Escape、可见关闭与焦点返回。不得出现只做滑出动画却没有交互契约的假弹层。

## 3. 首页数据与责任保全

- 复用 `workspace:my-work` 与当前 inbox/delegations/threads 授权根。先核对每个源实际覆盖；
  增加可继续线/历史切片时扩展纯读投影或声明选择器，HTTP 可发现并与 UI 同源，不客户端扫全库。
- 不将“不在某个集合里”解释为业务不存在。无权裁剪与空同形处遵守 D51/D78.3；网络错误单独表示。
- 当前工作线与后台委托是不同事实，允许并列、解释关联；没有显式关系不通过名字强行合并。
- 首页不会自动将最近浏览对象加入工作线，也不自动新建工作线；保留既有消息显式 attach 的边界。
- 责任可能无工作线归属，仍须可发现；属于已结束工作线的 pending 责任也不能因历史折叠而消失。
- 展示去重使用可证明的 canonical 引用，不能把“同标题”当同对象。
- “最近/有变化/过期”需要声明时点/事件依据；无时间元数据则采用稳定的声明顺序并诚实省略，
  不写 Date.now 猜进展、不虚构百分比/优先级/最后活动。
- 分页与阅读截断必须有更多入口和真实数量口径；不得只渲染前 N 个并宣称已展示全部责任。

### 不依赖 LLM 的可达性保障

责任集合与动作完整性由授权合同和校验机制保证，必须覆盖 generic、Recipe 与 Sidecar 命中。
改变 Surface 导致当前责任遗漏时，使用同一呈现链路的安全重规划/失效/受支持诊断，
仍保留真实收件箱等合同入口，不在 React 再造隐藏的责任数据库或第二 dashboard。
P0 要验证合适的责任引用保全/coverage 机制落点，不能仅要求“模型别漏掉”。
任何保全校验仅检查已知授权引用、动作可达和声明，不判断业务重要性、不产生自然语言计划。

## 4. 三个必做探针（实施 P0；本轮未运行）

### S1 — 语义姿态和责任保全

用同一个带动作对象分别请求 overview/review/compare，再用混合集合（普通管理对象、当前责任、
历史责任、无动作对象）验证逐成员姿态；覆盖未知语义/新应用/改名应用。
对 generic、有效 Recipe、个人 Sidecar 的展开/折叠/排序分别检查来源、动作可达、责任保全和授权失效。
对比“扩展既有 pattern”与“一个新 row 词”，选择最小可行方案，不创建新 layout node 体系。

输出 `spike-report.md` S1：最终语义字段/版本、选择优先级、相关 member trait 保留位置、
catalog/compiler/validator/Recipe 影响、责任保全机制、精确测试路径与拒绝的方案。
若需要承接 T56 的 member 字段，只在 T56 完成的接口上最小增补；不可按 action 名重新猜责任。

### S2 — 只填目标但仍可审计的创建

已知 threads#create 当前要求 id/goal/goalSource；已有 caller/client 字段分离和 commandId/baseVersion
注入机制，但它尚不是通用“创建来源记录”方案。不得假设隐藏字段就足够。

对比两条有界路线：

1. 复用既有 client-owned 输入注解＋真实原始输入记录，只扩展必要的来源/标识装配词汇；
2. 若无法证明来源，给 canonical 创建命令补最小服务端输入装配，仍走原 parser/guard/事件写入与投影。

要求两者均证明：目标原话可追溯到真实记录；幂等/重试/重复 id 无多建；拒绝不假成功；
model unavailable 时直接创建仍可用；CLI/agent 能发现并提交同一合同；不伪造 actor/human 或来源。
创建被接受时其来源记录必须已经存在且属于当前 principal；来源写入失败不能留下“成功但无来源”的线。
跨来源记录/创建动作不能原子化时，需声明可恢复的顺序与重试键，不能让调用方猜是否再次提交。
不存在合法来源方案时不得造 `message:<random>`、用 sessionId 替代、或将 goalSource 任意省略。

输出 S2：选定 schema/来源字段所有者/原记录与创建事件的顺序或事务关系/失败与重试语义/外部客户端
用法/replay 断言。需要事件/合同变更时必须先登记决定；不引入另一事件 writer 或新持久化真相。
“先跟助手说再由 LLM 创建”可作为协作入口，不能冒充不依赖 LLM 的直接创建验收。

### S3 — 首页聚合与助手同源

fixture 分别为有责任、有 open 线但无 delegation、仅历史、全空、部分源失败、未知应用。
核对 `/` 所见、实际 clientView/薄 receipt、模型披露与 HTTP 来源：问题“这里哪些在等我”应对准同一事实。
从首页输入→查看工作→返回→继续输入，检查 T56 session/草稿/焦点连续性与响应式宿主。

输出 S3：首页来源/排序/分页覆盖合同、是否需只读切片、当前观察与 prompt 映射、请求放大量、
失败/空状态区别；不为页面排序新建推荐服务或把全部首页事实复制到 chat 上下文。

### P0 决策出口

先在当时下一个 DECISIONS 编号登记：

- 对 D50/D78.2 有动作→卡片选择规则作精确替代，保留 D78 线程单主体、历史与布局语义。
- 若扩展 D54 cognitive，说明它是通用认知，不能混入视觉属性；姿态/宿主放呈现策略或词汇。
- S2 若改变创建合同，明确三门同门、事件/replay/来源保证；不暗改 ThreadSnapshot 真相模型。
- D78.4 既有 thread 确认门差异不在本范围修复，不在 UI 声称该保证已存在。

## 5. 模块落位与影响限制

| 改动                   | 允许的主要位置                                                                        | 必须保持                                 |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------- |
| 认知声明/纯选择        | packages/shared/src/definition/；packages/engine/src/contract/；presentation/surface/ | 无平台/业务名依赖、封闭语义与版本        |
| 首页来源               | apps/web/src/engine/presentation/compositions.ts 与相邻子目录；必要的纯投影           | my-work 同源、逐源授权、无客户端全库聚合 |
| 列表/卡片/空态         | apps/web/src/render/words/；catalog/registry/compiler                                 | binding-only、unknown 安全、结构版本失效 |
| 动作/输入宿主          | apps/web/src/components/actions/；action-runner.tsx；ui/                              | 单一 submit、RJSF、fresh read、目标精确  |
| 首页壳与入口           | apps/web/src/app/page.tsx；共用 Presentation host；T56 完成后的 chat API              | 不复制 session/store，不写首页业务清单   |
| 创建来源（仅 S2 必要） | work-thread contract/command；Web 现有 ingress 与输入 provenance 适配；CLI 合同消费   | 同事件 writer、来源可审计、无身份推断    |
| 机械门禁               | scripts/governance/check-d54.mjs 及测试；常驻跨域 fixtures                            | 精确扫描集、合法协议分支不误伤           |

变更规模纪律：先记录复用项和必须新增项；每个新增语义至少有两个不同域用例。
新增组件应是通用词汇或薄 primitives，不因每增加一个 application 再新增组件/分支。
只拆本次触及的贴限模块；目录现值与余量必须在开工与提交前重新实测。
无需改 worker/runner/Temporal/provider/部署；若某方案需要，则本次拒绝该方案并先回到边界设计。

## 6. 组件交互验证依据

采用已有平台组件时也必须满足对应模式，而不是仅复刻视觉外观：

- [WAI Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)：展开状态、键盘与被控制内容关联。
- [WAI Menu Button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)：打开的是命令菜单，焦点/键盘跟随菜单模式。
- [WAI Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)：背景不可交互、焦点留在弹窗、Escape及关闭后焦点返回。

这些链接是辅助规范；本 track 所需具体交互、测试尺寸和完成标准已在本目录明确，不依赖外部教程才能实施。
