# T29 在场与处境 — Plan

> 遵循 `conductor/workflow.md` 的 Story TDD、任务提交、Git notes 和 Phase Checkpoint 协议。
> TDD 顺序:每 Task 先 Red(投影/装配/端点测试),再 Green。每 Phase 结束复跑
> `pnpm check` 与 `CI=true pnpm e2e invariants`。spec:`./spec.md`。

## Phase A: presence 事件与投影(纯事实层)

- [x] Task: presence 事件 schema 与有界校验 b7b24aa
  - `packages/shared`:presence 事件类型(site/scope/thread/focus 四类变化点,
    字段白名单、尺寸上限);事件种类与频率上限入合同断言
  - Red:非法 kind/超界载荷/非变化点(与当前在场相同)一律拒绝的测试
- [ ] Task: 独立 fold 与 presence 投影
  - `apps/web/src/db/presence.ts`(与 db/presentation.ts 同族,不进业务 snapshot):
    principal → 最近 site/scope/thread/focus 的投影视图,可重建
  - 重放测试:重建后视图与增量 fold 一致;空日志 → 空在场(合法态)
- [ ] Task: 上报端点 `POST /api/presence`
  - 认证(ui4a:write,生产接 credential 同 delegations 口径);服务端以已认证
    principal 为归属(不接受自报 principal);同态去重(非变化点不落库,返回
    200 幂等);presence 不经 judge/无 guard 无 effect
  - edge 合同同步:auth-surface.md + helm istio/render.ts + Caddy 白名单 +
    两个 t22 合同测试(exact path 放行)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase B: 客户端变化点上报

- [ ] Task: 前端 presence 上报器
  - 站点/route 变化、canvas focus 变化、显式 scope 声明(现状的 scope 选择动作)
    → 变化点检测 → 上报(去抖;重复状态不上报)
  - 上报失败静默降级(不影响浏览;presence 是辅助信号,不是必需输入)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: 处境装配与首个消费方

- [ ] Task: 处境装配模块 `apps/web/src/engine/situation.ts`
  - 输入:已认证身份 + granted scopes + presence 投影 + 显式参数;
    输出:{site, scope, focus, disclosure 切片}
  - 规则:显式参数优先 > presence 辅助 > 部署默认;无 presence(CLI/headless)
    照常装配;零启发式,全部输入为结构化事实
  - 单测:优先级矩阵、CLI 形态、缺省回退
- [ ] Task: 首个消费方接线(证明单一来源,不扩张)
  - chat 路由平面判断从 `metaPlaneFromClientRoute` 切换为装配输出
    (`apps/web/src/chat/start.ts` 的对应函数退役,测试迁入装配层)
  - 实体路由的 scope 缺省解析(scopeCoverage 回退)改从装配取 scope
  - 其余消费方(T25 prompt、T27 scope 条)不在本 Track
- [ ] Task: clientView 协议一次性切换(GR2)
  - `packages/shared/chat-view.ts`:形状引用在场事实(thread/presence 锚);
    无新旧双路径;消费方(chat 路由、chat-panel)同步切换
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: 验收

- [ ] Task: 消费方矩阵断言与 CLI 形态验证
  - 测试切面:chat 平面判断与 entity scope 缺省来自同一装配输出(改一处
    presence → 两处行为同变)
  - 无 presence 的 Bearer/CLI 形态:装配正常、行为与现状等价
- [ ] Task: 全量验收
  - `pnpm check` 全绿;`CI=true pnpm e2e invariants` 全绿
  - presence 事件 → 投影 → 重放 hash 一致(并入重放测试套件)

## 验收标准(Track DoD)

1. presence 四类变化点可上报、可投影、可重放(hash 一致),非变化点幂等不落库;
2. 处境装配为 site/scope/focus 唯一实现;chat 平面与 entity scope 缺省同源
   (测试切面证明);
3. 显式参数优先于 presence;无 presence 的 CLI/headless 形态装配正常;
4. clientView 一次性切换完成,无双路径;edge 合同(auth-surface + 两个 t22
   合同测试)同步放行 `/api/presence`;
5. `pnpm check` + `CI=true pnpm e2e invariants` 全绿;生产部署后 Playwright
   验证登录/导航/聊天回归。
