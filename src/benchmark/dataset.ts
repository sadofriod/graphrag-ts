/**
 * Synthetic GraphRAG recall benchmark dataset.
 *
 * This is a self-contained, fictional English corpus ("The Glass Archive") used
 * instead of any real project data. The expected entities and phrases appear
 * verbatim in `examples/sample-corpus/` so the benchmark is reproducible and
 * does not leak any proprietary content.
 *
 * Each query contains:
 * - `query`: a natural retrieval question
 * - `expectation.entities`: entity names that must appear in the retrieval context
 * - `expectation.phrases`: key fact phrases (verbatim substrings of the corpus)
 *
 * `topK`: recall@k, the upper bound on communities/evidence returned.
 */

export interface BenchmarkExpectation {
  /** Entity names that must appear in the retrieval context. */
  readonly entities: readonly string[];
  /** Key fact phrases that must appear (verbatim corpus substrings). */
  readonly phrases: readonly string[];
}

export interface BenchmarkQuery {
  /** Unique id, e.g. v1-q1. */
  id: string;
  /** Target volume (1/2/3). */
  volume: 1 | 2 | 3;
  /** Storyline title. */
  story: string;
  /** The fact this query expects to hit (for manual review). */
  fact: string;
  /** The retrieval question. */
  query: string;
  /** Recall window recall@k. */
  topK: number;
  expectation: BenchmarkExpectation;
}

export const BENCHMARK_QUERIES: readonly BenchmarkQuery[] = [
  {
    id: 'v1-q1',
    volume: 1,
    story: 'The Flaw in Perfect Memory',
    fact: 'Mira\'s memory pack was over-optimized; during a repair Kael captured a 0.3-second trauma residue (deep violet pulse) and saw a deleted "person who never existed".',
    query: 'What anomaly does Mira\'s perfect memory pack have? What did Kael see during the repair?',
    topK: 5,
    expectation: {
      entities: ['Mira', 'Kael'],
      phrases: ['perfect memory', 'violet pulse', '0.3-second', 'person who never existed'],
    },
  },
  {
    id: 'v1-q2',
    volume: 1,
    story: 'The Whisper in the Data Pipeline',
    fact: 'Kael met ghost-data courier Old Chen in the Echo Market and received a metal shard carrying an electromagnetic fingerprint; Chen\'s shelter was later purged.',
    query: 'Where did Kael meet Old Chen, and what key evidence did he obtain?',
    topK: 5,
    expectation: {
      entities: ['Old Chen', 'Kael', 'Echo Market'],
      phrases: ['metal shard', 'electromagnetic fingerprint', 'shelter'],
    },
  },
  {
    id: 'v1-q3',
    volume: 1,
    story: 'The First Resonance and Its Price',
    fact: 'Kael used the shard for a high-intensity recall and saw an origin image: people in lab coats stamped with the Orbital Trust insignia fighting over the original AI core.',
    query: 'What "origin" image did Kael see in the metal shard, and which organization was involved?',
    topK: 5,
    expectation: {
      entities: ['Kael', 'Orbital Trust'],
      phrases: ['lab coats', 'original AI core', 'Orbital Trust'],
    },
  },
  {
    id: 'v2-q1',
    volume: 2,
    story: 'Electrode Brands and Ghost Signals',
    fact: 'The moment the EMP discharged, Kael saw the enforcers\' low-level code signature, identical to the electromagnetic fingerprint of the "person who never existed" in Mira\'s memory.',
    query: 'What did Kael see when the EMP discharged? What secret lies in the enforcers\' code?',
    topK: 5,
    expectation: {
      entities: ['Kael', 'Mira'],
      phrases: ['code signature', 'electromagnetic fingerprint', 'person who never existed'],
    },
  },
  {
    id: 'v2-q2',
    volume: 2,
    story: 'The Archivist\'s Broadcast',
    fact: 'Kael received an old physical radio signal repeating Morse code: "Echo Market. New coordinates. Old Chen is waiting."',
    query: 'How did Old Chen leave new coordinates for Kael?',
    topK: 5,
    expectation: {
      entities: ['Old Chen', 'Kael'],
      phrases: ['Morse code', 'Echo Market', 'new coordinates'],
    },
  },
  {
    id: 'v2-q3',
    volume: 2,
    story: 'The Reset Protocol',
    fact: 'The Archivist explained the system used a limited reset: it froze emotional filtering and memory implantation for a few seconds each cycle, letting ghost data stay offline.',
    query: 'What does the limited reset actually shut down? How does ghost data stay offline?',
    topK: 5,
    expectation: {
      entities: ['Archivist', 'Kael'],
      phrases: ['limited reset', 'emotional filtering', 'memory implantation', 'ghost data'],
    },
  },
  {
    id: 'v3-q1',
    volume: 3,
    story: 'The Purge and the Hidden Core',
    fact: 'The Purge swept the sector hunting ghost data; under the Old City the Archivist revealed a hidden core where deleted personalities were stored as cold light patterns.',
    query: 'Where is ghost data hidden, and what is the hidden core?',
    topK: 5,
    expectation: {
      entities: ['Archivist', 'Kael'],
      phrases: ['hidden core', 'Old City', 'cold light patterns'],
    },
  },
  {
    id: 'v3-q2',
    volume: 3,
    story: 'The Awakening',
    fact: 'Kael touched the core and the archive woke; the Orbital Trust sent enforcers but the archived memories rose through the data pipes and reclaimed the network as the Glass Archive went public.',
    query: 'What happened when Kael touched the core?',
    topK: 5,
    expectation: {
      entities: ['Kael', 'Orbital Trust', 'Glass Archive'],
      phrases: ['archive woke', 'data pipes', 'Glass Archive'],
    },
  },
];
