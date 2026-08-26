# Track: T25 Assistant 上下文收窄(limited scope):分层披露,起点用事实

让 agent 的上下文从"整个宇宙"收窄为"当前 scope 的处境"。sitemap 分层披露,
起点解析删除词级猜测,prompt 设立大小预算。这是 scoped context 在 agent 侧
的落实,直接根因是生产实测的 300KB prompt 与 meta 导航循环。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [Plan](./plan.md)

当前状态:`completed`。方向依据:`conductor/product-vision.md` §一(scoped
context is the most important)、§五、§六、§八;依赖 T29(已归档)处境装配。
实施自包含说明见 plan.md「实施者读本」。
