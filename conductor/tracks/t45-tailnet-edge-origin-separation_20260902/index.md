# T45 Tailnet Edge 公网 Origin 分离

- [规格](./spec.md)
- [计划](./plan.md)
- [验收证据](./evidence.md)
- [元数据](./metadata.json)

让 `aliyun-sz` Caddy 以 `ui4a.styleofwong.cn`/`auth.ui4a.styleofwong.cn` 提供公网入口，
同时保持 `home` 的 Tailnet 内部 TLS host、CA、数据卷和 UI4A edge 不变。
