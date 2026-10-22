CREATE TABLE "rag_edge_contributions" (
  "namespace" TEXT NOT NULL,
  "edge_id" TEXT NOT NULL REFERENCES "rag_graph_edges"("id") ON DELETE CASCADE,
  "parent_id" TEXT NOT NULL REFERENCES "rag_parents"("id") ON DELETE CASCADE,
  "weight" INTEGER NOT NULL,
  "relationship_desc" TEXT NOT NULL,
  PRIMARY KEY ("edge_id", "parent_id")
);
CREATE INDEX "rag_edge_contributions_namespace_parent_id_idx"
  ON "rag_edge_contributions"("namespace", "parent_id");
INSERT INTO "rag_edge_contributions" (namespace, edge_id, parent_id, weight, relationship_desc)
SELECT namespace, id, parent_id, weight, relationship_desc FROM "rag_graph_edges" WHERE parent_id IS NOT NULL;
ALTER TABLE "rag_graph_edges" DROP CONSTRAINT "rag_graph_edges_parent_id_fkey";
ALTER TABLE "rag_graph_edges" ADD CONSTRAINT "rag_graph_edges_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "rag_parents"("id") ON DELETE SET NULL ON UPDATE CASCADE;