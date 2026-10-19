# Web3 smart-contract safety: synthetic relationship delivery

An **original fictional research/demo dataset**, not production security intelligence.
All contract names, dependencies, incidents and review statuses are invented. There
are no deployed addresses, real incidents, exploit steps, copied reports, loss
estimates or verified security claims. Shared dependencies do **not** establish
that a consumer is vulnerable. Mitigation categories are conceptual, not audited fixes.

The sample contains **11 entities, 13 relationships, 5 source excerpts and 5
relational evaluation questions**. It demonstrates a deliverable a data curator
could offer separately from hosted retrieval: source-grounded JSONL, a PostgreSQL
load script and a Markdown corpus for the existing GraphRAG MCP service.

## Build a delivery (offline)

From the repository root, with Bun and the repository's existing dependencies:

```sh
bun examples/web3-smart-contract-security/cli.ts --help
bun examples/web3-smart-contract-security/cli.ts --out ./examples/web3-smart-contract-security/delivery-demo
```

`--out` is required; its parent directory must exist. The output directory itself
must **not exist**, even if empty. Existing files, directories and symlinks are
rejected, never overwritten. Use a different directory for the next delivery.
Validation runs before any output is created. File writes also use exclusive
creation; `manifest.json` is written last. An I/O failure can leave an incomplete
directory; inspect it and choose a new output path. Do not treat a directory
without a manifest as a complete delivery. Use a trusted local parent directory;
this is not protection against another process with access to your account.

Seller-supplied full datasets use the same schema:

```sh
bun examples/web3-smart-contract-security/cli.ts --input ./seller-owned.json --out ./examples/web3-smart-contract-security/delivery-full
```

`seller-owned.json` is a file **you provide**, not data included or fabricated by
this example. Use `sample.json` or exported `dataset.json` as the format template.
Relative paths are relative to the shell's current directory; the default sample
is resolved relative to the CLI, so it works from another directory.

### Bundle contents

| File | Purpose |
| --- | --- |
| `manifest.json` | Format version, dataset ID/version/license, synthetic flag, usage notice, counts, byte lengths and SHA-256 hashes |
| `dataset.json` | Validated canonical input; suitable for another identical export |
| `entities.jsonl` | Entity IDs, kinds, names, summaries and evidence IDs |
| `relations.jsonl` | Typed graph edges with endpoint and evidence IDs |
| `sources.jsonl` | Exact source excerpts, filenames, individual licenses and provenance |
| `questions.jsonl` | Questions, required relation IDs and expected evidence IDs; no model answers |
| `dataset.sql` | Transactional dedicated PostgreSQL schema and inserts |
| `corpus/*.md` | One Markdown file per source, including provenance, excerpt, entities and edges |
| `LICENSE.txt`, `NOTICE.txt` | Dataset-supplied license text and usage classification |

UTF-8 content, field ordering, ID/reference ordering, paths, SQL and hashes are
deterministic. No timestamps, absolute output paths, random IDs or model calls are
included. Manifest hashes cover every delivered file **except the manifest
itself**. Hashes detect changed bytes relative to a trusted manifest, not publisher
identity; there is no signature or automatic buyer-side verification command.
Questions are not embedded in the corpus, avoiding answer-key leakage.

## Input contract and validation

`types.ts` describes the input; `validate.ts` validates untrusted parsed JSON and
rejects unknown/missing fields. Every array must be nonempty. IDs must match
`[a-z][a-z0-9-]{0,79}` and are globally unique across sources, entities, relations
and questions. Version is `major.minor.patch`.

- Every source needs `license` and `provenance` with nonempty `creator`, `origin`,
  `locator`, `rights`. A locator may be a stable internal record or URN; it is not fetched.
- `synthetic: true` requires every source's origin to be `synthetic-original`.
  `synthetic: false` requires origins `seller-owned` or `licensed`. Mixed synthetic
  and non-synthetic releases should be delivered separately with honest notices.
- Every entity and relation has nonempty, unique `evidenceIds` pointing to sources.
  Every question's relation IDs and expected evidence IDs must exist; the expected
  evidence must include all evidence for its selected relations.
- Filenames are flat lowercase alphanumeric/hyphen slugs ending in `.md`, with a
  stem of 1–80 characters. Absolute paths, directories, traversal, backslashes,
  percent-encoded paths and duplicate names are rejected.
- Text must be well-formed Unicode without NUL or control characters other than
  newline, carriage return and tab. PostgreSQL string literals escape both quotes
  and backslashes using explicit `E'…'` syntax; identifiers are never taken from input.

Supported edge endpoint kinds:

| Kind | From → to |
| --- | --- |
| `depends_on` | contract → dependency |
| `contains` | contract → vulnerability |
| `involves` | incident → contract |
| `illustrates` | incident → vulnerability |
| `mitigates` | mitigation → vulnerability |
| `affected_by` | dependency → vulnerability |

`illustrates` deliberately describes fictional exercises without asserting an
actual exploit. Validation checks structure and reference coverage, **not factual
truth, license validity, excerpt-to-claim entailment or malicious prose**. Seller
inputs require human rights, quality and content-safety review before distribution
or model ingestion. The validator does not turn untrusted prose into trusted
instructions or a verified threat feed.

## PostgreSQL load (separate from MCP indexing)

The fixed `web3_security_dataset` schema contains `datasets`, `sources`, `entities`,
`relations`, `entity_sources`, `relation_sources`, `questions`, `question_relations`
and `question_sources`. Composite foreign keys include `dataset_id`, preventing
cross-dataset references. No `rag_*` tables are read or written.

For an existing, authorized local PostgreSQL database:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ./examples/web3-smart-contract-security/delivery-demo/dataset.sql
```

With the existing root Docker Compose database configured and running:

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < ./examples/web3-smart-contract-security/delivery-demo/dataset.sql
```

Use a trusted database and role with schema creation rights. The script wraps DDL
and inserts in `BEGIN`/`COMMIT`. A duplicate dataset ID fails rather than updating
or deleting data; `ON_ERROR_STOP` plus disconnection rolls back the transaction.
This is a snapshot loader, not an upsert/migration system. Load subsequent versions
into a separate database or supply a distinct dataset ID. Existing incompatible
tables are not migrated. SQL FKs enforce existence; endpoint kind and question
evidence-coverage checks occur in the exporter. Editing SQL bypasses those checks.

## Demo through the existing MCP path ingestion

No new Compose stack or MCP server is needed. Follow
[`integrations/mcp/README.md`](../../integrations/mcp/README.md) to configure root
`.env`, database credentials, chat models and **768-dimensional** embeddings.
Keep secrets local. From the repository root:

```sh
INPUT_HOST_DIR=./examples/web3-smart-contract-security/delivery-demo/corpus docker compose up -d --build --wait
curl http://127.0.0.1:3000/healthz
```

Connect your MCP client to `http://127.0.0.1:3000/mcp`, then invoke these tools
(the following are tool-call examples, not shell commands):

```json
{"name":"submit_index_job","arguments":{"workspace_id":"web3-synthetic-demo","path":"."}}
{"name":"get_index_job","arguments":{"workspace_id":"web3-synthetic-demo","job_id":"<returned-job-id>"}}
{"name":"query_graph","arguments":{"workspace_id":"web3-synthetic-demo","query":"Which conceptual mitigation is linked to the weakness illustrated by Harbor Tabletop?"}}
```

Wait for the indexing job to succeed before querying. Use the same workspace ID
throughout. **The SQL load is not required for this demo and does not prepopulate
MCP graph tables.** MCP extracts a new graph from the Markdown using configured
models; its generated entity/chunk IDs differ from delivery IDs. Evaluate against
source filenames and the stable `Evidence ID:` text in the excerpts. Model output,
latency and recall are not deterministic and no successful model answer is claimed.
The sample fits default 100-file/2-MB-file/10-MB-job limits; larger licensed datasets
require explicit ingestion sizing, partitioning and quality evaluation.

## Five questions and evidence expectations

These are source-reference expectations, **not fabricated model answers**.
`questions.jsonl` provides the exact graph-edge IDs supporting each question.

| Question | Expected evidence IDs / corpus files |
| --- | --- |
| Which fictional unreviewed contract shares a dependency with the contract involved in Harbor Tabletop, and what weakness does that exercise illustrate? | `s-dependencies` (`dependencies.md`), `s-harbor` (`harbor-tabletop.md`) |
| Which conceptual mitigation is linked to the weakness illustrated by Harbor Tabletop? | `s-harbor` (`harbor-tabletop.md`), `s-loom` (`loom-review.md`) |
| Do Harbor Pool and Kite Reserve share a dependency, and which distinct weakness is illustrated by Kite Tabletop? | `s-dependencies` (`dependencies.md`), `s-kite` (`kite-tabletop.md`) |
| What dependency-level weakness merits review for Lumen Vault, and why is that not proof that Lumen itself is vulnerable? | `s-dependencies` (`dependencies.md`), `s-loom` (`loom-review.md`) |
| Which fictional contract participates in Kite Tabletop, and which mitigation category addresses its illustrated weakness? | `s-kite` (`kite-tabletop.md`), `s-freshness` (`freshness-review.md`) |

## Licensing and possible commercial delivery

The original sample and its excerpts are **MIT licensed** under the included
notice. “Research/demo” is a suitability warning, not a noncommercial restriction:
MIT permits commercial reuse. Do not rebrand it as verified or exclusive paid data.
The exporter code's MIT license does **not** grant rights to third-party source data.

For a genuine seller-owned or properly licensed release, supply accurate
dataset-level terms in `license`/`licenseText`, source-level license identifiers and
rights records, creator attribution and provenance locators. Custom contract terms
can use a `LicenseRef-…` identifier. Include any additional required source license
texts/notices in the relevant `rights` fields or distribute them separately as the
license requires. A nonempty rights statement is not proof of permission; verify
redistribution, excerpt use, attribution and downstream commercial rights.

Possible routes—not completed sales or marketplace integrations—include:

1. **Free sample plus licensed full snapshots:** demonstrate schema and evidence
   quality here; deliver a separately reviewed seller-owned bundle under actual terms.
2. **Subscription updates:** deliver distinct versioned snapshots with agreed update
   cadence and support. Scheduling, change feeds and subscription billing are not implemented.
3. **Enterprise/custom curation:** contract for domain coverage, provenance review
   and PostgreSQL delivery. No invented accuracy, audit assurances or revenue claims.
4. **Hosted retrieval access:** operate the existing MCP service separately with
   authentication, authorization, quotas and operations controls. This CLI supplies
   data artifacts only, not access control, payment collection or account provisioning.

No downloads, uploads, external marketplaces, license-key checks, payment
verification, automatic legal approval or production security feeds are included.
The exporter materializes input and output in memory; it is not a large-data
streaming pipeline, semantic deduplicator or cryptographic signing service.

## Validation

```sh
bun test examples/web3-smart-contract-security
./node_modules/.bin/tsc --noEmit -p examples/web3-smart-contract-security/tsconfig.json
./node_modules/.bin/eslint examples/web3-smart-contract-security
```

Tests cover deterministic hashes, JSONL/SQL escaping and references, invalid
inputs, all five questions, exclusive CLI delivery and the actual MCP path reader.
Tests create uniquely named directories inside this example and remove them.
Optional PostgreSQL tests create/drop a uniquely named schema, never production
dataset tables; use only a database where you authorize that operation:

```sh
WEB3_DATASET_POSTGRES_TEST=1 bun --env-file=.env test examples/web3-smart-contract-security/postgres.test.ts
```

Alternatively supply `WEB3_DATASET_TEST_DATABASE_URL` through your local environment.
The PostgreSQL test verifies a live round-trip, SQL-looking text preservation,
foreign keys and duplicate-load rollback. It is skipped unless explicitly enabled.
