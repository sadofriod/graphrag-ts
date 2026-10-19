# Harbor rollout runbook

This original MIT-licensed fixture is fictional operational documentation.

## Acceptance gate

The Operations Team owns the ADR-007 rollout gate. Before expanding the Auth
Gateway cohort, it checks that account suspension and session revocation occur in
one committed transaction. It also monitors database pool wait time and expired
session backlog. A passing cache latency check alone does not satisfy the gate.

The Background Cleanup Worker handles the expired-session backlog. If its batches
hold long locks, reduce batch size and investigate the query plan before expanding
the deployment. The migration changes PostgreSQL load, so a previous Redis
throughput result is not an acceptance result for the new Session Repository.

## Boundaries

The rollback procedure pauses rollout and sends the team back to the prior
application release after an explicit session-state reconciliation review.
Do not blindly flip a session backend or delete the new tables: revocations made
in PostgreSQL may not exist in the old backend.

The Recommendation Cache still uses Redis. It stores derived public catalog
recommendations, not browser authentication sessions. Its owner is the Discovery
Team. ADR-007 did not change that cache and the cleanup worker must not delete its
keys. Consult the architecture overview for the separate ownership boundary.

Source marker: RUNBOOK-009.
