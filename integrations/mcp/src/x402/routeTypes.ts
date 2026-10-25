import type { AppConfig } from '../config.ts';
import type { Logger } from '../log.ts';
import type { IndexStore } from '../store.ts';
import type { runSnapshotQuery } from '../queryService.ts';
import type { createQueryLimiter } from '../mcp/tools.ts';
import type { DatasetRegistry } from './datasets.ts';
import type { FacilitatorClient } from './facilitator.ts';
import type { PaymentLedger } from './payments.ts';
import type { X402Settings } from './settings.ts';
import type { IntegrityStore } from '../integrity/store.ts';
import type { Judge } from '../integrity/judge.ts';

export type PaidRouteDeps = {
  readonly store: IndexStore;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly registry: DatasetRegistry;
  readonly payments: PaymentLedger;
  readonly facilitator: FacilitatorClient;
  readonly limiter: ReturnType<typeof createQueryLimiter>;
  readonly settings: X402Settings;
  readonly integrity: IntegrityStore;
  readonly judge: Judge;
  readonly now?: () => number;
  readonly runQuery?: typeof runSnapshotQuery;
};
