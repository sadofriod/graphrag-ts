/** 粗略 token 估算：中文约 1.8 字符/token，英文约 4 字符/token。 */
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
