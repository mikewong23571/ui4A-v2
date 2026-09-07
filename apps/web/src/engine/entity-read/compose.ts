import type { DbExecutor } from '@ui4a/db/events';
import { projectThreadActionExperience, type SirenEntity } from '@ui4a/engine';
import { enrichEntityWithMessages } from '../../chat/messages/enrich-entity';

/** Common HTTP, mutation receipt and Presentation read composition after authorization pruning. */
export async function composeAuthorizedEntity(
  db: DbExecutor,
  entity: SirenEntity,
  principal: string,
  readMode: 'required' | 'committed-receipt' = 'required',
): Promise<SirenEntity> {
  return projectThreadActionExperience(
    await enrichEntityWithMessages(db, entity, principal, readMode),
  );
}
