# T48 Application Genesis 产品内闭环与 Meta 人机同门 — Spec

> 状态:new(2026-09-04)。本 spec 由编排 agent 按 `workflow.md` 自治编排协议代行规划;
> 关键产品方向已由用户在规划会话中明确裁定:(a) application 的定义级出生必须在产品内
> 自闭环,不得永久依赖部署旁路;(b) 人类与 agent 必须同门——meta 站点暴露给 agent 的
> 定义级操作,人类必须在 UI 上同样可见可执行。

## 1. 背景与问题

2026-09-03 部署站(`ui4a.styleofwong.cn`)实测两次失败暴露了同一组结构性缺口:

1. **合同层无载体**:`executeDraftCreate` 的 kind 枚举仅 `flow-definition | agent-definition`;
   flow-definition 还要求 target 已存在且其声明 `app` 等于请求 lens。`meta/applications`
   投影 `actions=[]`。产品内 Draft 环只是"修订环",连"已有 app 内新建 flow"都不可提案。
2. **授权层鸡生蛋**:D51 口径下授权输入 = `grantedApplications × audience`,D65 要求 meta
   写动作显式声明授予集合内的 lens。尚不存在的 application 不在任何凭证的授予集合里,
   因此**连被提案的资格都没有**——不止是不能被创建。
3. **出生事件单一 ingress**:application 出生事件(`application-seeded` 等)只由
   `planMetaBootstrap` 在启动时从 repo bundle 工件生成。事件日志中不存在
   "人类/agent 创建 application"的事务路径。
4. **人机不同门**:`meta/drafts` 集合在 Siren 合同上挂着 `create` 动作,但
   `GenericCollectionRenderer` 不渲染集合级 actions——人类在 `/meta` 看不到任何定义级
   创建入口(T39 北极星的刻意取舍,本 track 修订该决定)。

而机制的一半已经存在且被低估:`meta/exec` 路由的 `authorizedPolicyScopes =
Object.keys(snapshot.applications)`——scope 全集就是 fold 派生,**事件日志里出现一个
application,scope 全集立刻生长**。本地 profile 的授予集合也已经按"已安装全集"现算。
缺的是把 genesis 接进 Draft 环、并给 credential 模式补上同样的推导规则。

## 2. 目标(Goal)

**G1 Application Genesis 受治理闭环**:全新 application 的定义级出生走产品内
Draft 合同:提案(人或 agent)→ 同源校验 → 机械 diff → human approval → 激活事务
原子追加 bootstrap 同种 seed 事件 → scope 全集自动生长。批准后,持有治理角色的凭证
**无需任何部署/IdP 旁路步骤**即可到达新 app。

**G2 Meta 人机同门**:集合级 `create` 动作在人类 UI 渲染并经同一 `/_meta/api/exec`
裁决;人类可以创建 Draft(application-bundle / flow-definition / agent-definition)、
修订、校验、读 diff、提交;agent 经 HTTP/CLI/Chat 走的是同一份 Siren 合同与同一
裁决路径。**同一动作面,两种执行者,一份事件日志**(product.md 验收总纲)。

**G3 CLI Agent 闭环**(用户 2026-09-04 追加裁定):可安装 `ui4a` CLI 作为参考
agent 客户端在新能力上**全环闭合**:发现(`apps`/`flows`/`entity`)→ 起草
(`drafts create --kind application-bundle`,显式 lens)→ 修正/校验/diff/submit →
`watch` 等待人类决定 → 批准后 CLI **立即**发现新 app 与新动作(S2 精神)。approve
永不出现在 CLI 面(`APPROVAL_FORBIDDEN` 口径回归);CLI 不内嵌 LLM、不做授权判定的
边界不变。

## 3. 设计决定(实现前先落 DECISIONS.md)

### D66 Application Genesis:application-bundle Draft 与授权推导补充

- **D66.1 载体**:Draft kind 增加 `application-bundle`。payload 即 Application Bundle
  JSON;校验复用 `parseApplicationBundle` 与现有 invariants(零新校验器)。target =
  bundle 的 application name,必须**不与已安装 application 冲突**(fail-closed 拒绝并
  留痕,I6)。
- **D66.2 提案锚定**:提案动作锚定在提案者已授权的显式 lens 下(实践上为
  `governance`);新 app 名只是 payload 内容。lens 永远指向已存在且已授予的 scope,
  D51"授权输入=授予集合×归属"的合同不破——这是 agent-definition v1
  (新名字、version=1、已授权 scope 内起草)已有先例的推广。
- **D66.3 激活语义**:人类 approve 的激活事务原子追加与 bootstrap **同种**事件
  (`application-seeded`/`capability-seeded`×n/`definition-seeded`×n 与同 kind
  receipt),事件规划复用纯函数 `planMetaBootstrap`。重启 bootstrap 对同名 bundle
  因 receipt 已存在而自然 no-op;`assertMetaBootstrapIntegrity` 与 I5 重放原样成立。
  Agent approve 永久拒绝(I4)。
- **D66.4 授权推导补充(D51 增补,非推翻)**:credential 分支中,凭证授予集合含
  `governance` scope 时,`grantedApplications` 展开为「当前已安装 application 全集」
  (与 local profile 已有推导同构)。IdP 只断言稳定身份事实;逐 app
  `ui4a:policy:<app>` 保留给细粒度业务委托。**该展开是显式的权限放大**:治理者
  可达全部业务面——语义上治理者本就需要验证新生 app,放大在 DECISIONS 明示并
  接受;多租户细化留待未来独立决定,不在本 track。

### D67 Meta 人机同门与文档边界修订

- **D67.1 集合动作渲染**:`GenericCollectionRenderer` 渲染集合实体的 `actions`
  (经既有 `MetaActions`,提交前 fresh-read,scope-preserving)。控件只来自当前
  Siren 合同,不新增任何 hardcoded 按钮(I3)。
- **D67.2 人类编辑器**:`application-bundle` 的人类编辑 schema 复用
  `AGENT_DEFINITION_EDITOR_SCHEMA`/`draft-editor-schema` 模式:结构化必填根 +
  issue 聚焦 blocking-fields;JSON 级编辑,**零 AI 生成**(铁律 5)。
- **D67.3 flow-definition genesis**:kind=flow-definition 且 target 不存在时允许
  提案(名称合法、payload 的 `app` 等于声明 lens);激活追加 `definition-seeded`
  v1 语义事件,sitemap 生长。
- **D67.4 文档修订**:GOAL「App 创建边界」改写为"产品内受治理 genesis 经 Draft
  合同存在;create-app 对话向导/页面设计器/rule-based 生成器仍排除";T39 北极星
  "人类主路径聚焦责任决定"修订为"包含创建/修订入口,但零 AI、合同驱动";
  `conductor/index.md` 禁止复活清单中 "in-product App creation" 条目同步移除。

## 4. 用户故事与验收(两门同跑:人类浏览器 × agent HTTP/CLI)

| # | 故事 | 断言 |
|---|---|---|
| US1 | 人类在 `/meta` Drafts 页看到「Create Draft」 | 集合页渲染合同 actions;kind 含 application-bundle;提交经 `/_meta/api/exec` 且提交前重读 |
| US2 | 人类提交 application-bundle 提案 | 非法 bundle 留痕为 Draft 校验问题;修正后 ready → submit → 机械 diff 上 human approve → 激活 |
| US3 | 新 app 出生 | `meta/applications` 出现新成员;`snapshot.applications`/sitemap 自动生长;重启后 bootstrap 不重复;I5 重放 hash 一致 |
| US4 | 授权闭环 | 持 `governance` 凭证激活后立即可达新 app(credential 合同测试);无治理角色凭证获结构化 denied 留痕 |
| US5 | agent 同门 | CLI `drafts create --kind application-bundle`(显式 lens)成功;批准后 agent 无需任何 prompt/部署变更即可发现新 app 与新动作(S2 精神) |
| US6 | Chat 同门 | Assistant 在 chat 中提议创建 application,经同一 meta exec 合同进入 Draft(协议层注入驱动;真实 LLM 故事可选) |
| US7 | flow genesis | 已授权 lens 内为已有 app 提案新 flow(target 不存在)→ 激活 → sitemap 出现新 flow 入口 |
| US8 | 负例 | agent approve 拒绝(I4);名称冲突拒绝;越权 lens 拒绝;stale 拒绝;全部留痕(I6) |
| US9 | CLI 全环(agent 门) | 从干净配置出发仅用 CLI 完成 G3 全链;每步 envelope 留痕;approve 尝试 `APPROVAL_FORBIDDEN` |
| US10 | 端到端 agent 双通道验收 | 编排 agent 操作**真实浏览器**(人类门)与**真实 CLI 二进制**(agent 门)各跑一遍完整 Golden Story;每一步(通道/动作/命令或 URL/合同证据/断言/结果/截图)记录于 track evidence 文件;随后按 §6.8 第一性原理清单逐步审查操作路径 |

### 验收留痕纪律(US10)

- 证据落盘 `conductor/tracks/t48-application-genesis-meta-parity_20260904/evidence/`:
  `evidence-agent-acceptance-<date>.md`(步骤表)+ 截图/命令抄本目录;
- 浏览器验收沿用 T37/T38 "agent 浏览器视觉审核" 先例(agent 操作浏览器,人类会话
  即人类门);CLI 验收用真实构建产物对真实 server 执行;
- Playwright golden spec 是该 agent 验收路径的**可重放回归镜像**(agent 走查是
  一次性证据,Playwright 是长期回归,双轨缺一不可);
- 部署站复核:按 `DEPLOYMENT.local.md` 标准升级流程发布后,在公网站点重跑双通道
  走查并追加证据(不阻塞本地 DONE,由用户裁定是否当次发布)。

## 5. 非目标(Out of Scope)

- Application 删除/归档/停用生命周期(decommission);
- 既有 application 的 bundle 级版本升级(既有 flow 修订已由 flow-definition Draft 覆盖);
- Cedar policy 可视化编辑器(payload JSON 级即可);
- 产品内 grant 管理 UI(授予仍是 IdP 侧部署事实;D66.4 只改推导);
- 多租户提案/批准策略细化(沿用 Draft owner + human-only approve 现状);
- workstation landing 视觉改版(新 app 消费既有 T39 语义 trait 机制);
- create-app 对话向导、页面设计器、关键词编排生成器(GOAL 边界维持排除)。

## 6. 验收标准(Acceptance)

1. US1–US8 全过,每条故事由两种执行者各跑一遍(浏览器 renderer + HTTP/CLI 合同);
2. Golden Story:人类浏览器完成 application-bundle 提案→修正→diff→approve→出生→
   同门发现全链路;Playwright 固化为 `e2e/` 回归;
3. 不变量扩展全绿:I3(集合动作 fuzz 背书)、I4(agent approve 拒绝)、I5(含新生 app
   的空库重放 hash 一致)、I6(冲突/越权/stale 拒绝留痕);
4. `pnpm check`(含 governance:strict)与 `CI=true pnpm e2e` 全绿;
5. DECISIONS.md D66/D67 与 GOAL/conductor/index.md 修订先行落盘(仓库纪律:先记录
   再动代码);
6. 里程碑结束系统可运行:`pnpm dev:all` 起服后浏览器实测 US1–US3;
7. 端到端验收由 agent 双通道代行(US10):真实浏览器 + 真实 CLI,全过程逐步留痕于
   evidence 文件;Playwright golden spec 作为可重放回归镜像;
8. **第一性原理路径审查通过**:对记录的每一步核对——(a) 交互均映射已声明合同
   动作,无带外写入;(b) 裁决序 declaration→guard→schema 在拒绝证据中可见;
   (c) agent 零 approve;(d) 拒绝均为带理由事件/回执;(e) 事实全部来自合同读取,
   无发明;(f) 人机同门(同一 rel/action/href);(g) 出生仅经事件日志,无第二权威;
   (h) 授权仅由授予集合×归属推导,lens 显式。发现项登记并闭环,结论写入 evidence。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| D66.4 权限放大被滥用 | 展开仅由 `governance` scope 触发;边界测试覆盖非治理凭证;DECISIONS 明示 |
| GR3 行数红线(views.ts 483/500、execute.ts 434/500、drafts.test.ts 714/800) | 变更时沿功能边界拆解(activate/create 模块分文件;新测试独立文件);D53 纪律,不为行数裁功能 |
| 激活事务多事件原子性 | 事务边界在 `acceptDraftWithCoreEvent` 回调内返回计划;packages/db 先行 TDD |
| bootstrap 与激活事件重复 | receipt 同 kind 同 rel 幂等去重;重启回归测试 |
| agent 走查不可重放 | 双轨:一次性走查留证据文件,Playwright golden spec 作长期回归镜像 |
| 工作区遗留 D65 未提交改动 | Phase 0 前先核对/提交 D65(CLI --scope 修复),保持历史干净 |
