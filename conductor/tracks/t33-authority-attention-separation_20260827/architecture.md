# T33 技术架构 — 授权与注意力的范畴分离

> 决策依据:`DECISIONS.md` D51;方向裁判:`../product-vision.md`(下称"愿景",
> 引用形如 §〇/§一.3)。本文是该 Track 的实现级架构合同;实施偏差须先修本
> 文再动代码。

---

## 一、范畴模型:两条正交泳道

```
                    ┌────────────────────────────────────────────┐
   凭证(token)      │  identity.grantedApplications: [app…]      │──────────┐
                    └────────────────────────────────────────────┘          │
                                                                            ▼
   事件日志(fold)    ┌────────────────────────────────────────────┐   ┌──────────────┐
   ───────────────►  │  fact.audience = { app?: owner? }          │──►│ 咽喉守卫      │──► 允许/结构化拒绝
   (应用即数据)      │  归属是数据的属性,证据在日志里              │   │ assertReach- │    (全自动,
                    └────────────────────────────────────────────┘   │ able()      │     零可见事件
                                                                     └──────────────┘     或诚实原因)
                    ┌────────────────────────────────────────────┐
   显式声明(UI/URL) │  explicit scope / focus                    │───┐
                    └────────────────────────────────────────────┘   │     ┌──────────────┐
                    ┌────────────────────────────────────────────┐   ├────►│ situation    │──► ① 人类常显位置
   presence 事件    │  focus-changed / navigation(只记变化点)    │──►│ 单点 │ (唯一装配点) │   ② agent 披露切片
   ───────────────► │  人机同源、可重放                            │   │装配点│  纯函数      │   ③ 导航落点 startRel
                    └────────────────────────────────────────────┘   └────┘└──────────────┘
```

**正交性是硬约束**:泳道① 的输出类型上无法进入任何鉴权签名(编译器执法);
泳道② 只消费处境事实,永远产生不了"拒绝"。两条泳道在任何调用栈里不得交汇。

## 二、授权执行模型

### 2.1 事实的受众属性(fold 时打标,一次性成立)

- 业务事实从事件派生时标注 `audience.app = owningApp(snapshot, def)`:
  flow→definition.app、instance→flow 的 app、surface→面声明的 app;
- 私有物(thread 类)另有 `owner`,投影时按 principal 过滤(既有逻辑不变);
- 未归属任何应用的 rel **不在此谓词管辖内**(fail-open),交由既有三段裁决
  (declaration→guard→schema)兜底——这是刻意的最小化:受众谓词只封"安装制
  应用边界",不重造 guard。

### 2.2 两个咽喉点(全系统仅有的判权位置)

| 咽喉点 | 覆盖 | 判定 |
| --- | --- | --- |
| 读(present 复用同一路径) | `/api/entity`、meta entity、presentation authorize、sidecar 重审 | `audience.app ∈ grantedApplications && (owner==null ‖ owner==principal)` |
| 动 | `/api/exec`、exec-plan、meta exec | 同上,随后三段裁决照旧(agent+high-risk 挂起确认,human-only 不变) |

边缘能力位(read/write/approve)属认证中间件,原样保留,不在本模型讨论域。

### 2.3 失败语义表(取代一切伪装)

| 情形 | HTTP/回执表现 | 用户所见 |
| --- | --- | --- |
| 授予内读取/present/navigate | 正常 200/receipt ready | **零可见授权事件** |
| 应用未授予(本人请求) | 结构化 denied(reasonCode=audience-unreachable) | 有界活动措辞 + 对话内助手解释 |
| 对象不存在(rel 无实体) | denied(subject-unavailable) | 人话:"没有这个内容" |
| guard 阻止(状态不满足) | 既有语义不变 | 既有文案 |
| 高风险 agent 动作 | pending confirmation(human-only) | 收件箱待批,不变 |
| 访问**他人** sidecar id | **404**(存在性隐藏) | 与今天一致,唯一保留的 404 |
| 本人的历史越界存量工件 | 结构式 denied(创建期拦截后不再新增) | 人话,不再"莫名其妙地不存在" |

### 2.4 Sidecar 生命周期

- 键:`hash(principal, subject, intent, device)` 四元组——无 scope 维度;
- 创建期拦截:未授予 subject 根本不会生成 sidecar/receipt;
- 命中重审(原则不变):每次 GET 复核 sources 可达性;授予集合变化 →
  依赖指纹失效 → 自动重规划,不产生第二份键;
- 展示工件按授予并集口径渲染动作可见性(声称该动作的应用 ∈ granted)。

## 三、注意力执行模型

### 3.1 数据底座(全部既有,T29 已立)

presence/focus 是事件日志中的变化点记录,可重放、可审计。T33 不新增事件种类,
只增加一个消费者纪律:**镜头值只能从 situation 单点流出**。

### 3.2 装配优先序(CLI 纪律:presence 辅助,显式正典)

```
lens = explicit(UI 声明 / URL ?scope=)   —— 最高;必须可被 presence 覆写吗?否,显式恒胜
     ?? presence.lastFocus(principal)     —— 系统记得你停在哪
     ?? 'unlocated'                       —— 如实呈现"未定位";绝不偷选第一个应用冒充处境
```

装配是**纯函数**:`assemble(snapshotVersion, events-slice, explicit?)`,
可重放、确定性(I 审计友好);失败态"未定位"是一等公民。

### 3.3 消费者(仅此三个)

1. 人类常显的位置语境(canvas/workstation 现有 clientView 消费路径);
2. agent prompt 的披露切片(L0/L1/L2,见 §四);
3. 导航落点(startRel / focus 默认值)。

## 四、Agent 上下文协议(scoped context 在新架构中的落地)

### 4.1 三层切片(每步决策重建,非累积)

| 层 | 内容 | 有界性 |
| --- | --- | --- |
| L0 常驻薄底 | 工作线目标 + 对话窗口 + 最近事件摘要 | 对话窗口上限既有 |
| L1 镜头内地图 | 当前 lens 应用的 surfaces/flows 摘要;其他 granted 应用各一行方向 | 随应用数线性,单行封顶 |
| L2 近景 | 当前 focus 实体的字段、guard 后可见 actions、可达 links | 单实体 |

### 4.2 回合内演化规则(上下文不会乱的四个机械保证)

1. **替换而非堆叠**:每步切片由"(当前 situation, 本轮 trail 引用, 对话窗口)"
   全量重建;LLM 工作记忆中任意时刻至多一组 L1/L2——走过多少页面,prompt
   尺寸不变量成立;
2. **移动必留痕**:任何 lens 变化都是一次显式 navigate/exec 工具动作,
   同步追加 presence/navigation 事件(审计通道存全轨迹,对话流零机械噪音,
   §一.1);
3. **宽合同窄披露**:HTTP 合同按授予并集全量返回(外部 CLI 承诺,§八);
   内置 agent 的收窄发生在 prompt 装配层——所以"看不到"永远只是没给看,
   不是不能看,更不是没权看;
4. **权利不入镜**:切片内容里没有任何"是否允许"判断;denied 永远来自
   泳道①的咽喉点,两者物理隔离(§一)。

### 4.3 多轮恢复

新回合开头,lastNavigation + presence 已指向上次落点;"继续"类指令解析到
同一处境对象——人与 AI 抬头看见的是同一行(§二 共同注视协议)。

## 五、Navigate 推演(agent 视角逐步走查)

背景设定:用户 granted=[default, publishing, governance];镜头初始在
publishing 的文章列表(用户刚看完《用户故事》全文)。

| 步 | 动作 | 泳道②(lens/披露) | 泳道①(权利) | LLM prompt 实际增量 |
| --- | --- | --- | --- | --- |
| 0 | 新回合"这几篇文章什么分类?" | lens=publishing(post:item 近景) | — | L1=publishing 地图,L2=post:item 字段 |
| 1 | tool: entity('articles') | 不变 | 读:✓ 零事件 | L2 替换为 articles 集合近景(count+5 条摘要行) |
| 2 | tool: navigate('community','thread:cve-x') | **留痕**,lens→community | link 在投影中(granted 内,未剪裁);读:✓ | L1 换成 community 地图;prompt 总量不变 |
| 3 | "看下还没装的应用里的文章"(假设 grants 无它) | 链接根本不在投影(受众过滤) | present→denied(audience-unreachable) | 助手据回执解释"这属于未启用的应用";对话流出现的是人话,不是 reasonCode 原文轰炸 |
| 4 | tool: exec unpublish(post:t22…) publishing 域 | — | 谓词 ✓ → guard is-published ✗ → 结构化失败("离线状态不可下线") | 非"权限"问题,guard 层诚实话术 |
| 5 | 用户点高影响操作 | — | pending confirmation(人审批) | 不变 |
| 6 | 新回合 | lens=上一步落点(presence) | — | 与人抬头同行(共同注视) |

**结论回应推演目标**:agent 的上下文始终 scoped——每步只有一组镜头切片、
尺寸恒定、来源单一、变动全部留痕;"乱七八糟"在机械上不可能发生,因为
(a) 堆叠被"全量重建"取代,(b) 跨域进入只剩显式导航一条门,(c) 权利判定
彻底离开了上下文通路,不存在"以权限调整喂坏上下文"或反之的反馈回路。

## 六、迁移与兼容

- **删除清单**(GR2 一次切净):defaultPolicyScope/scopeCoverage 及默认回退、
  selectCoveringPolicyScope、relCoveredByPolicyScope/assertRelInPolicyScope/
  filterEntityForPolicyScope 单值版、UserSidecarKey.policyScope、
  GR6 扫描器与 exceptions 登记 section;
- **保留改名不改义**:filterSitemapForPolicyScope(单应用切片,并集复用)、
  edge capability 位、thread-owner、命中重审;
- **数据**:sidecar 表 policy_scope 列停用不删(投影可重建,零迁移脚本);
  存量越界工件为审计孤儿,GET 得结构化 denied,无需清理作业;
- **回滚单位**:镜像 digest(helm rev N+1→N,runbook §17);事件侧零风险。

## 七、治理映射(不变量 → 执法机制)

| D51 不变量 | 执法机制 |
| --- | --- |
| 1 授权无会话态输入 | 类型删除(policyScope 从身份/键/谓词签名消失),tsc 执法 |
| 2 内静默外诚实 | E2E 五景 b/c + denied 文案测试(有界措辞断言) |
| 3 404 仅他人资源 | E2E 五景 d + sidecar 路由定向负测 |
| 4 lens 不入鉴权 | Situation/grantedApplications 类型分轨 + grep 门(governance 常驻项评估并入 Phase D) |
| 5 新应用零改码 | 注册演练证据测试(fixture 假应用) |
| (补充)宽合同窄披露 | CLI 纪律证据测试(HTTP 并集 vs prompt 切片对照) |
| (补充)结构化优先于人话模板 | presentation-words 有界措辞测试(§六文案滑梯防线) |

## 八、与愿景逐节映射

| 愿景节 | 本架构对应 |
| --- | --- |
| §〇 注意力判据 | 拒绝由系统自证,不再要用户开 DevTools 找真相(事故链根除) |
| §一.1 AI as assistant | 机械轨迹全部留痕于审计通道;对话内解释由助手生成 |
| §一.2 Native context aware | lens 只来自显式/presence 事实,启发式归零(unlocated 为一等态) |
| §一.3 Scoped context 最重要 | 分层切片 + 镜头非围墙 + 到达必留痕(§四/五) |
| §二 同一扇门 | 人机同读 situation 单点;HTTP 合同人机同宽 |
| §三 CLI 三纪律 | 显式正典 / 成员资格不由 presence 私推 / 窄化只在 prompt 层 |
| §六 换应用零改码 | 不变量#5 + 注册演练测试 |
| §七 自诊断 | 本 track 即"认知边界补齐"的实施 |
| §八.1/.2 | presence 事件复用;situation 唯一装配点(第 5 处旁路清零) |

## 九、开放问题(不影响动工)

- lens 第三优先源接工作线(T26 产品化后);
- 常显位置条 UI(后续交互 track,T33 仅供数);
- 委托任务的 token 收窄(授予子集交换)——集合语义下成本已降为一行配置,
  待真实需求。
