export interface SplitMessageOptions {
  maxLength?: number;
  prepend?: string;
  append?: string;
}

const TRUNCATION_MARKER = "\n\n*[code truncated]*";
const CODE_BLOCK_CLOSE = "```";

export function splitMessage(
  content: string,
  options: SplitMessageOptions = {},
): string[] {
  const maxLength = options.maxLength ?? 2000;
  const prepend = options.prepend ?? "";
  const append = options.append ?? "";

  if (content.length <= maxLength) {
    return [content];
  }

  return splitRecursive(content, [], maxLength, prepend, append);
}

function splitRecursive(
  remaining: string,
  chunks: string[],
  maxLength: number,
  prepend: string,
  append: string,
): string[] {
  if (remaining.length === 0) {
    return chunks;
  }

  const extraLength = TRUNCATION_MARKER.length + CODE_BLOCK_CLOSE.length;
  const availableLength =
    maxLength - prepend.length - append.length - extraLength;

  if (availableLength <= 0) {
    throw new Error("Prepend and append strings exceed max length");
  }

  if (remaining.length <= availableLength) {
    return [...chunks, `${prepend}${remaining}${append}`];
  }

  const { splitIndex, truncated, codeBlockEnd } = findSplitIndex(
    remaining,
    availableLength,
  );

  const chunk = remaining.slice(0, splitIndex);

  const chunkWithTruncation = truncated
    ? chunk + CODE_BLOCK_CLOSE + TRUNCATION_MARKER
    : chunk;

  const newChunks = [...chunks, `${prepend}${chunkWithTruncation}${append}`];

  const nextRemaining =
    truncated && codeBlockEnd > 0
      ? remaining.slice(codeBlockEnd).trim()
      : remaining.slice(splitIndex).trim();

  return splitRecursive(nextRemaining, newChunks, maxLength, prepend, append);
}

function findSplitIndex(
  text: string,
  maxLength: number,
): { splitIndex: number; truncated: boolean; codeBlockEnd: number } {
  const codeBlocks = scanCodeBlocks(text);
  const inlineCodes = scanInlineCodes(text);

  function isInCode(index: number): boolean {
    return (
      codeBlocks.some((block) => index >= block.start && index < block.end) ||
      inlineCodes.some((code) => index >= code.start && index < code.end)
    );
  }

  function isInCodeBlock(index: number): boolean {
    return codeBlocks.some(
      (block) => index >= block.start && index < block.end,
    );
  }

  function getCodeBlockEnd(index: number): number {
    const block = codeBlocks.find((b) => index >= b.start && index < b.end);
    return block ? block.end : -1;
  }

  const searchStart = Math.min(maxLength, text.length);
  const indices = Array.from(
    { length: searchStart },
    (_, i) => searchStart - 1 - i,
  );

  const newlineSplit = indices.find(
    (i) => !isInCode(i) && text[i] === "\n" && i > 0,
  );
  if (newlineSplit !== undefined) {
    return { splitIndex: newlineSplit + 1, truncated: false, codeBlockEnd: -1 };
  }

  const spaceSplit = indices.find(
    (i) => !isInCode(i) && text[i] === " " && i > 0,
  );
  if (spaceSplit !== undefined) {
    return { splitIndex: spaceSplit + 1, truncated: false, codeBlockEnd: -1 };
  }

  if (isInCodeBlock(searchStart - 1)) {
    const codeBlockEnd = getCodeBlockEnd(searchStart - 1);
    return { splitIndex: searchStart, truncated: true, codeBlockEnd };
  }

  return { splitIndex: maxLength, truncated: false, codeBlockEnd: -1 };
}

function scanCodeBlocks(text: string): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
  let i = 0;

  while (i < text.length) {
    if (text.slice(i, i + 3) === "```") {
      const start = i;
      i += 3;
      while (i < text.length && !(text.slice(i, i + 3) === "```")) {
        i++;
      }
      if (i < text.length) {
        blocks.push({ start, end: i + 3 });
        i += 3;
      }
    } else {
      i++;
    }
  }

  return blocks;
}

function scanInlineCodes(text: string): Array<{ start: number; end: number }> {
  const codes: Array<{ start: number; end: number }> = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === "`" && text.slice(i, i + 3) !== "```") {
      const start = i;
      i++;
      while (i < text.length && text[i] !== "`") {
        i++;
      }
      if (i < text.length) {
        codes.push({ start, end: i + 1 });
        i++;
      }
    } else {
      i++;
    }
  }

  return codes;
}
