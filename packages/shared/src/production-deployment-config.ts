/**
 * 兼容深路径入口(deploy/compose/stack-contract.json 与 scripts/t22/t22-* 按本路径引用):
 * 实现已按配置域拆至 ./deployment/*(T23 Phase D),公开面原样经 barrel 重导出。
 */
export * from './deployment/index';
