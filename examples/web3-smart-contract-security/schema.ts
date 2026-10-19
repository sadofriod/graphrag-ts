// These tables are a delivery format, deliberately separate from all rag_* tables.
export const schema = `CREATE SCHEMA IF NOT EXISTS web3_security_dataset;
CREATE TABLE IF NOT EXISTS web3_security_dataset.datasets (
  dataset_id text PRIMARY KEY, version text NOT NULL, title text NOT NULL,
  synthetic boolean NOT NULL, license text NOT NULL, license_text text NOT NULL, usage_notice text NOT NULL
);
CREATE TABLE IF NOT EXISTS web3_security_dataset.sources (
  dataset_id text NOT NULL REFERENCES web3_security_dataset.datasets(dataset_id),
  id text NOT NULL, title text NOT NULL, markdown_path text NOT NULL, excerpt text NOT NULL,
  license text NOT NULL, creator text NOT NULL, origin text NOT NULL, locator text NOT NULL, rights text NOT NULL,
  PRIMARY KEY (dataset_id, id), UNIQUE (dataset_id, markdown_path)
);
CREATE TABLE IF NOT EXISTS web3_security_dataset.entities (
  dataset_id text NOT NULL REFERENCES web3_security_dataset.datasets(dataset_id),
  id text NOT NULL, kind text NOT NULL, name text NOT NULL, summary text NOT NULL,
  PRIMARY KEY (dataset_id, id)
);
CREATE TABLE IF NOT EXISTS web3_security_dataset.relations (
  dataset_id text NOT NULL REFERENCES web3_security_dataset.datasets(dataset_id),
  id text NOT NULL, kind text NOT NULL, from_id text NOT NULL, to_id text NOT NULL,
  PRIMARY KEY (dataset_id, id),
  FOREIGN KEY (dataset_id, from_id) REFERENCES web3_security_dataset.entities(dataset_id, id),
  FOREIGN KEY (dataset_id, to_id) REFERENCES web3_security_dataset.entities(dataset_id, id)
);
CREATE TABLE IF NOT EXISTS web3_security_dataset.entity_sources (
  dataset_id text NOT NULL, entity_id text NOT NULL, source_id text NOT NULL,
  PRIMARY KEY (dataset_id, entity_id, source_id),
  FOREIGN KEY (dataset_id, entity_id) REFERENCES web3_security_dataset.entities(dataset_id, id),
  FOREIGN KEY (dataset_id, source_id) REFERENCES web3_security_dataset.sources(dataset_id, id)
);
CREATE TABLE IF NOT EXISTS web3_security_dataset.relation_sources (
  dataset_id text NOT NULL, relation_id text NOT NULL, source_id text NOT NULL,
  PRIMARY KEY (dataset_id, relation_id, source_id),
  FOREIGN KEY (dataset_id, relation_id) REFERENCES web3_security_dataset.relations(dataset_id, id),
  FOREIGN KEY (dataset_id, source_id) REFERENCES web3_security_dataset.sources(dataset_id, id)
);
CREATE TABLE IF NOT EXISTS web3_security_dataset.questions (
  dataset_id text NOT NULL REFERENCES web3_security_dataset.datasets(dataset_id),
  id text NOT NULL, question text NOT NULL, PRIMARY KEY (dataset_id, id)
);
CREATE TABLE IF NOT EXISTS web3_security_dataset.question_relations (
  dataset_id text NOT NULL, question_id text NOT NULL, relation_id text NOT NULL,
  PRIMARY KEY (dataset_id, question_id, relation_id),
  FOREIGN KEY (dataset_id, question_id) REFERENCES web3_security_dataset.questions(dataset_id, id),
  FOREIGN KEY (dataset_id, relation_id) REFERENCES web3_security_dataset.relations(dataset_id, id)
);
CREATE TABLE IF NOT EXISTS web3_security_dataset.question_sources (
  dataset_id text NOT NULL, question_id text NOT NULL, source_id text NOT NULL,
  PRIMARY KEY (dataset_id, question_id, source_id),
  FOREIGN KEY (dataset_id, question_id) REFERENCES web3_security_dataset.questions(dataset_id, id),
  FOREIGN KEY (dataset_id, source_id) REFERENCES web3_security_dataset.sources(dataset_id, id)
);`;
