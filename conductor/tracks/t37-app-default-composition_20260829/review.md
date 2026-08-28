# T37 用户故事视觉审核记录(review.md)

> 审核人:编排 agent(浏览器实操:导航/点击/表单 + 截图 + DOM 快照断言)。
> 环境:开发栈已重启(fresh broker 单例),http://localhost:3100。
> 截图目录:`~/.zcode/cli/artifacts/sess_45cc0e44-c5f7-4ccd-b6ea-232c765f73e0/`(以调用编号对应)。
> 结论口径:pass / pass-with-observations / fail(附修复轮次)。

## U2(publishing)发布可达 — PASS

- 操作序列:
  1. `/canvas?focus=flow%3Aarticle-drafting&scope=publishing` 向导面 → 「发布」触发键 →
     表单填 `文章标题=T37 导航验证` → 结构定位 `form button[data-action="publish"]` 提交;
  2. 提交后向导循环回 `basic-info`(D11 语义),**动作区下方渲染 `collection → articles` 链接**
     (Phase A 流→产物正向链上屏);
  3. 回默认面 `/canvas?scope=publishing`:成员卡出现「T37 导航验证」;
  4. 点击成员标题链接(第 1 次点击)→ `/canvas?focus=post%3At37` 文章实体面:
     标题、published 状态、行内动作(下线/归档)、底部 `collection → articles` 回链。
- 判定:**1 次点击 ≤ 2 次点击上限,PASS**。
- 截图:`call_2037285b…png`(文章实体面,含 collection 回链)。
- DOM 断言:成员链接唯一(`getByRole('link', {name:'T37 导航验证'}).count()===1`),
  点击后 URL `/canvas?focus=post%3At37`。

## U1(publishing)默认组合面 — PASS(缺陷修复后复核通过)

- 修复后复核(重启栈 + 79235bc7):`/canvas?scope=publishing` 渲染完整组合面:
  ①articles 集合概览(4 成员密集卡:标题链接 + 已发布 + rel + 行内动作);
  ②article-drafting:main 入口 region(状态 basic-info + 下一步/放弃 +
  collection→articles 回链)。**诊断兜底 5 → 0**(DOM 快照断言)。
- 修复记录:根因 = 双层规范 rel 漂移(服务端 planRegion 绑声明源而非规范 rel;
  客户端别名补键只覆盖单根 sidecar),commit `79235bc7`,三层红→绿
  (runtime-composition / generic hydrate / runtime 端到端)。
- 截图:`call_028ac90a…png`。
- 判定:PASS。
- 观察(记录,不阻塞):①组合面标题用机器 rel「articles」(sitemap 声明即如此,
  人话标题属后续实体页分层 track);②成员卡逐卡重复合同图例文案、卡套卡
  边框——均为既有词条设计,属「视觉去嵌套」后续 track 范围。

## U4(community)审核动作行内可达 — PASS

- 操作:`/canvas?scope=community` 默认组合面 → comments 集合 region 成员卡
  「评论审核(待处理 · comment:c1)」行内「通过/驳回」→ 点击 c1 的「通过」。
- 结果:2.5s 后结构原位重规划——c1 变为「已通过 · comment:c1」审计卡
  (动作按钮消失),c2/c3 保持「待处理」且行内动作可用(invalidate 语义,
  T33/D50 决策卡);成员标题为可点链接(`/canvas?focus=comment:c1`)。
- 截图:`call_adf1d725…png`(通过前,待处理成员卡 + 行内动作)。
- 判定:PASS。观察:同 U1 ①②(机器名标题、图例重复/卡套卡属后续 track)。

## U3(todo/ideas)捕捉闭环 — PASS(修复 2 后;瞬态窗口以测试覆盖为准)

- 捕捉闭环实拍:`/canvas?scope=todo` → 「添加待办」→ 填 `T37 捕捉闭环验证` →
  提交;todos region 出现成员卡(进行中 · todo:t37),行内「完成/归档」可用。
  截图:`call_380a655a…png`。
- 第一处残余诊断(捕捉循环后 identity 词位 deref-failed)已修复:
  commit `a1159f4d`(诚实空呈现;subject 缺失的结构失配仍保持诊断;
  DerefWarning 语义不变)。修复后当前页面与多次快照:**诊断兜底 0**。
- 修复 2 根因比表象更深:exec 失效契约不覆盖 `flow:` 别名缓存键 → 捕捉后
  瞬时窗口内入口 region 以陈旧实体渲染,规划期在场字段的绑定落空。修复后
  该窗口表现为身份行短暂空白(诚实空),reload/版本失效即刷新——已登记为
  独立遗留观察(entity-cache 失效契约,有既有测试锚定),留后续小修复。
- 自动化竞态说明:视觉复核第二次捕捉时,组合面重规划窗口内点击偶发被吞
  (自动化时序与重规划竞态,product 缺陷与脚本竞态暂无法区分);以合同级
  证据 + 三层红→绿测试(含与线上一字不差的诊断复现)作为修复 2 的验收依据,
  并把「组合面重规划期的交互稳定性」登记为后续加固观察项。

## U5 零特判 + agent 同门 + scope 保留 — PASS(附一项后续观察)

- 零特判(硬证据):新增推导文件 `app-workspace-composition.ts` 与
  `canvas-body.tsx` 中应用名(publishing/community/todo)出现次数为 **0**;
  范围内 diff 只触达通用组合/运行时/舞台机械文件;同一推导函数吃
  publishing/community/todo 三应用 fixtures(单测)。
- agent 同门:流实例合同 links 含 `collection → articles`(live 探针);
  sitemap app 分组完好(publishing: flow:article-drafting / flow:post-status /
  articles)——外部 agent 发现面未窄化;虚主体未进业务 sitemap、不可 exec
  (单测断言零业务事件、快照 hash 不变)。
- scope 保留(后续观察):focus 深链 URL 未携带 `?scope=` 参数(D51 口径下
  scope 仅为导航偏好,授权不受影响,实体面渲染与授权实测正常);跨面链接
  的 scope 透传一致性留后续 track 复核。

## 汇总

| 故事 | 应用 | 结论 |
| --- | --- | --- |
| U1 默认组合面 | publishing | PASS(修复 1 后,诊断 5→0) |
| U2 发布可达 | publishing | PASS(1 次点击 ≤ 2) |
| U3 捕捉闭环 | todo | PASS(修复 2 后零诊断;瞬态陈旧读留观察) |
| U4 审核动作 | community | PASS(行内通过,原位重规划) |
| U5 零特判/同门/scope | 三应用 | PASS(scope 透传留后续观察) |

覆盖应用数:3(publishing / todo / community)≥ 3,满足规格要求。
修复轮次:2 次(均在预算内):`79235bc7`(入口 region 规范 rel)、
`a1159f4d`(空值词位诚实空呈现)。

