# T51 新生应用可见性恢复链路 — Spec

> 状态:new(2026-09-04)。本 spec 由编排 agent 按 `workflow.md` 自治编排协议代行规划;
> 用户已在诊断会话中裁定方向:授权语义(D51/D66)不动,修复集中在「授权状态可见、
> 恢复动作可达、验收覆盖人通道」三点。

## 1. 背景与问题

2026-09-04 部署站(`ui4a.styleofwong.cn`)实测:经治理 Draft genesis 装入 todo/ideas
后,CLI(agent 门)立即可见可操作,但批准者本人的 web 会话看不到新应用。代码链路
定位(证据见诊断结论):

- web「应用」目录读 `/.well-known/ui4a.json`,按 token 推导的 `grantedApplications`
  过滤(`apps/web/src/app/.well-known/ui4a.json/route.ts`);批准者浏览器令牌早于
  settings 变更签发,不含 `ui4a:policy:governance`,D66.4 展开不生效。
- 会话续期(refresh)不带 scope 参数,旧 grant 的 scope 集合永不升级;只有重新走
  `/auth/login`(以当前 `auth.oidc.scopes` 发起新授权请求)才能拿到治理词。
- 服务端配置与数据均已就绪(CLI 通过 `delegation_scope_exceeded` 强校验证明运行时
  settings 含 governance;同进程 snapshot 含 todo/ideas)。

结构性缺口(人通道体验断裂):

1. **批准者看不到自己行动的结果**:激活成功回执对批准者的会话可见性零提示——而服务端
   在批准时刻同时握有「批准者授予集合」与「新装应用全集」两个事实。
2. **静默失效不可发现**:「未安装」与「已安装但未授予你」呈现完全相同(无声缺席);
   视角栏还把过滤后子集标注为「全部已授权应用」。
3. **恢复动作在产品外**:正确恢复(退出→重登)是 OIDC folklore,产品内无任何入口;
   web 没有 CLI `auth status` 的等价物,用户坐在信息最少的通道上。
4. **运维验收半边**:settings/scope 类变更只验收了 CLI 通道,浏览器通道无合同步骤。

## 2. 目标(Goal)

**G1 批准即知晓**:application-bundle 批准通过的瞬间,批准者本人在 exec 响应与 UI
上看到结构化披露:新装应用对其当前会话是否可见;不可见时给出唯一正确恢复动作
(刷新授权/需 IdP 授予),可见时给出新应用入口指引。

**G2 我的授权面板**:web 提供当前会话授权事实的只读投影(原始 token scope、有效
授予集合、授权模式、治理展开来源标注),与 CLI `auth status` 同事实源。路由面
(页面 + API)必须进入部署 edge 路由白名单(`deploy/compose/edge-routing.caddy`,
设计复审 F1):`/session` 入页面 GET 名单,`/api/auth/session` 入 authenticated-read
组(未认证结构化 401,与 `/.well-known/ui4a.json` 同语义)——否则部署站 404,
重演「测试绿、人通道坏」。

**G3 刷新授权一键可达**:面板与披露提供「刷新授权」动作,复用既有 `/auth/login`
新授权请求路径(SSO 会话有效时无感往返);不新造任何认证机制。

**G4 界面措辞诚实**:授权过滤后的视图不再宣称「全部」;应用目录空态提供「查看我的
授权」出口。

**G5 运维验收合同**:scope/授权类部署变更增加浏览器通道验收步骤与匿名可执行的
登录 scope 参数检查(DEPLOYMENT.local.md §7)。

## 3. 设计决定(实现前先落 DECISIONS.md)

### D70 授权可见性披露与 auth 平面控件合同

- **D70.1 激活披露口径**:meta exec 的 approve 成功响应可携带 `disclosure` 字段,
  内容=「新装应用 × 批准者有效授予集合 × 运行时浏览器登录 scope 表」的纯函数推导,
  三分支 `immediately-visible | visible-after-relogin | requires-idp-grant`;
  `visible-after-relogin` 判定=治理词**或**该应用的 `ui4a:policy:<app>` 任一在登录
  scope 表内(设计复审 F2-3 泛化;当前 settings 校验器限定六固定词,实践等价)。
  披露是给批准者本人的表现层数据,**不落事件日志、不进入跨 principal 可见面**
  (不泄露存在性);发现文档过滤语义零变化(D51 不动)。已知近似(F3):全集 diff
  在极窄并发窗口内可能并入他人并发装入的应用(可见性结论仍正确,归因偏宽);
  relogin 分支隐含 realm optional-scope 挂载不漂移,漂移时由 US2 面板如实暴露。
- **D70.2 auth 平面控件**:「我的授权」面板与「刷新授权」动作属于认证平面控件,
  与顶栏既有「账户与密码」「退出登录」(T22/T47)同门——**不是** Siren action 背书
  的业务控件,不违反 I3(action-backed 仅约束业务功能控件);面板为只读投影,
  不是第二权威。
- **D70.3 授权事实投影端点**:`GET /api/auth/session` 返回当前会话 resolved
  identity 的授权投影(scopes/grantedApplications/authorizationMode/浏览器登录
  scope 表),复用 `resolveTrustedRequestIdentity`,零新授权输入;不返回已安装应用
  全集(那是授予集合乘以治理展开才可得的事实,非授予主体不得见)。
- **D70.4 刷新授权语义**:「刷新授权」= 导航至 `/auth/login?returnTo=…`(既有
  beginLogin,以当前 settings scope 表发起新授权请求;SSO 会话有效时 Keycloak
  无感回跳)。不引入 prompt=none 静默 iframe(第三方 cookie 限制下不可靠)、
  不改 refresh 流程、不做服务端会话重签。

## 4. 非目标(Out of Scope)

- 不改 D51 授权输入合同、D66.4 治理展开规则、发现文档过滤语义。
- 不做会话内授权自动升级/静默续期(prompt=none 类);会话 TTL 与 refresh 语义不变。
- 不做产品内逐 app 授予治理(D66.4 已明确推迟为多租户决定;`requires-idp-grant`
  分支只指引两条已裁定路径)。
- 不改 CLI/Chat 通道的任何授权行为(US5 为防回归锚,CLI 零改动)。
- 不改 Keycloak realm/operator(部署侧仅验收合同文档更新)。

## 5. 验收(用户故事)

- **US1 批准即知晓**(F1/F5):approve 成功响应含结构化 disclosure(新装应用、
  授予集合、三分支结论、恢复动作引用);三分支各有多组纯函数单测;治理会话批准后
  应用目录无需重登即出现;disclosure 仅批准者可见;合同测试锚定响应字段。
- **US2 我的授权面板**(F2):`/api/auth/session` 返回授权投影;顶栏系统区入口;
  治理展开来源标注;只读;production-profile 路由测试覆盖 200/401;**edge 路由
  白名单覆盖**(`/session` 页面 GET 名单、`/api/auth/session` authenticated-read
  组,F1)并在部署验收合同中生效。
- **US3 刷新授权**(F3):面板与 relogin 分支披露提供动作,走 `/auth/login`;SSO
  有效时无感往返;浏览器 E2E 锚定恢复路径。
- **US4 界面不宣称全集**(F4):「全部已授权应用」措辞修正;应用目录空态/搜索无果
  提供「查看我的授权」出口;发现文档过滤回归测试保持绿。
- **US5 人机同门一致**:同一 token 事实下 CLI `auth status` 与 web 面板集合语义
  对齐(防回归锚,CLI 零改动)。测试载体(设计复审 F3):共享 fixture 的形状
  断言——同一 token 事实 fixture 分别喂 CLI 展示推导与 `/api/auth/session`
  投影,断言 granted 集合语义一致,不做跨 app 运行时对照。
- **US6 运维验收合同**(F6):DEPLOYMENT.local.md §7 增浏览器通道步骤 + 匿名
  `/auth/login` scope 参数检查;变更记录表增「浏览器通道复核」栏。
- **US7 授予路径可发现**:`requires-idp-grant` 分支文案指向两条已裁定路径
  (settings 治理词 / realm 逐 app),带部署文档锚点;快照测试防漂移。

## 6. 全景验收走查(终验,双通道一条主线)

CLI 起草 application-bundle Draft → 浏览器批准 → 看到真实 disclosure(按部署配置
落分支)→ 点「刷新授权」无感往返 → 应用目录出现新应用 → 进入 entry flow 完成一次
真实写 → 授权面板与目录一致 → CLI `auth status` 对照一致 → 全程事件可回放、披露
未进跨 principal 面 → 按 US6 新合同跑 §7 验收。
