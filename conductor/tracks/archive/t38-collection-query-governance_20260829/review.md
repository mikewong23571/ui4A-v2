# T38 用户故事视觉审核记录(review.md)

> 审核人:编排 agent(浏览器实操 + 截图 + DOM 快照断言)。环境:dev 库重置后
> bundle v7 fresh bootstrap;web standalone + temporal + worker 分别运行。
> 结论:US1–US6 全 PASS;修复轮次 3 次(Phase B 预算 2 次 + 1 次编排 agent
> 直修收尾,均先红后绿)。

## 前置:合同门批量造数(agent 同门)— PASS

- `POST /api/exec` 与浏览器同门(human/local-user/renderer),4 步向导序列
  (v7:basic-info→classification→content→ready)批量创建 25 篇;
  终态 articles count = 27,exec 零失败。

## US4 合同门(curl 探针)— PASS

- `offset=0` → 20 行 + 仅 next;`offset=20` → 7 行 + 仅 prev(诚实缺链);
- `filter.status=pending` → 3 行全 pending;组合(过滤+分页)链接携带参数;
- 值域外/未声明维度/负 offset → HTTP 400 结构化拒绝(人话理由含声明值域);
- 无参数全量逐字节锚定(route 级测试 + inline 字节锚);hint 经成员投影
  `presentation.fields[i].overview` 携带,agent 同源可读。

## US1(publishing)长集合分页 — PASS

- 初始默认组合面:恰好 20 行表格 + 分页脚(仅 next);诊断 0。
- 点「下一页」:URL 就地变为 `?scope=publishing&offset=20`(组合面保留,
  表格不翻面);第二页 7 行;prev 出现、next 诚实消失。
- 刷新保持:直访组合面 URL(offset=20)渲染第二页表格(第 19 篇起)。
- 修复史:缺陷 1 初始取数不带分页参数(双声明合取门控,`bebfd6ad`);
  缺陷 2 翻页跳离组合面(宿主注入就地合并导航,`b4542fb6`);缺陷 3 组合面
  URL 参数不达集合区域(`applyUrlToPageable`,`6d6a7e12`)。

## US2(community)声明维度过滤 — PASS

- 过滤控件由声明渲染(维度「状态」= flow 定义 title;选项 待处理/已通过/
  已驳回 = 流节点拓扑推导)。
- 选「待处理」:URL 携 `filter.status=pending`,表格仅 3 条待处理行,
  行内「通过/驳回」可用;零诊断。截图:`call_e476b50f…png`。

## US3(publishing)概览显示 hint — PASS

- 文章集合行按声明概览列渲染:标题/正文摘要/分类(声明序);identity 与
  状态不重复进概览列(role 语义过滤);无 hint 应用回退现状。
- 修复史:概览列重复 identity + 挤掉状态列(`bebfd6ad`)。

## US5 全应用横扫(7 应用逐一)— PASS

| 应用 | 表格 | 卡片 | 分页脚 | 过滤控件 | 诊断 |
| --- | --- | --- | --- | --- | --- |
| publishing | 20 | 1 | ✓ | —(未声明) | 0 |
| community | 4 | 0 | — | ✓ | 0 |
| development | 1 | 1 | — | — | 0 |
| editorial | 1 | 1 | — | — | 0 |
| governance | 0 | 10 | — | — | 0 |
| todo | 0 | 1 | — | — | 0 |
| ideas | 0 | 1 | — | — | 0 |

- 零件只在声明处出现;governance 成员无声明动作 → 导航链接(诚实);
  todo/ideas 空集合诚实空态;首页 my-work 卡片风格无回归(修复
  `779a35c6` 后零诊断,在等我/工作线正常)。
- 横扫中发现并修复:my-work 因 inbox 被旧门控误发 offset=0 而整面失载
  (`779a35c6`:sitemap `pageable` 标志与合同判定同源,`collection` 维持
  视图语义;成员表键集进 sitemap 缓存键)。

## US6 零特判 + 授权不变 — PASS

- git diff 无 per-app/per-entity 分支;应用名零出现在新增推导/渲染文件;
- D51 专项断言(Phase A):过滤/分页前后逐行授权投影一致,参数不进鉴权
  签名;分页页 count = 本页行数(不加 total,避免跨 principal 存在性泄漏);
- 过滤/翻页零 exec、零业务事件(URL query 导航机械);事件重放哈希测试绿。

## 回归防线执行记录

1. 合同锚点:无参数全量字节级锚(升级前捕获)在全部 5 个功能 commit 中持续绿;
2. 授权回归:D51 专项断言(见 US6);
3. 重放不变:事件重放哈希测试绿(全量 check 内);
4. 既有面零回归:member-table/member-card/组合/runtime 既有测试全绿;
5. 全量门禁:最终 `CI=true UI4A_WORKER_HEALTH_PORT=3199 pnpm check` exit 0
   (414 文件 / 3243+ 测试);governance OK(基线空);format 通过;
6. 视觉横扫:US5 全应用截图 + DOM 断言(本文件)。

## 遗留观察(后续 track 候选)

- focus 直访集合面(focus=articles)成员呈决策卡,组合面呈表格——两条
  呈现路径密度语义尚未统一(服务端单主体 planner 无密度缺省);
- 组合面重规划窗口内点击偶发被吞(T37 已登记,本 track 复现两次);
- 过滤/翻页控件文案中「上一页/下一页/全部」为通用机制文案(规格允许),
  如需多语言走声明 title 通道。
