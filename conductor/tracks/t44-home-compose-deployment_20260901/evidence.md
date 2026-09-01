# T44 验收证据

## Phase A

- 基线提交：`afec7e5f8533041fafde620ee794e3492d9436f7`
- `home`：Debian x86_64，Docker 29.7.2，Compose 5.4.0，Tailscale `100.64.0.2`。
- 冲突：Plane 已发布 `0.0.0.0:8443`；home gateway 绑定 loopback/Tailscale `80/443`。
- 清理：精确清理低风险缓存与 `sing-box-windows/src-tauri/target`，释放
  `58,003,226,624` bytes；磁盘从 77%/约 99 GiB 可用改善为 64%/约 153 GiB 可用。
- Disposable Web image：revision `afec7e5f8533041fafde620ee794e3492d9436f7`，大小
  `295,454,933` bytes；`next build` 与 TypeScript 成功。
- 临时运行：`/live`、`/api/health`、`/`、`/meta`、`/applications`、`/version` 返回 200；
  `/ready` 返回 503 且原因是 `migration_required`。
- Spike 资源已删除，端口 `13100` 释放；未修改现有容器、网络、数据卷或项目数据。
