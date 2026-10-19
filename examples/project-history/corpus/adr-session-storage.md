# ADR-007: Session storage for the fictional Harbor project

This is an original fictional engineering fixture, distributed under the repository's
MIT license. It does not describe a real customer's infrastructure.

## Decision

Harbor moved browser sessions from Redis to PostgreSQL. The motivation was to make
session revocation and account suspension commit in the same database transaction.
Previously the Account Service updated the account row and then sent a separate
Redis delete operation. A failed second operation left a session valid after the
account had been suspended. The decision prioritized a consistent revocation
boundary, not a claim that PostgreSQL is always faster than Redis.

## Scope

The decision covers browser authentication sessions only. The Session Repository
owns the PostgreSQL queries. The Account Service must call it within the existing
account transaction. The Auth Gateway reads sessions through the repository rather
than through a Redis client. The Background Cleanup Worker deletes expired rows.
The change list records the owners and rollout sequencing.

## Alternatives and consequences

The team considered a retry queue for Redis deletion, but rejected it because the
queue would provide eventual rather than transactional revocation. The trade-off
is additional database connections and a need to monitor pool wait time. The
runbook defines the rollout gate. Redis remains available for unrelated cache
workloads; this decision is not permission to remove every Redis dependency.

Source marker: ADR-007.
