# T9 前端体验重构 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。
> 2026-08-22 修订:Phase 划分按实际施工口径重排(用户中途补需求:聊天历史/过程可见性/sidebar+独立窗口/画布协同)。

## Phase A: 设计基座 + 统一页面壳 ✅

- [x] 依赖与 shadcn 配置(clsx/tailwind-merge/cva/lucide-react/tw-animate-css/radix;components.json + cn())
- [x] globals.css 语义令牌(shadcn 全套 + 深色媒体查询翻转;删 Tremor @source)
- [x] 十件基础组件落 src/components/ui/(CLI 生成,new-york/CSS 变量版)
- [x] AppShell 顶栏 + 唯一 main 栅格;SiteNav 上移;layout lang/metadata;各页 main→div;home.test 随壳断言
- [x] DECISIONS D16 + track 登记;Phase Verification(typecheck/eslint/vitest/dev curl)

## Phase B: 聊天工作台(assistant 核心组件)✅

- [x] runAgent `onStep` 回调 + /api/chat inline 改 SSE(轨迹逐步投影;render/delegated 路径不动)
- [x] chat-turn 事件留痕 + `GET /api/chat/history` —— 聊天历史 = 日志投影(服务端无会话态)
- [x] 可停止(onCancel + AbortController)与超时(LLM 60s / 客户端 120s)
- [x] 三态 shell:FAB → sidebar 分栏(AppShell aside 槽)→ /chat 独立窗口;assistant-ui stock thread + markdown
- [x] DECISIONS D17;测试:SSE 帧序/历史/停止/三态(838 全绿)

## Phase C: 骨架五面 + BIOS shadcn 化 ✅

- [x] 首页(五区卡片化;精确文本模板与 stat/timeline 容器 testid 不动)
- [x] 实体页/向导/收件箱(属性表/动作卡/成员列表;RJSF 仅模板层包装,控件锚点零接触)
- [x] 事件流/舰队(Badge 状态)/画布 surface 卡/BIOS 三面;delegations 状态色断言改 data-variant(B 类)

## Phase D: 词条平替与依赖退出 ✅

- [x] stat(Tremor→shadcn Card)/ timeline(react-chrono→自绘垂直时间线,零可点)/ table/kanban/detail/chart 语义令牌化
- [x] 删 @tremor/react、react-chrono;i3/invariants chrono 白名单收窄删除
- [x] 词条合同零变更(data-word/bind schema/目录 JSON;catalog 实测不变)

## Phase E: 集成验收与用户故事走查

- [x] 清尾:worker tsconfig `@/*` 映射;events 页 react-chrono 残留文案;entity-page-body/meta 硬编码色
- [x] 全量 e2e(单 worker 复用 3100)43 过 1 跳;llm-smoke 按口径跳过
- [x] 追加修复:聊天三形态(悬浮窗默认/分栏/独立窗口,同一 ChatPanel,形态记忆);i3 回归(data-action 重复挂点去重);canvas 卡死(A2UI 词条改 binderless 一次性解析,D18);小按钮图标化(lucide + aria-label 锚点);render 回执 Link 客户端导航(聊天不中断,画布协同)
- [x] 用户故事走查截图(明/暗两色;US-1~US-8)
- [x] 追加:聊天会话清单(`GET /api/chat/sessions` 日志投影 + 面板「历史会话」视图,可进入任一历史会话重放)
