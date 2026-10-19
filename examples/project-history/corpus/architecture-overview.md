# Harbor architecture overview

Harbor is a fictional TypeScript product used only as an original MIT-licensed
GraphRAG demonstration. All names, identifiers and rollout events are invented.

## Identity path

Browser requests enter the Auth Gateway. The gateway delegates session lookup to
the Session Repository. The Account Service owns account state and invokes the
same repository for transactional revocation. These modules share PostgreSQL so
an account suspension can invalidate its sessions atomically. ADR-007 records why
the team chose that boundary; the change list records who implements it.

## Discovery path

The Recommendation Cache stores derived public catalog recommendations in Redis.
The Discovery Team owns it and can rebuild it from catalog data. A missing cached
recommendation is not an authentication failure. Its eventual consistency is
acceptable because it does not grant access to a suspended account.

## Operations

The Operations Team owns the Background Cleanup Worker and release gate.
The worker removes expired browser-session rows from PostgreSQL. It does not own
the Recommendation Cache. The runbook's monitoring requirements apply to the
session rollout; they are not a universal latency promise for all workloads.

There is no evidence in this fixture that the migration lowered cloud costs,
improved average response time or removed every Redis deployment.

Source marker: ARCH-003.
