/**
 * Surface 内核公开面(T23 Phase D 拆分,纯搬运):types(语义树/目录/校验形状)、
 * validate(catalog/树校验与序列化还原)、normalize(canonical 形态与稳定身份)、
 * generic(机械兜底规划器)。公开符号与拆分前的 surface.ts 一致。
 */
export * from './types';
export { restoreSurfaceTree, validateSurfaceCatalog, validateSurfaceTree } from './validate';
export { hashSurfaceTree, normalizeSurfaceTree, serializeSurfaceTree } from './normalize';
export { planGenericSurface } from './generic';
