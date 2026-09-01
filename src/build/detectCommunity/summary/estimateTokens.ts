/** Rough token estimate: about 1 token per 1.8 Chinese characters and per 4 English characters. */
export const estimateTokens = (text: string): number => {
  if (text.length === 0) {
    return 0;
  }

  let cjkChars = 0;
  let asciiChars = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) {
      asciiChars += 1;
    } else {
      cjkChars += 1;
    }
  }

  return Math.ceil(cjkChars / 1.8 + asciiChars / 4);
};
