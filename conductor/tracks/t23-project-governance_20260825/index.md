# Track: T23 项目治理:规则基线、依赖方向、兼容性清理与大小门禁

项目未发布,以此为窗口期建立可机械执行的治理规则,并一次性清偿兼容性代码、
依赖方向漂移与超大文件三类存量债务。治理检查采用类 TDD 方式:先写会失败的
检查(Red,记录基线),再修复存量(Green),最后并入 `pnpm check` 成为长期门禁。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [Implementation Plan](./plan.md)

当前状态:`in_progress`。本 Track 不改变任何业务行为、HTTP/Siren 合同或事件日志
语义;所有存量修复必须保持 `pnpm check` 与 `CI=true pnpm e2e invariants` 全绿。
