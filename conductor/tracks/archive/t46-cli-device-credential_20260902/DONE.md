# T46 DONE — CLI Device Credential 与长期 Agent 访问

当前 deployment 已支持本地 `ui4a` CLI 的长期 Agent credential：

- Keycloak realm v2 提供 public Device Authorization client `ui4a-cli`。
- 用户一次浏览器 consent 后，CLI 以 24h access + 90d offline idle / 180d max 自动续期。
- offline refresh 只保存在 macOS Keychain generation/chunks 中；没有 plaintext token file。
- CLI identity 是 `sub + azp=ui4a-cli` Agent provenance，永不获得人工 approve。
- 本地 CLI 已安装并连接 `ui4a.styleofwong.cn`；doctor、应用/流程发现与实体读取通过。
- realm migration 有完整 database/realm backups、partial retry evidence 和 v2 post-check。
- 八服务 healthy，重启后 credential 继续工作，retained volumes 不变。

完整证据见 [evidence.md](./evidence.md)。
