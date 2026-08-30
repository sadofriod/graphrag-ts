const tokenize = (text: string): Set<string> => {
  const tokens = text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g) ?? [];
  return new Set(tokens);
};

export function similarity(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);

  if (left.size === 0 && right.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  if (union === 0) {
    return 0;
  }

  return intersection / union;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error('Vectors must have the same length');
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let i = 0; i < left.length; i++) {
    const leftValue = left[i] ?? 0;
    const rightValue = right[i] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}
