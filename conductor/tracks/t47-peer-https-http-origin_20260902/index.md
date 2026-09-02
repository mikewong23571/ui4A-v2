# T47 双 HTTPS 入口与纯 HTTP Origin

- [规格](./spec.md)
- [计划](./plan.md)
- [元数据](./metadata.json)

将 `aliyun-sz` 公网入口和 `home` Tailnet 入口改为并列的 TLS 终止点；两者直接回源同一个
Home 纯 HTTP application gateway，消除 HTTPS 套娃并修复公网 Chat Origin 校验。
