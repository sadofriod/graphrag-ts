import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { buildEdges } from '@ashes_born/graph-rag-ts/build/helper/buildEdges';
import { getPrismaClient, injectPrismaClient } from '@ashes_born/graph-rag-ts/prisma-client';
import { pruneStaleDocuments } from '@ashes_born/graph-rag-ts/incremental';
import { withNamespace } from '@ashes_born/graph-rag-ts/namespace/namespaceContext';
import { createStore } from './store.ts';
import { modelLoaderSingleton } from '@ashes_born/graph-rag-ts/model-loader';
import { GraphRAGRetrievalService } from '@ashes_born/graph-rag-ts';
import { resolveSnapshotSources } from './snapshotSources.ts';

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;

test.skipIf(!databaseUrl)('shared edges retain other documents contributions on replay and deletion', async () => {
  const client = new PrismaClient({ datasourceUrl: databaseUrl! });
  const original = getPrismaClient();
  const namespace = `edge-regression-${randomUUID()}`;
  injectPrismaClient(client);
  try {
    await withNamespace(namespace, async () => {
      const first = await client.rAGParent.create({ data: { namespace, title: 'first.md', content: 'first' } });
      const second = await client.rAGParent.create({ data: { namespace, title: 'second.md', content: 'second' } });
      const write = (parentId: string, weight: number) => buildEdges([
        { source: 'A', target: 'B', relation: 'supports', weight },
      ], parentId, namespace);
      await write(first.id, 2);
      await write(first.id, 2);
      expect((await client.rAGGraphEdge.findFirstOrThrow({ where: { namespace } })).weight).toBe(2);
      await write(second.id, 3);
      expect((await client.rAGGraphEdge.findFirstOrThrow({ where: { namespace } })).weight).toBe(5);
      await Promise.all([write(first.id, 2), write(second.id, 3)]);
      expect((await client.rAGGraphEdge.findFirstOrThrow({ where: { namespace } })).weight).toBe(5);
      await pruneStaleDocuments([first.id], namespace);
      expect((await client.rAGGraphEdge.findFirstOrThrow({ where: { namespace } })).weight).toBe(3);
      await pruneStaleDocuments([second.id], namespace);
      expect(await client.rAGGraphEdge.count({ where: { namespace } })).toBe(0);
    });
  } finally {
    injectPrismaClient(original);
    await client.rAGParent.deleteMany({ where: { namespace } });
    await client.rAGEntity.deleteMany({ where: { namespace } });
    await client.$disconnect();
  }
});

test.skipIf(!databaseUrl)('reuses a successful global answer for concurrent identical snapshot queries', async () => {
  const client = new PrismaClient({ datasourceUrl: databaseUrl! });
  const original = getPrismaClient();
  const originalModels = modelLoaderSingleton.models;
  const namespace = `query-cache-${randomUUID()}`;
  let calls = 0;
  let useful = true;
  injectPrismaClient(client);
  const invoke = async (prompt: string) => {
    calls += 1;
    if (prompt.includes('Reduce stage')) return JSON.stringify({ answer: `Answer ${calls}` });
    return JSON.stringify({ answer: 'Evidence', usefulness: useful ? 90 : 0 });
  };
  modelLoaderSingleton.models = { slice: { invoke } } as never;
  try {
    await client.rAGCommunitySummary.create({ data: {
      namespace, communityName: 'A', summaryContent: 'Evidence', members: ['A'],
    } });
    const service = new GraphRAGRetrievalService();
    const request = { namespace, query: 'Question', options: { responseCache: true } };
    const results = await Promise.all([
      service.retrieveGlobal(request), service.retrieveGlobal(request), service.retrieveGlobal(request),
    ]);
    expect(calls).toBe(2);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(await service.retrieveGlobal(request)).toEqual(results[0]);
    expect(calls).toBe(2);
    await client.rAGCommunitySummary.updateMany({ where: { namespace }, data: { summaryContent: 'Updated evidence' } });
    expect((await service.retrieveGlobal(request)).answer).not.toBe(results[0]!.answer);
    expect(calls).toBe(4);
    await service.retrieveGlobal(request);
    expect(calls).toBe(4);
    modelLoaderSingleton.models = { slice: { invoke } } as never;
    await service.retrieveGlobal(request);
    expect(calls).toBe(6);
    useful = false;
    const emptyRequest = { ...request, query: 'Previously empty result' };
    expect((await service.retrieveGlobal(emptyRequest)).status).toBe('no_results');
    expect(await client.rAGGlobalQueryCache.count({ where: { namespace } })).toBe(3);
    useful = true;
    expect((await service.retrieveGlobal(emptyRequest)).status).toBe('completed');
    expect(calls).toBe(9);
    await service.retrieveGlobal(emptyRequest);
    expect(calls).toBe(9);
  } finally {
    injectPrismaClient(original);
    modelLoaderSingleton.models = originalModels;
    await client.rAGGlobalQueryCache.deleteMany({ where: { namespace } });
    await client.rAGCommunitySummary.deleteMany({ where: { namespace } });
    await client.$disconnect();
  }
});

test.skipIf(!databaseUrl)('clones contributions and graph references without modifying the published snapshot', async () => {
  const client = new PrismaClient({ datasourceUrl: databaseUrl! });
  const store = createStore(databaseUrl!);
  const original = getPrismaClient();
  const namespace = `clone-source-${randomUUID()}`;
  const target = `clone-target-${randomUUID()}`;
  injectPrismaClient(client);
  try {
    await store.migrate();
    await withNamespace(namespace, async () => {
      const first = await client.rAGParent.create({ data: { namespace, title: 'first.md', content: 'first' } });
      const second = await client.rAGParent.create({ data: { namespace, title: 'second.md', content: 'second' } });
      await buildEdges([{ source: 'A', target: 'B', relation: 'supports', weight: 2 }], first.id, namespace);
      await buildEdges([{ source: 'A', target: 'B', relation: 'supports', weight: 3 }], second.id, namespace);
      const root = await client.rAGCommunitySummary.create({ data: {
        namespace, communityName: 'root', summaryContent: 'Root', members: ['A', 'B'], level: 1,
      } });
      const leaf = await client.rAGCommunitySummary.create({ data: {
        namespace, communityName: 'leaf', summaryContent: 'Leaf', members: ['A', 'B'],
        parentCommunityId: root.id, contentFingerprint: 'a'.repeat(64),
      } });
      const childId = randomUUID();
      const vector = JSON.stringify(Array<number>(768).fill(0.1));
      await client.$executeRaw`INSERT INTO rag_children (id, namespace, parent_id, content, updated_at, embedding, fts_tokens)
        VALUES (${childId}, ${namespace}, ${first.id}, 'Evidence', now(), ${vector}::vector, to_tsvector('Evidence'))`;
      await client.$executeRaw`UPDATE rag_community_summaries SET summary_embedding = ${vector}::vector WHERE id = ${leaf.id}`;
      const edge = await client.rAGGraphEdge.findFirstOrThrow({ where: { namespace } });
      await client.rAGGraphEdge.update({ where: { id: edge.id }, data: { communitySummaryId: leaf.id } });
      await client.rAGClaim.create({ data: {
        namespace, subjectEntityId: edge.sourceEntityId, objectEntityId: edge.targetEntityId,
        description: 'Evidence', descriptionHash: 'b'.repeat(64), sourceParentId: first.id,
        sourceChunkId: childId, communitySummaryId: leaf.id,
      } });
      await client.rAGGlobalQueryCache.create({ data: { namespace, cacheKey: 'c'.repeat(64), result: {} } });
      await store.cloneSnapshot(namespace, target);
      const clonedFirst = await client.rAGParent.findFirstOrThrow({ where: { namespace: target, title: 'first.md' } });
      expect(clonedFirst.id).not.toBe(first.id);
      const clonedClaim = await client.rAGClaim.findFirstOrThrow({ where: { namespace: target }, include: {
        sourceChunk: true, subjectEntity: true, objectEntity: true,
        communitySummary: { include: { parentCommunity: true } },
      } });
      expect(clonedClaim.sourceParentId).toBe(clonedFirst.id);
      expect(clonedClaim.sourceChunk?.parentId).toBe(clonedFirst.id);
      expect(clonedClaim.sourceChunkId).not.toBe(childId);
      expect(clonedClaim.subjectEntity.namespace).toBe(target);
      expect(clonedClaim.objectEntity?.namespace).toBe(target);
      expect(clonedClaim.communitySummary?.parentCommunity?.namespace).toBe(target);
      expect(clonedClaim.communitySummary?.contentFingerprint).toBe(leaf.contentFingerprint);
      const copied = await client.$queryRaw<{ equal: boolean }[]>`SELECT
        (child.embedding = ${vector}::vector AND child.fts_tokens = to_tsvector('Evidence')
          AND summary.summary_embedding = ${vector}::vector) AS equal
        FROM rag_children child JOIN rag_community_summaries summary ON summary.id = ${clonedClaim.communitySummaryId}
        WHERE child.id = ${clonedClaim.sourceChunkId}`;
      expect(copied[0]?.equal).toBe(true);
      expect(await client.rAGGlobalQueryCache.count({ where: { namespace: target } })).toBe(0);
      await expect(store.cloneSnapshot(namespace, target)).rejects.toThrow();
      expect(await client.rAGParent.count({ where: { namespace: target } })).toBe(2);
      await buildEdges([{ source: 'A', target: 'B', relation: 'supports', weight: 4 }], clonedFirst.id, target);
      expect((await client.rAGGraphEdge.findFirstOrThrow({ where: { namespace: target } })).weight).toBe(7);
      expect((await client.rAGGraphEdge.findFirstOrThrow({ where: { namespace } })).weight).toBe(5);
    });
  } finally {
    injectPrismaClient(original);
    await store.discardSnapshot(target);
    await store.discardSnapshot(namespace);
    await store.close();
    await client.$disconnect();
  }
});

test.skipIf(!databaseUrl)('publishes file replacements and skips matching stored fingerprints on subsequent jobs', async () => {
  const client = new PrismaClient({ datasourceUrl: databaseUrl! });
  const store = createStore(databaseUrl!);
  const workspace = `versions-${randomUUID()}`;
  const sourceIds: string[] = [];
  try {
    await store.migrate();
    for (const content of ['old policy', 'new policy', 'new policy']) {
      const input = {
        sourceLabel: 'policy.md', content, mediaType: 'text/markdown' as const,
        contentHash: createHash('sha256').update(content).digest('hex'),
      };
      const active = await store.getActiveSnapshot(workspace);
      const { id } = await store.enqueue([input], workspace);
      expect((await store.claimNextJob())?.id).toBe(id);
      const inputs = await store.getInputs(id);
      const plan = resolveSnapshotSources(active.sources, inputs);
      expect(plan.sources).toHaveLength(1);
      expect(plan.sources[0]?.content).toBe(content);
      if (sourceIds.length === 2) expect(plan.changed).toHaveLength(0);
      else expect(plan.changed).toHaveLength(1);
      const namespace = `snapshot-${randomUUID()}`;
      await store.beginSnapshot(id, namespace, workspace);
      await store.publish(id, randomUUID(), namespace, workspace, active.sources.map((source) => source.id));
      const published = await store.getActiveSnapshot(workspace);
      expect(published.sources).toHaveLength(1);
      expect(published.sources[0]?.content).toBe(content);
      sourceIds.push(published.sources[0]!.id);
    }
    expect(sourceIds[1]).not.toBe(sourceIds[0]);
    expect(sourceIds[2]).toBe(sourceIds[1]);
  } finally {
    await client.$executeRaw`DELETE FROM active_index WHERE workspace_id = ${workspace}`;
    await client.$executeRaw`DELETE FROM index_versions WHERE workspace_id = ${workspace}`;
    await client.$executeRaw`DELETE FROM knowledge_sources WHERE created_by_job_id IN (SELECT id FROM index_jobs WHERE workspace_id = ${workspace})`;
    await client.$executeRaw`DELETE FROM index_jobs WHERE workspace_id = ${workspace}`;
    await store.close();
    await client.$disconnect();
  }
});