/**
 * Siren 投影器:rel → Siren 实体(arch-brief §2 四件组装)。
 *
 * 模块切分(T23 Phase D,纯搬运):types(公共形状)/ build(实体构件)/
 * project(业务平面投影 + project 路由)/ project-meta(定义平面投影)。
 * 公开面与原 src/siren.ts 一致:实体/动作类型 + project。
 */
export * from './types';
export { project } from './project';
