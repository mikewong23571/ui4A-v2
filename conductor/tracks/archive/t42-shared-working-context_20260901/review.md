# Review Report: T42 共同工作上下文

## Summary

按S1–S8审查；代码和故事门禁通过，已发现的授权泄漏、切线和集合标题问题均已修复。
开发环境的单条测试误写已按用户授权完成备份和精确修复，应用与合同读面恢复。

## Verification Checks

- [x] **Plan Compliance**: 用户故事先于实现；缺陷和修复均在T42范围。
- [x] **Style Compliance**: 新代码通过定向检查，无新增前端说明段落。
- [x] **New Tests**: 目录、工作上下文、授权、清空、切线、后台重读、真实LLM和浏览器。
- [x] **Test Coverage**: 核心变更模块行覆盖率96.64%。
- [x] **Test Results**: check3585通过/6既有跳过，E2E65通过/24既有可选跳过，实模2项通过。

## Findings

### [High] 嵌套工作线引用和派生状态泄漏（已修复）

- **File**: apps/web/src/auth/application-scope.ts 与 audience/entity-projection.ts。
- **Context**: 仅以child.href过滤无法覆盖真实嵌入投影；resume是文本，goalSourceText
  来自被引用对象；集合和其他owner的工作线亦须按相同边界处理。
- **Resolution**: 可信principal+原授予，递归只读裁剪；实际project()生成的Red→Green
  用例覆盖exact/list、grant收回、其他owner、执行回执；事件未改变。

### [Medium] 切线只改参数导致工作对象和上下文分离（已修复）

- **File**: apps/web/src/components/stage/situation-bar.tsx。
- **Resolution**: canonical工作线实体导航，保留安全returnTo；新增行为测试。

### [Medium] 已成功读取的Meta集合显示无法读取（已修复）

- **File**: apps/web/src/components/stage/situation-contract.ts。
- **Resolution**: exact成功但无名称时使用当前授权sitemap标题；403不降级成旧标题。

### [High] 测试队列串入开发Worker（已修复）

- **Context**: 编排首次运行全E2E时未隔离Temporal，测试通知误写开发日志seq524；
  重放完整性检查因此失败。已定位且未绕过校验。
- **Prevention**: 测试库与Temporal前置检查已加入并通过；临时缓存统一忽略。
- **Resolution**: 用户授权后备份并仅移除seq524，触发器在同一事务中恢复；CLI确认
  business/meta/Application目录/文章集合可读。备份SHA-256见evidence；未清库。
