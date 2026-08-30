-- Baseline migration for the graphrag-ts schema (rag_* tables).
-- Requires the pgvector extension (CREATE EXTENSION IF NOT EXISTS vector).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "rag_parents" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "title" VARCHAR(255),
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rag_parents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rag_children" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parent_id" TEXT NOT NULL,
    "embedding" vector(768),
    "fts_tokens" tsvector,
    CONSTRAINT "rag_children_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rag_entities" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rag_entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rag_community_summaries" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "community_name" VARCHAR(100) NOT NULL,
    "summary_content" TEXT NOT NULL,
    "summary_embedding" vector(768),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rag_community_summaries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rag_graph_edges" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "parent_id" TEXT,
    "source_entity_id" TEXT NOT NULL,
    "target_entity_id" TEXT NOT NULL,
    "relationship_desc" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "community_summary_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rag_graph_edges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rag_claims" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "subject_entity_id" TEXT NOT NULL,
    "object_entity_id" TEXT,
    "description" TEXT NOT NULL,
    "description_hash" CHAR(64) NOT NULL,
    "source_parent_id" TEXT,
    "source_chunk_id" TEXT,
    "community_summary_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rag_claims_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "rag_parents_namespace_idx" ON "rag_parents"("namespace");
CREATE INDEX "rag_children_namespace_idx" ON "rag_children"("namespace");
CREATE INDEX "rag_children_parent_id_idx" ON "rag_children"("parent_id");
CREATE UNIQUE INDEX "rag_entities_namespace_name_key" ON "rag_entities"("namespace", "name");
CREATE INDEX "rag_entities_namespace_idx" ON "rag_entities"("namespace");
CREATE INDEX "rag_graph_edges_namespace_idx" ON "rag_graph_edges"("namespace");
CREATE INDEX "rag_graph_edges_parent_id_idx" ON "rag_graph_edges"("parent_id");
CREATE INDEX "rag_graph_edges_source_entity_id_idx" ON "rag_graph_edges"("source_entity_id");
CREATE INDEX "rag_graph_edges_target_entity_id_idx" ON "rag_graph_edges"("target_entity_id");
CREATE INDEX "rag_graph_edges_community_summary_id_idx" ON "rag_graph_edges"("community_summary_id");
CREATE UNIQUE INDEX "unique_namespace_source_target" ON "rag_graph_edges"("namespace", "source_entity_id", "target_entity_id");
CREATE INDEX "rag_community_summaries_namespace_idx" ON "rag_community_summaries"("namespace");
CREATE INDEX "rag_community_summaries_community_name_idx" ON "rag_community_summaries"("community_name");
CREATE INDEX "rag_claims_namespace_idx" ON "rag_claims"("namespace");
CREATE INDEX "rag_claims_subject_entity_id_idx" ON "rag_claims"("subject_entity_id");
CREATE INDEX "rag_claims_object_entity_id_idx" ON "rag_claims"("object_entity_id");
CREATE INDEX "rag_claims_source_parent_id_idx" ON "rag_claims"("source_parent_id");
CREATE INDEX "rag_claims_community_summary_id_idx" ON "rag_claims"("community_summary_id");
CREATE UNIQUE INDEX "rag_claims_namespace_subject_entity_id_description_hash_key" ON "rag_claims"("namespace", "subject_entity_id", "description_hash");

-- Foreign keys
ALTER TABLE "rag_children" ADD CONSTRAINT "rag_children_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "rag_parents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rag_graph_edges" ADD CONSTRAINT "rag_graph_edges_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "rag_parents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rag_graph_edges" ADD CONSTRAINT "rag_graph_edges_source_entity_id_fkey" FOREIGN KEY ("source_entity_id") REFERENCES "rag_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rag_graph_edges" ADD CONSTRAINT "rag_graph_edges_target_entity_id_fkey" FOREIGN KEY ("target_entity_id") REFERENCES "rag_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rag_graph_edges" ADD CONSTRAINT "rag_graph_edges_community_summary_id_fkey" FOREIGN KEY ("community_summary_id") REFERENCES "rag_community_summaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rag_claims" ADD CONSTRAINT "rag_claims_subject_entity_id_fkey" FOREIGN KEY ("subject_entity_id") REFERENCES "rag_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rag_claims" ADD CONSTRAINT "rag_claims_object_entity_id_fkey" FOREIGN KEY ("object_entity_id") REFERENCES "rag_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rag_claims" ADD CONSTRAINT "rag_claims_source_parent_id_fkey" FOREIGN KEY ("source_parent_id") REFERENCES "rag_parents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rag_claims" ADD CONSTRAINT "rag_claims_source_chunk_id_fkey" FOREIGN KEY ("source_chunk_id") REFERENCES "rag_children"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rag_claims" ADD CONSTRAINT "rag_claims_community_summary_id_fkey" FOREIGN KEY ("community_summary_id") REFERENCES "rag_community_summaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- HNSW index for the embedding vector column
CREATE INDEX IF NOT EXISTS ragchild_embedding_hnsw_idx ON "rag_children"
  USING hnsw ("embedding" vector_cosine_ops);
