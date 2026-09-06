# T56 P2.3 G3 截图证据(P2.3 自动化门禁,2026-09-06)

- 被测 HEAD:`35552afd`(master;树为 dirty —— 含本任务 6 个 e2e spec 修复,
  见 `git status`;截图反映修复后的壳行为)。
- 环境:隔离场景 server(端口 3110,`UI4A_DIST_DIR=.next-e2e`,`pnpm dev`),
  隔离库 `localhost:5433/ui4a_test`(事件日志已 TRUNCATE + bootstrap),
  Temporal `localhost:7235`;LLM 三项 env 显式清空(chat 回合确定性诚实失败)。
- Fixture:与 `e2e/workstation/work-thread-workspace.spec.ts` createThreadFixture
  同形的 A 线最小集(经 `/api/exec` 规范 create/attach):
  `thread:t56-shot`(goal「完成一项跨应用评审并记录决定」,context=articles,
  active=article-drafting:main,approval=confirmation:t56-shot〔dangling〕);
  决定前/后另用 `post:post-welcome` 的 agent archive 提议(confirmation:c1)
  与 `thread:t56-shot-t33`(goal「T56 截图工作线」),流程与
  `workstation-home.spec.ts` waiting-for-me 用例相同(零导航两段式批准)。
- 截图方式:Playwright chromium 真实浏览器截图,零修图;五视口矩阵为视口内
  截图(布局几何证据),其余为 fullPage。左下角圆形「N」是 Next.js dev tools
  dev 模式浮标,非产品 UI。
- Review 纪律:每张均已被 reviewer 实际查看(acceptance §3),与 G3 各用例
  断言口径一致。

| 文件 | viewport | route | fixture / 状态 | sha256(前 12 位) |
| --- | --- | --- | --- | --- |
| 01-thread-overview-1440x900-assistant-off.png | 1440x900 | /canvas?thread=t56-shot&focus=thread:t56-shot | A 线;本线概览=主内容(唯一 H1 目标、成员卡、声明动作、相关材料收起、无永久材料栏) | 1d11e55487f9 |
| 02-vp-1440x900-assistant-off.png | 1440x900 | 同上 | 五视口矩阵 1/5(助手关) | 79c8cef77bff |
| 02-vp-1280x800-assistant-off.png | 1280x800 | 同上 | 五视口矩阵 2/5(助手关) | af0de3e37450 |
| 02-vp-1080x820-assistant-off.png | 1080x820 | 同上 | 五视口矩阵 3/5(助手关) | 1ce8b13b9ae5 |
| 02-vp-768x1024-assistant-off.png | 768x1024 | 同上 | 五视口矩阵 4/5(助手关) | af00352de488 |
| 02-vp-390x844-assistant-off.png | 390x844 | 同上 | 五视口矩阵 5/5(助手关) | db16516dd984 |
| 03-vp-1440x900-assistant-on.png | 1440x900 | 同上 | 五视口矩阵 1/5(助手开,剩余宽度足够 → 并排停靠) | 2e936aa856bb |
| 03-vp-1280x800-assistant-on.png | 1280x800 | 同上 | 五视口矩阵 2/5(助手开) | 2837c145ace1 |
| 03-vp-1080x820-assistant-on.png | 1080x820 | 同上 | 五视口矩阵 3/5(助手开,并排主区 ≥640) | d13c61f165b1 |
| 03-vp-768x1024-assistant-on.png | 768x1024 | 同上 | 五视口矩阵 4/5(助手开) | 0631b1f1559f |
| 03-vp-390x844-assistant-on.png | 390x844 | 同上 | 五视口矩阵 5/5(助手开,覆盖悬浮不出屏) | 6a549535b33a |
| 04-materials-overlay.png | 1440x900 | 同上 | A 线;「相关材料」展开覆盖层(工作集 3 条;dangling 成员诚实标「对象不存在」) | 1b0ab5870333 |
| 05-error-recovery-ghost.png | 1440x900 | /canvas?focus=flow:ghost&scope=publishing&thread=t56-shot | 不可解析 focus:中性空态「内容不存在或不可见」+ 返回首页;线身份保留(bridges 用例同状态) | 2c193eab1a00 |
| 06-error-recovery-ghost-page-tools.png | 1440x900 | 同上 | 同页打开「页面工具」:重新载入/为什么这样展示/查看原始合同 二步可达 | 16c5a6831ff9 |
| 07-history-sessions-ab.png | 1440x900 | /(悬浮助手 → 历史会话) | 会话 t56-shot-a「线 A:查看第一篇的状态」与 t56-shot-b「线 B:发布一篇文章」各 1 回合,清单分行不串台(chat.spec T49 为 API 级断言,本图为同一事实的 UI 投影) | 413a876ad412 |
| 08-decision-before.png | 1440x1200 | /(我的事) | agent archive 提议挂起 → 「在等我」决策卡:archive〔需high确认〕 · 由 agent 提议 · pending·confirmation:c1,批准/驳回 两组 | cc37a8c69d51 |
| 09-decision-after.png | 1440x1200 | /(我的事) | 人工批准后(confirmation-approved actor=human):在等我清零,两条工作线成员卡仍在 | 99b5c0f5e91a |

## NOT RUN(对应用例本轮不存在,如实标注,不造图)

- **归档回顾(US04,completed/archived 线有/无验收来源)**:G3 命令覆盖的
  spec 均无归档线浏览器用例(US04 归属 P3/P4 阶段);未截图。
- **材料与 pin 区分(US06)中的 pin-only 部分**:pin-only「固定视图」舞台
  语义属 P3.1(canvas-body.thread-workspace #10 当前为已知 Red);材料覆盖层
  本身已由 04 号图留证。
- **US12 真实 LLM 走查**:属 G4 门禁,本轮明确不跑(见任务非目标)。

---

# T56 P4.1 G3 截图证据(常驻用户故事覆盖 US01–US11,2026-09-06)

- 被测 HEAD:`bf58603d`(master;树为 dirty —— 含本任务 e2e/workstation/** 新增
  常驻 spec 与本目录截图,见 `git status`;截图反映最终代码树行为)。
- 环境:与 P2.3 相同(隔离场景 server 3110、隔离库 `localhost:5433/ui4a_test`、
  Temporal `localhost:7235`;chat 用例 LLM 三项 env 显式清空 → 回合确定性诚实失败)。
- Fixture:Fixture A 完整集(`e2e/workstation/work-thread-fixtures.ts`
  createFullThreadFixture):open + 目标 + 跨两 application 的 context(articles
  +comment:c1)+ active(article-drafting:main)+ 已决定(驳回 confirmation:c1)与
  待决(confirmation:c2)各一条 approval + 显式 event(event:1);确认挂起经真实
  Cedar 门(agent archive 提议 202)。US11 另经受治理 genesis(HTTP meta/drafts
  create→submit→approve)装入未在 UI 硬编码的第二 application(t56ext*,entry flow
  + 30 长标题 seed 实例)。
- 截图方式:常驻 spec 内 `saveShot`(环境变量 `UI4A_E2E_SHOTS_DIR` 指向本目录时
  落盘;常驻代码零 track 路径依赖),Playwright chromium fullPage,零修图。
  左下角「Compiling…」/圆形「N」为 Next.js dev 浮标,非产品 UI。
- Review 纪律:关键截图(us02 决定前、us09 三型引用、us08 会话清单、us11 大工作集)
  已由实施 agent 实际查看;编排 agent review 请亲看。

| 文件 | viewport | route | fixture / 状态 | sha256(前 12 位) |
| --- | --- | --- | --- | --- |
| p4-us01-thread-overview-full.png | 1440x900 | /canvas?thread=t56-*&focus=thread:t56-* | A 线完整集;唯一 H1 目标、进行中、责任卡(带批准/驳回动作)与材料卡(articles/comment:c1/article-drafting:main,无动作)同屏区分 | e3f0420c9fc7 |
| p4-us02-decision-before.png | 1440x900 | 同上 | 与 us01 同一页面状态(独立场景截图);US02 决定前:已决卡(c1)回执「已由 human 驳回+原因」、待决卡(c2)对象/动作/依据(Cedar 未许可)/改变前后「未提供」 | 14af008a9218 |
| p4-us02-decision-after.png | 1440x900 | 同上 | 两步批准后:待决卡回执「已由 human 批准」、动作面退场 | 6f2144bd646b |
| p4-us03-overview-updated.png | 1440x900 | 同上 | active 执行 next 后经「返回本线」导航回线:成员卡状态 basic-info→classification、「停在「classification」」 | c42bee5b5ef5 |
| p4-us04-archived-line.png | 1440x900 | 同上 | archived 线:无添加/移出控件、待决责任卡动作仍在、材料卡无验收语义、固定视图可取消 | 819649674edd |
| p4-us06-materials-pin.png | 1440x900 | 同上 | 材料覆盖层:工作集(1)+comment:c1 pin-only 单列固定视图区「不属于本线材料」(detach 失败不清 pin 的 DOM 断言同用例) | 6784d627e22e |
| p4-us07-clientview-history.png | 1440x900 | 同上 | 刷新后历史回合当时上下文:第 1 问注视 articles、第 2 问注视 article-drafting:main(join 自 user 事件) | 90d7aa705e1d |
| p4-us08-history-ab-context.png | 1440x900 | 同上(B 线) | 历史会话面板:同一 session 一行「2 回合 · 失败 · 当前」;顶部 turn-context-notice 在场;底部输入范围条=B 线(截图为会话清单步,展开内容由用例断言) | eb8000533259 |
| p4-us09-citations-kinds.png | 1440x900 | 同上 | 三型引用 chip 同屏:精确型「第一篇(当前名称)·正文」、集合型「集合级依据·文章(当前名称)」+时点边界行、不可读「thread:t56-* 当前不可读」 | f39d5b78e370 |
| p4-us10-empty-line.png | 1440x900 | /canvas?thread=t56-*&focus=thread:t56-* | 空线(Fixture C):无成员卡、来源不可解析省略、无全称否定文案 | 449e71550e00 |
| p4-us10-cross-principal-hidden.png | 1440x900 | 同上(非 owner context) | 跨 principal:存在性隐藏空态、零名称/计数泄漏、材料计数不伪称 0 | a768c790803e |
| p4-us11-ext-app-bigset.png | 1440x900 | 同上 | 受治理出生的第二 application + 30 长标题材料:工作集(30)、覆盖层 30 条、generic 管线零特判呈现 | 6c5d82c4628a |

## 与 P2.3 的差异

- P2.3 的 NOT RUN 项在本轮落地:归档回顾(US04,见 p4-us04)、材料与 pin 区分
  (US06 pin-only,见 p4-us06)。US12 真实 LLM 走查仍属 G4/P4.2,本轮未跑。
- 「已决定 approval」如何构造:agent 提议 → 人类 reject(带原因)——原动作不执行,
  文章保持 published,同场景可再次提议得到 pending 确认(c1 已决 + c2 待决)。
- 提议型 fixture 会启动 notify-<id> workflow(尽力而为派发);提议类用例场景
  前后经 cleanupNotifyWorkflows 终止 c1/c2(与 workstation-home 同卫生口径),
  防止残留 workflow 被后续 worker 栈用例(worker spawn 后)误投递到其场景 server
  ——G3 首两轮 workstation-home「propose 500」即该污染,修复后连续三轮全绿。
