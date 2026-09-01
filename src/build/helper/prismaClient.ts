import { PrismaClient } from '@prisma/client';

import { createScopedClient } from '../../namespace/createScopedClient';

export let prismaClient = createScopedClient(new PrismaClient());

export const getPrismaClient = (): PrismaClient => prismaClient;

export const injectPrismaClient = (client: PrismaClient): PrismaClient => {
  prismaClient = createScopedClient(client);
  return prismaClient;
};
