# 待办定义修订候选（todo bundle 9）

这两个 Flow JSON 从已解析的本地 Application Bundle 导出；导出不等于线上激活。提交前应与当前线上 Flow 合同及版本比较，只有人类批准后才按现有定义生命周期生效。

- todo-capture：再记一条只清空捕捉实例的 title/note，已创建待办保持原值；待办标题至少一个字符。既有 done 是不可达终态，无法通过 terminal-reachable 校验。本候选明确增加 recorded#retire「停用此捕捉入口」，风险标注 high，通向「捕捉入口已停用」。这会停止当前单例捕捉入口，合同不提供恢复，也不自动重建入口；已有待办不受影响。它不是普通的“结束本次记录”，不可作为体验测试收尾动作自动执行。循环主路径仍是「再记一条」。
- todo-item：进行中与已完成均提供「编辑待办」，收集非空标题与可选备注；留空备注会清除备注，编辑不改变完成状态。完成/重新打开保持无参数；已完成节点原已存在归档，本候选把风险标注与进行中节点的 high 统一，Agent 归档仍须人工确认。
- 不修改事件日志、已有实例字段或 bornVersion。批准新的定义不会为出生在旧版本的待办自动增加编辑动作，也不会自动更新旧版捕捉单例；这类存量适用边界须在激活前如实评估，不以部署代码宣称已修复存量合同。

验证：完整捕捉→添加→再记一条→再次添加；进行中编辑→完成后编辑→重开→清空备注→完成→归档；经过 JSON 序列化的事件重放与在线实例一致；两种状态下 Agent 归档均挂起；出生版本旧合同不获得新编辑动作；两个 Flow 的 validateDefinition 与 applicationBundleIssues 均通过。

## 公网候选

- [todo-item: ac1569cfea8a9a2ad73d](https://ui4a.styleofwong.cn/meta/entity?rel=draft%3Aac1569cfea8a9a2ad73d&scope=todo)
- [todo-capture: f14d99d5d6da747847b9](https://ui4a.styleofwong.cn/meta/entity?rel=draft%3Af14d99d5d6da747847b9&scope=todo)

本轮均已通过机械校验并提交到 pending-approval。产品的人类批准尚未由本代理代行。todo-item 的既有定义生命周期已通过声明的“修订(开新草稿)”进入 draft，版本仍为 v1；待批准候选将形成后续版本。部署代码不会代替定义激活。
