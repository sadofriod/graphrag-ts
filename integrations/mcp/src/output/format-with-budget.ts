export const formatWithBudget = <Detail>(
  answer: string,
  initialDetails: readonly Detail[],
  initiallyTruncated: boolean,
  maxChars: number,
  serialize: (answer: string, details: readonly Detail[], truncated: boolean) => string,
): string => {
  let details = initialDetails;
  let truncated = initiallyTruncated;

  while (details.length > 0 && serialize(answer, details, truncated).length > maxChars) {
    details = details.slice(0, -1);
    truncated = true;
  }

  const full = serialize(answer, details, truncated);
  if (full.length <= maxChars) {
    return full;
  }

  truncated = true;
  const characters = Array.from(answer);
  let lower = 0;
  let upper = characters.length;
  while (lower < upper) {
    const count = Math.ceil((lower + upper) / 2);
    const candidate = `${characters.slice(0, count).join('')}...`;
    if (serialize(candidate, details, truncated).length <= maxChars) {
      lower = count;
    } else {
      upper = count - 1;
    }
  }

  const shortenedAnswer = lower === 0 ? '' : `${characters.slice(0, lower).join('')}...`;
  return serialize(shortenedAnswer, details, truncated);
};