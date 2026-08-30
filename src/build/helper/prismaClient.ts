import { PrismaClient } from '@prisma/client';

import { createScopedClient } from '../../namespace/createScopedClient';

export const prismaClient = createScopedClient(new PrismaClient());
