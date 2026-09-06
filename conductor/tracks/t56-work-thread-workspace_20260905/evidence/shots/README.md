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
