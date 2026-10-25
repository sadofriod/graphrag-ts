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

Mount the snapshot directory into the running container, then run the loader
from the MCP application directory. For example, recreate the service with a
read-only bind mount for a local snapshot:

```yaml
    volumes:
      - graphrag-pgdata:/var/lib/postgresql/data
      - ./access:/app/access:ro
      - /path/to/snapshots:/data/snapshots:ro
```

Then load the selected snapshot:

```sh
docker exec <ctr> bun scripts/integrity-load.ts /data/snapshots/<id>
```

Replace `<ctr>` with the running container name or ID and `<id>` with the
snapshot directory name.

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
