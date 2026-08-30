export interface RRFRankedItem<T> {
  item: T;
  score: number;
}

export function reciprocalRankFusion<T>(
  rankedLists: readonly (readonly T[])[],
  getId: (item: T) => string,
  k = 60,
): RRFRankedItem<T>[] {
  const scoreMap = new Map<string, RRFRankedItem<T>>();

  for (const list of rankedLists) {
    for (const [index, item] of list.entries()) {
      const id = getId(item);
      const rrfScore = 1 / (k + index + 1);
      const current = scoreMap.get(id);

      if (current) {
        current.score += rrfScore;
      } else {
        scoreMap.set(id, { item, score: rrfScore });
      }
    }
  }

  return Array.from(scoreMap.values()).sort((a, b) => b.score - a.score);
}
