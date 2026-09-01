import { prismaClient } from './prismaClient';

export interface ChunkEntity {
  name: string;
  description?: string;
}

/** Entity descriptions use last-write-wins, but an empty description does not overwrite an existing value. */
export const buildEntities = async (
  entities: readonly ChunkEntity[],
  namespace: string,
): Promise<number> => {
  if (entities.length === 0) {
    return 0;
  }

  let written = 0;
  for (const entity of entities) {
    const name = entity.name.trim();
    const description = entity.description?.trim();
    if (!name) {
      continue;
    }
    await prismaClient.rAGEntity.upsert({
      where: { namespace_name: { namespace, name } },
      update: description ? { description } : {},
      create: { namespace, name, ...(description ? { description } : {}) },
    });
    written += 1;
  }

  return written;
};
