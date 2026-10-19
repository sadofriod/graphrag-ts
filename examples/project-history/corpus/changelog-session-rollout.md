# Harbor session migration change list

This original MIT-licensed fixture describes a fictional project.

## Changes linked to ADR-007

The Session Repository added PostgreSQL session reads, writes and revocation.
Its owner is the Platform Team. The Account Service, owned by the Identity Team,
now revokes sessions inside the account suspension transaction. The Auth Gateway,
also owned by the Identity Team, replaced its direct Redis session lookup with a
Session Repository call. These are the modules affected by the transactional
revocation decision, not evidence that all caching moved into PostgreSQL.

The Background Cleanup Worker, owned by the Operations Team, gained a bounded
expired-session deletion task. The cleanup worker runs in small batches to avoid
long locks; the runbook describes what to monitor before increasing the batch size.

## Rollout order

First deploy the schema and repository while the new read path is disabled. Then
enable the account transaction integration. Finally enable the Auth Gateway read
path for a small cohort. Operations reviews the pool-wait and revocation checks
before widening the cohort. Session writes are not mirrored indefinitely.

The rollback flag affects the Auth Gateway read path, not the existence of the
PostgreSQL tables. Operations must consult the runbook rather than deleting
session rows to simulate rollback.

Source marker: CHANGE-014.
