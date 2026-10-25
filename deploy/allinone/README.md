# All-in-one deployment

This variant runs the GraphRAG MCP application and PostgreSQL with pgvector in
one container. It is intended for a throwaway VPS where portability matters
more than process and service isolation.

## Configure and start

Copy `.env.allinone.example` to `.env.allinone` and replace the placeholder
credentials and model settings. Values in `.env.allinone` are deployment
secrets; do not commit that file. If you use access control, create `access/`
and place your `accounts.local.json` there (the Compose file mounts it read-only).

From the repository root, build and start the service:

```sh
docker compose -f deploy/allinone/docker-compose.allinone.yml up -d --build
```

The service listens on `${MCP_PORT:-3000}`. The included dataset catalogue is
baked into the image at `/app/datasets.json`, so no datasets mount is needed.

## Load a snapshot

`docker exec` starts a new process that does **not** inherit the
`DATABASE_URL` the entrypoint exports, so pass it explicitly. Copy the snapshot
in (or bind-mount it) and run the loader from the application directory:

```sh
docker cp /path/to/snapshots/<id> <ctr>:/tmp/snap
docker exec <ctr> sh -c 'export DATABASE_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@127.0.0.1:5432/$POSTGRES_DB";
  cd /workspace/integrations/mcp && bun scripts/integrity-load.ts /tmp/snap'
```

A successful load prints one JSON line
(`{"snapshot_id":"…","papers":N,"cites":N,"retractions":N,"active":true}`) and
the new snapshot becomes the active one; earlier snapshots stay on disk and can
be re-activated by loading them again.

## Verify

Check health and the baked-in dataset catalogue:

```sh
curl -fsS "http://localhost:${MCP_PORT:-3000}/healthz"
curl -fsS "http://localhost:${MCP_PORT:-3000}/api/v1/datasets"
```

With `X402_ENABLED=true` and the x402 settings configured, an unpaid judgment
request should return HTTP 402:

```sh
curl -i -X POST "http://localhost:${MCP_PORT:-3000}/api/v1/judge" \
  -H 'content-type: application/json' \
  -d '{}'
```

## Indexing and persistence

Indexing requires a reachable embedding endpoint configured through
`RAG_EMBED_*`; its responses must contain exactly 768 dimensions. Without
that endpoint, indexing does not work. Chat providers for slicing and judging
must also be reachable for those model-assisted operations.

PostgreSQL data lives in the named `graphrag-pgdata` volume. Back it up while
the service is stopped (or use a PostgreSQL-consistent backup procedure):

```sh
docker compose -f deploy/allinone/docker-compose.allinone.yml stop
docker run --rm \
  -v graphrag-pgdata:/var/lib/postgresql/data:ro \
  -v "$PWD/backups:/backup" \
  alpine tar czf /backup/graphrag-pgdata.tar.gz -C /var/lib/postgresql/data .
```

To restore, stop the service, extract the backup into the same named volume,
and start the service again:

```sh
docker compose -f deploy/allinone/docker-compose.allinone.yml stop
docker run --rm \
  -v graphrag-pgdata:/var/lib/postgresql/data \
  -v "$PWD/backups:/backup:ro" \
  alpine sh -c 'rm -rf /var/lib/postgresql/data/* && tar xzf /backup/graphrag-pgdata.tar.gz -C /var/lib/postgresql/data'
docker compose -f deploy/allinone/docker-compose.allinone.yml up -d
```

This layout trades isolation for portability: application and database share a
container lifecycle and failure domain. Keep independent backups and avoid
using this design where separate service isolation or high availability is
required.

## Gotchas this layout actually hit (keep these when editing the image)

1. **The npm `bun` package ships `bin/bun.exe`**, not `bin/bun`. A symlink to
   `…/node_modules/bun/bin/bun` dangles and the container restart-loops with
   `No such file or directory`.
2. **Prisma picks its query-engine flavour at generate time.** The build stage
   (`node:22-bookworm-slim`) reports openssl 1.1 while the runtime stage is
   Debian 12 with openssl 3.0, so `prisma generate` must run in a build stage
   that has `openssl` installed — otherwise the container dies with
   `Prisma Client could not locate the Query Engine for runtime
   "debian-openssl-3.0.x"`.
3. **`ensureGraphSchema()` shells out to `./node_modules/.bin/prisma db push`**,
   which is a node shim. The runtime stage therefore needs a `node` binary in
   PATH even though the app itself runs on bun; without it the service prints
   only `GraphRAG MCP service failed to start.` and exits.
4. **Healthcheck matters here**: because app and database share the container,
   a schema failure looks like "restarting" rather than "db unreachable". Read
   `docker logs` (Postgres lines are interleaved with app JSON logs).
5. Postgres and the app share one network namespace, so the app talks to
   `127.0.0.1:5432`; never expose 5432 publicly on this layout.
