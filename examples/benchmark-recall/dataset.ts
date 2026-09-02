import type { RecallQuery } from './types';

// Keep the benchmark aligned to the sources that actually exist in the current
// GraphRAG namespace so the evaluation reflects the real database state.
export const RECALL_QUERIES: readonly RecallQuery[] = [
  {
    id: 'alice-rabbit-hole',
    source: "Alice's Adventures in Wonderland",
    focus: 'rabbit-hole opening scene',
    query: 'What did Alice notice about the White Rabbit before following it down the rabbit-hole?',
    topK: 6,
    expectation: {
      entities: ['Alice', 'White Rabbit'],
      phrases: ['waistcoat-pocket', 'ORANGE MARMALADE', 'large rabbit-hole'],
    },
  },
  {
    id: 'alice-mad-tea-party',
    source: "Alice's Adventures in Wonderland",
    focus: 'Mad Tea-Party',
    query: 'At the Mad Tea-Party, who asks the raven riddle and why is it always tea-time?',
    topK: 6,
    expectation: {
      entities: ['Alice', 'Hatter', 'March Hare', 'Dormouse'],
      phrases: ['raven like a writing-desk', "it's always tea-time", 'murdering the time'],
    },
  },
  {
    id: 'alice-dormouse-tale',
    source: "Alice's Adventures in Wonderland",
    focus: 'Dormouse story',
    query: 'What story does the Dormouse tell while Alice is at the tea-party?',
    topK: 6,
    expectation: {
      entities: ['Alice', 'Dormouse', 'March Hare', 'Hatter'],
      phrases: ['three little sisters', 'sister, and a good deal of tea'],
    },
  },
  {
    id: 'alice-caterpillar-advice',
    source: "Alice's Adventures in Wonderland",
    focus: 'Caterpillar scene',
    query: 'What advice does the Caterpillar give Alice about her size and identity?',
    topK: 6,
    expectation: {
      entities: ['Alice', 'Caterpillar'],
      phrases: ['you are old enough to know your own mind', 'size that you are'],
    },
  },
  {
    id: 'frankenstein-creation',
    source: 'Frankenstein',
    focus: 'creation scene',
    query: 'What happens on the dreary night of November when Victor completes his experiment?',
    topK: 6,
    expectation: {
      entities: ['Victor Frankenstein', 'Elizabeth', 'Henry Clerval'],
      phrases: ['dreary night of November', 'dull yellow eye', 'lifeless thing'],
    },
  },
  {
    id: 'frankenstein-de-lacey',
    source: 'Frankenstein',
    focus: 'De Lacey cottage narrative',
    query: 'What does the creature learn while hiding near the De Lacey family cottage?',
    topK: 6,
    expectation: {
      entities: ['De Lacey', 'Agatha', 'Felix', 'Safie'],
      phrases: ['articulate sounds', 'fire, milk, bread, and wood', 'Volney'],
    },
  },
  {
    id: 'frankenstein-justine',
    source: 'Frankenstein',
    focus: 'Justine trial',
    query: 'How does Victor react when Justine is accused and condemned for William’s murder?',
    topK: 6,
    expectation: {
      entities: ['Victor Frankenstein', 'Justine', 'William'],
      phrases: ['sudden darkness', 'the innocence of Justine'],
    },
  },
  {
    id: 'frankenstein-mont-blanc',
    source: 'Frankenstein',
    focus: 'Mont Blanc journey',
    query: 'What emotional state does Victor describe on his journey through the Alps and to Mont Blanc?',
    topK: 6,
    expectation: {
      entities: ['Victor Frankenstein', 'Mont Blanc'],
      phrases: ['mighty Alps', 'wretchedness and despair'],
    },
  },
  {
    id: 'alice-queen-of-hearts',
    source: "Alice's Adventures in Wonderland",
    focus: 'Queen of Hearts trial',
    query: 'How does Alice respond when the Queen of Hearts demands an execution and accuses everyone in the court?',
    topK: 6,
    expectation: {
      entities: ['Alice', 'Queen of Hearts', 'King of Hearts'],
      phrases: ['off with their heads', 'trial of the Knave'],
    },
  },
  {
    id: 'alice-caterpillar-identity',
    source: "Alice's Adventures in Wonderland",
    focus: 'Caterpillar identity scene',
    query: 'What does the Caterpillar say about Alice being a little girl or a grown-up and why does that matter?',
    topK: 6,
    expectation: {
      entities: ['Alice', 'Caterpillar'],
      phrases: ['you are old enough to know your own mind', 'size that you are'],
    },
  },
  {
    id: 'frankenstein-female-companion',
    source: 'Frankenstein',
    focus: 'creature requests a companion',
    query: 'What does the creature demand from Victor before he can be at peace, and why is it so important to him?',
    topK: 6,
    expectation: {
      entities: ['Victor Frankenstein', 'Creature', 'Elizabeth'],
      phrases: ['female companion', 'my feelings will find a place'],
    },
  },
  {
    id: 'frankenstein-arctic-confession',
    source: 'Frankenstein',
    focus: 'Walton conversation',
    query: 'What does Victor confess to Walton about his obsession and the cost of his creation?',
    topK: 6,
    expectation: {
      entities: ['Victor Frankenstein', 'Walton', 'Creature'],
      phrases: ['wretchedness and despair', 'burden of knowledge'],
    },
  },
];
