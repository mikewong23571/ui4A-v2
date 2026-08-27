# T33 授权与注意力范畴分离 — Specification

## 类型

Refactor(破坏性剥离允许;GR2 无兼容双路径;零新真相源、零端点增减、零 schema 变更)

> **锚点约定:** 全部代码锚点使用"路径 + 符号",不写行号。实施前以仓库现状复核。

## 背景与动机(生产事故链,2026-08-26/27)

同一根因连续产生四起生产可见故障:

1. 多 granted 应用用户的 Agent 经 chat `present(publishing 实体)` 得
   `authorization-failed`(身份入口冻结 default);
2. `/api/presentation`、`/api/presentation/sidecar`、meta entity/exec、
   业务 sitemap 各自以不同字面量冻结 scope——同一个人在不同入口解析出
   不同的"当前应用";
3. 应急修复(fix-0a36f20)在授权侧下穿 granted 集合后,presentation
   durable key 仍用冻结值 → 持久化"键自称 default、内容属 publishing"
   的毒 sidecar;canvas GET 重审按 stored 冻结 scope 复审 publishing
   实体 → **404**;
4. 404 同时构成第二个设计违背:本人名下的派生工件被表达为"Not Found",
   违反不变量"拒绝是带可执行原因的事件"。

产品愿景(product-vision.md)对此早有诊断:§七"scope 作为授权边界做了,
作为认知边界没做";§一.3"scope 是默认镜头,不是围墙"。本 Track 是该
诊断的终态兑现。

## 根因(一句话)

`identity.policyScope` 单值字段同时被两个互斥消费者使用:
授权裁决(应吃凭证集合 × 数据归属,全自动)与认知镜头(应吃
显式声明 > presence,单点装配)。会话态冒充了权限。

## 核心目标(一句话与判定要点)

**把"权随凭证走、境随声明走"落成机制:授权收缩为数据自带的受众谓词 +
两个咽喉守卫(类型上无法再接触会话态),注意力收敛到 situation 单点装配;
随后删除全部单值 scope 机器(T22 补丁、selection、durable key 维度、
GR6 扫描器)。判定偏离要点:净行数应为负或近零;若发现自己在新增
抽象/机制/端点,即越界回退。**

## 终态不变量(D51 登记,重构方向的唯一准绳)

1. 任何授权函数的签名与实现中不存在"当前会话 scope"类输入;唯一输入为
   凭证的应用授予集合与事实的应用归属(snapshot/sitemap);
2. 授予集合内的一切路径零可见授权事件(读/present/导航全自动);集合外的
   一切拒绝都是结构化回执(denied + reasonCode),对本人可见且文案诚实;
3. HTTP 404 仅由"非本人资源"(跨 principal 存在性隐藏)产生;
4. attention(lens)值只流向披露切片与导航落点,类型上无法进入任何鉴权函数;
5. 新增一个 application:以上任何一处代码零修改,注册数据即可生效。

### 愿景锚定补充(product-vision 逐节核对结论)

- **披露收窄只在 prompt 层**(§八 CLI 纪律):HTTP 合同(sitemap/entity/
  present)恒按授予并集返回,内置 agent 的"少看"是效率选择且由 situation
  切片完成;外部 agent 能看全集是合同承诺。此约束列入 D51 证据项。
- **结构化原因优先于模板人话**(§六文案滑梯):机械层仅产 reasonCode 数据,
  回执条目使用有界的既定活动措辞(presentation-words 口径),对话内解释由
  助手基于回执原生生成,禁止以模板扩写冒充理解。
- **镜头外的世界仍然可达且有界**(§一.3):lens 决定"先给什么",实体投影的
  links 携带全部 granted 内方向;跨域到达必经显式导航工具并留痕。

## 归后续(本 track 明确不做、避免静默背离的清单)

- 「你在哪、在看什么」常显位置条(§五加法清单)——UI 呈现属后续交互
  track,T33 只交付其数据源(situation 单点 + presence 投影);
- 起点词级交集探测退役(§五减法,另一处启发式);
- 工作线(work thread)作为 lens 的第三优先源——待 T26 方向产品化后接入,
  当前优先序止步于 显式 > presence > 未定位。

## 改动领土

### In

- `packages/engine/src/presentation/sidecar.ts`:UserSidecarKey 剥离
  policyScope 维度(键回归 principal/intent/device/subject 四元组);
  授予变化走既有依赖失效重规划。
- `apps/web/src/auth/application-scope.ts`:单值谓词(relCoveredByPolicyScope/
  assertRelInPolicyScope/filterEntityForPolicyScope 的单值语义)改为受众
  集合语义(assertReachable / filterEntityForGrantedApplications / 归属判定);
  filterSitemapForPolicyScopes 并集口径保留。
- `apps/web/src/auth/request-identity.ts`:删除 defaultPolicyScope 与
  scopeCoverage 及其整套默认选择;identity 增加应用授予集合字段;
  ?scope= 显式参数降级为导航偏好(可选透传,不参与鉴权)。
- 删除 `selectCoveringPolicyScope`(engine/situation.ts)及全部调用方 adaptation。
- 咽喉点接线:`api/entity`、`api/exec`、`api/exec-plan`、`api/presentation`
  (+ meta entity/exec)、`api/presentation/sidecar`、chat 路由、presentation
  runtime(broker trusted context {grantedApplications};durableKey 去维度;
  dependencies 的 `policy:*` 改按授予集合指纹)。
- sidecar GET 语义拆分:unknown(跨 principal)→ 404;本人越界存量工件 →
  结构化 denied;创建期拦截使越界工件不再新增。
- situation 单点装配优先序:显式 > presence > 未定位(如实呈现);
  agent prompt 分层披露核对 T25 成果不回归(L0/L1/L2 切片,lens 只进披露)。
- 客户端:denied 回执文案(复用 chat presentation-words 纪律)、画布
  "暂时无法载入"分支区分 unknown/denied 并给出人话。
- 测试:三分纪律执行(见 plan Phase A gate);production-auth 套件 fixture
  去 policyScope 必填;`request-identity-scope-coverage.test.ts` 整体退役;
  render.test 源码治理断言改写为新管线特征(禁止 defaultPolicyScope/
  scopeCoverage 字样存在)。
- 治理:GR6 扫描器(scripts/governance/check-identity-scope.*)与
  exceptions.json identity-scope-selection section 删除(类型收口后由编译器
  执法);AGENTS.md Governance Gates 对应条目改写为 D51 不变量描述;
  DECISIONS.md 落 D51。
- 文档:GOAL.md/T32 冲突面协调注记(touched files 极少重叠,见 plan 冲突节)。

### Out(明确不做)

- Keycloak realm 授予模型与 token 结构不动(ui4a:policy:* 词汇保留,
  仅作为谓词输入属性);
- capability/delegation/runtime backend 全部不动;
- sidecar 表 policy_scope 列停止写入含义但保留列(DB 投影可重建,无迁移);
- agent prompt 分层披露的深化(属于后续方向项,不在本 track 新建机制)。

## 测试三分纪律(防被现有测试误导)

1. **回归锚**(不许红):三段裁决顺序、事件重放哈希、幂等/并发、human-only、
   Temporal workflow 确定性、Golden Story 既有套件。
2. **旧语义钉子**(先删后立):守护已退役机制的测试整体摘除,不以保绿为由
   迁移其断言;不得在钉子未清空前为救绿妥协产品代码。
3. **D51 不变量清单**:上述五条转化为可执行证据(E2E + 类型约束 + 定向
   测试),作为完成的定义;每次"这个测试要不要保"以是否守护清单为准。

## 验收(DONE 定义)

- 新 E2E 走查五景全绿:focus 直达(不带 sidecarId)、chat present 双应用实体、
  授予外用户得结构化 denied 且界面人话、他人 sidecar id 得 404、lens 变化仅
  影响披露与落点;
- 既有不变量套件 I1–I7 与重放哈希全绿;`pnpm check`(typecheck/lint/governance
  /vitest)全绿,governance 基线只减不增;
- 生产部署后真人复现原事故场景:一次说清即到位,全程零可见授权事件;
- DECISIONS.md D51 + AGENTS.md 条目 + 本 track index 收尾完整;
- GR 六判据自检:换新 application 零代码分叉。

## 风险与回滚

- 回滚单位为镜像 digest(values 回退 rev N+1→N,runbook §17 路径已演练);
- 事件日志只追加,零破坏;毒 sidecar 为投影孤儿,审计可追溯,无清理义务;
- T32 在途冲突面:assistant-ui/chat 组件重叠极小,T32 领土为交互质量修复,
  若撞文件以后落地者 rebase 语义为准(T33 的 denied 语义取代旧的静默)。
