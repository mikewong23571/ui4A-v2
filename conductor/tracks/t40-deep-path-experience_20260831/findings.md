# T40 走查登记(findings)

> 2026-08-31 双环境走查登记:本地 dev(当前代码,web:3100)+ mothership 部署实例
> (v0.1.0-experimental.1,已登录 ui4a-experiment-human)。每条附证据截图与当前代码复核状态。
> 判定纪律:P0=闭环断裂;P1=主路径体验缺陷;P2=表达/文案层;P3=观察项。

## F-01(P0)Chat 携带 workspace focus 起步即失败,裸错误码直出

- **现象**:从应用画布(如 editorial)带 focus 进入聊天,发送任意消息即失败;本地当前代码
  回执为 `失败 · code=start_entity_unavailable`,部署实例为 `实体"workspace:app:editorial"不存在`。
- **影响**:共同注视的核心场景(看着一个对象跟助手说话)在起点断裂;且机械错误码/内部 rel
  原样抛给用户,违反"失败是可行动的人话"。
- **证据**:`evidence/2026-08-31-walkthrough/chat-focus-start-fail.png`(本地当前代码)、
  `deployed-chat-focus-fail.png`(现场)。
- **复核状态**:当前代码仍成立(本地实测)。

## F-02(P1)实体页状态词裸露英文枚举,与列表页不一致

- **现象**:todo 实体页(`/canvas?focus=todo:ui`)状态显示 `open`;同实体在列表页显示"进行中"。
- **影响**:同一事实两种说法,读面信任受损;详情页反而比列表更机械。
- **证据**:`entity-page-raw-status.png`。
- **复核状态**:当前代码成立。
- **纪律提示**:修复路径是合同数据/通用文案框架(D47.1),禁止 React 状态翻译表(T35 §六文案滑梯)。

## F-03(P1)实体页读面单薄:无字段、无来源、无审计分层

- **现象**:todo 实体页首屏只有标题、`open`、两个动作按钮和 `collection todos` 标签;用户填写
  的"备注"字段不显示,无创建/更新时间,无来源,无事件/审计入口(原始合同需再点顶部 tab)。
- **影响**:深路径的终点页回答不了"这是什么、什么时候、从哪来、发生了什么"。
- **证据**:`entity-page-raw-status.png`。
- **复核状态**:当前代码成立。T28 的 field-role/raw 分层机制存在,但业务实体页未消费出字段层。

## F-04(P1)首页"在等我/在动"空态裸标题,无引导

- **现象**:空态下两区只有标题文字,无一句引导;「我的工作线」有说明文案和创建入口,三区不一致。
- **影响**:新用户第一眼看到的两个分区是死标题;T35 S1 的"空区块一句引导或留白"口径未覆盖到
  这两个新区块(T27 后增)。
- **证据**:`home-empty-sections.png`。
- **复核状态**:当前代码成立(本地与现场一致)。

## F-05(P2)Meta 控制台术语未译、中英混排

- **现象**:定义控制台出现 `Governed Drafts`、`Specialized Agents`、`definition-lifecycle(引擎自举)`
  等未译/混排术语;搜索占位与过滤 tab(全部/待审批/无效)已是中文。
- **影响**:治理面的专业度观感;同一页面两套语言体系。
- **证据**:`meta-untranslated-terms.png`。
- **复核状态**:当前代码成立。修复走 sitemap/定义数据,不写前端字典(页面滑梯)。

## F-06(P2)业务面机械标签泄漏:flow/collection rel 直出

- **现象**:todo/editorial 画布与实体页出现 `flow flow:todo-capture`、`collection todos`、
  `brief-draft` 等机械标识作为可见标签。
- **影响**:T24"机制 chrome 退出首屏"的既定方向在应用画布/实体页仍有残留。
- **证据**:`canvas-mechanical-labels.png`、`entity-page-raw-status.png`。
- **复核状态**:当前代码成立。

## F-07(P2,现场待核)未登录行为不一致

- **现象**(部署实例):未登录访问 `/` 302 跳 Keycloak;访问 `/meta` 渲染页面外壳+数据区报
  "读取定义合同失败"。同一认证态两种表现。
- **影响**:外壳渲染让"未登录"看起来像"服务坏了"。
- **复核状态**:本地 dev 为隐式 local-user 无法复现;需在 Phase E 现场复核后裁定归属
  (本 Track 或部署配置)。

## F-08(P3,观察)工作线"来源"显示原始标识符

- **现象**:工作线详情"来源"显示原始 UUID/引用串;顶栏注视 chip 截断为 `workspace:app:ed…`。
- **证据**:`deployed-thread-source-uuid.png`。
- **复核状态**:现场观察;来源是创建时用户输入的引用标识,是否值得人话化在 Phase D 裁定。

## 对照基准(非问题)

- `editorial-landing-current-ok.png`:editorial landing 在当前代码已具备 flow 区块与"开始写作"
  入口;现场实例的"editorial 画布只有描述卡"是部署版本落后(无 todo/ideas 同理),**不是**当前
  代码缺陷,不在本 Track 修复范围。
- `deployed-where-panel.png`:"在哪"面板(站点/视角/工作线/注视+调整视角)为正面基准,本 Track
  的文案与分层修复不得削弱它。
