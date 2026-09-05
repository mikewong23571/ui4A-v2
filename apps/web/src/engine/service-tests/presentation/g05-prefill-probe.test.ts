/**
 * G05 探针(T54 Phase 4):工作区编辑预填——`properties.fields` 在
 * fresh entity → surface 依赖 → repeat 成员(item 水合载荷)→ member 词
 * item 路径的逐段存活性。
 *
 * 结论回写 plan 附录 C:若服务端全链存活,缺口收敛到浏览器端 A2UI item
 * 水合/词消费;反之在失活的那一跳修复。
 */
import { describe, expect, it } from 'vitest';

import { completePresentationRequest } from '@ui4a/shared';
import { findActiveSidecar, ensurePresentationTables } from '@ui4a/db/presentation';

import { getDb, getEngine, resetEngineForTests } from '../../service';
import {
  getPresentationBroker,
  resetPresentationBrokerForTests,
} from '../../presentation/runtime';
import { resetRecipeCoordinatorForTests } from '../../presentation/recipes-runtime';
import { hydratePresentationSurface } from '../../../render/presentation/generic';

describe('G05 workspace prefill probe', () => {
  it('字段在 fresh entity/集合成员/repeat 水合逐段存活;item 路径指向 properties/fields', async () => {
    await ensurePresentationTables(getDb());
    await getDb().query('TRUNCATE events, presentation_user_sidecars');
    resetEngineForTests();
    resetPresentationBrokerForTests();
    resetRecipeCoordinatorForTests();
    const engine = await getEngine(getDb());

    // 造一条想法(idea-capture 起步动作 keep → append ideas 成员)。
    const created = await engine.exec({
      rel: 'flow:idea-capture',
      action: 'keep',
      params: { title: 'G05 探针标题' },
      actor: 'human',
      principal: 'local-user',
      channel: 'http',
    });
    if (created.kind === 'rejected') {
      throw new Error(`前置失败:keep 被拒:${created.reason}`);
    }
    expect(created.kind).toBe('accepted');

    // ① fresh entity:ideas 集合成员实例投影携带 properties.fields.title
    //   (idea-item 随 append 落库,name-from=title)。
    const collection = await engine.getEntity('ideas');
    expect(collection?.properties.count ?? 0).toBeGreaterThan(0);
    const member = collection?.entities?.find(
      (child) =>
        typeof (child.properties.fields as Record<string, unknown> | undefined)?.title ===
        'string',
    );
    expect(member).toBeDefined();
    const memberRel = member!.properties.rel as string;
    const instanceEntity = await engine.getEntity(memberRel);
    expect(
      (instanceEntity?.properties.fields as Record<string, unknown> | undefined)?.title,
    ).toBeDefined();

    // ② surface 依赖 + repeat 水合:present ideas 工作区,roots=getEntity(deps)。
    const receipt = await getPresentationBroker().present(
      completePresentationRequest(
        { subject: 'workspace:app:ideas', intent: 'app overview', delivery: 'canvas' },
        { requestId: 'g05-probe', principal: 'local-user', sourceMessageIds: [] },
      ),
    );
    expect(receipt).toMatchObject({ status: 'ready' });
    const sidecar = await findActiveSidecar(getDb(), {
      principal: 'local-user',
      subject: 'workspace:app:ideas',
      intent: 'app overview',
      deviceClass: 'any',
    });
    expect(sidecar).toBeDefined();
    const active = sidecar!.versions[sidecar!.activeVersion]!;
    const refs = active.dependencies
      .filter((dependency) => dependency.kind === 'entity-contract')
      .map((dependency) => dependency.ref);
    expect(refs).toContain('ideas');
    const roots: NonNullable<Awaited<ReturnType<typeof engine.getEntity>>>[] = [];
    for (const ref of refs) {
      const entity = await engine.getEntity(ref);
      if (entity === undefined) throw new Error(`依赖实体 "${ref}" 缺失`);
      roots.push(entity);
    }
    const plan = hydratePresentationSurface('workspace:app:ideas', active.surface, roots, refs);
    expect(plan.bundle.issues.filter((issue) => issue.code === 'deref-failed')).toEqual([]);

    // ③ repeat items(数据模型载荷)中,该成员仍携带 fields(item 路径可解析)。
    const dataModel = (
      plan.bundle.messages.find(
        (message) => 'updateDataModel' in message && message.updateDataModel !== undefined,
      ) as { updateDataModel?: { value?: Record<string, unknown> } } | undefined
    )?.updateDataModel;
    const allItems = Object.values(dataModel?.value?.repeats ?? {}).flat();
    const hydratedMember = allItems.find(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        ((item as { properties?: { rel?: unknown } }).properties?.rel === memberRel),
    ) as { properties?: { fields?: Record<string, unknown> } } | undefined;
    expect(hydratedMember).toBeDefined();
    expect(hydratedMember!.properties?.fields?.title).toBeDefined();

    // ④ member 词的 fields 绑定编译为 item 路径 properties/fields(binding-only)。
    const components = (
      plan.bundle.messages.find(
        (message) => 'updateComponents' in message && message.updateComponents !== undefined,
      ) as { updateComponents?: { components?: unknown[] } } | undefined
    )?.updateComponents;
    const componentsJson = JSON.stringify(components?.components ?? []);
    expect(componentsJson).toContain('"path":"properties/fields"');

    // ⑤ G05 缺口(R17):entity 形状区域(detail controls 词)的动作切片
    //    (actions-entity transform)必须携带源实体的 properties.fields——
    //    否则工作区编辑表单预填为空(实体页直连全量实体故可预填)。
    const values = ((dataModel?.value ?? {}) as { values?: Record<string, Record<string, {
      class?: string[];
      properties?: { fields?: Record<string, unknown> };
    }>> }).values ?? {};
    const actionSlices = Object.values(values).flatMap((bindings) => Object.values(bindings));
    const sliceWithFields = actionSlices.find(
      (slice) =>
        Array.isArray(slice?.class) &&
        slice.class.includes('presentation-action-slice') &&
        typeof slice.properties?.fields === 'object' &&
        slice.properties.fields !== null,
    );
    expect(sliceWithFields).toBeDefined();
  });
});
