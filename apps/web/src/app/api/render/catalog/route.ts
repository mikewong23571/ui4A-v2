import { renderCatalogJson } from '../../../../render/registry';

// GET /api/render/catalog — 渲染词汇表目录(T7 Phase A Task 2):
// 返回 A2UI 扩展目录 JSON($id/catalogId + components{词名: bindSchema}),
// 与注册表同源;createSurface 以本 URL(catalogId URI)引用目录。
// 静态目录(无 db/状态),传输无关:HTTP 只是目录的一种投递形态。

export function GET(): Response {
  return Response.json(renderCatalogJson());
}
