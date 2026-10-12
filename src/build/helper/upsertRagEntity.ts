import { prismaClient } from './prismaClient';

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'P2002';

export const upsertRagEntity = async (
  namespace: string,
  name: string,
  description?: string,
): Promise<{ id: string }> => {
  const where = { namespace_name: { namespace, name } };
  const descriptionData = description ? { description } : {};

  try {
    return await prismaClient.rAGEntity.upsert({
      where,
      update: descriptionData,
      create: { namespace, name, ...descriptionData },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    const existing = await prismaClient.rAGEntity.findUnique({ where, select: { id: true } });
    if (!existing) {
      throw error;
    }
    return existing;
  }
};