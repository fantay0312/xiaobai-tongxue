const TABLE_DIVIDER_CELL = /^:?-{3,}:?$/;

function hasUnescapedTablePipe(line: string): boolean {
  let trailingBackslashes = 0;
  for (const character of line) {
    if (character === '|') {
      if (trailingBackslashes % 2 === 0) return true;
      trailingBackslashes = 0;
      continue;
    }
    trailingBackslashes = character === '\\' ? trailingBackslashes + 1 : 0;
  }
  return false;
}

/** Split a Markdown table row without treating an escaped pipe as a column boundary. */
export function splitMarkdownTableRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let trailingBackslashes = 0;
  for (const character of line.trim()) {
    if (character !== '|') {
      cell += character;
      trailingBackslashes = character === '\\' ? trailingBackslashes + 1 : 0;
      continue;
    }
    if (trailingBackslashes % 2 === 1) {
      cell = `${cell.slice(0, -1)}|`;
      trailingBackslashes = 0;
      continue;
    }
    cells.push(cell.trim());
    cell = '';
    trailingBackslashes = 0;
  }
  cells.push(cell.trim());
  if (cells[0] === '') cells.shift();
  if (cells.at(-1) === '') cells.pop();
  return cells;
}

export function isMarkdownTableStart(headerLine: string, dividerLine: string): boolean {
  if (!hasUnescapedTablePipe(headerLine)) return false;
  const headers = splitMarkdownTableRow(headerLine);
  const divider = splitMarkdownTableRow(dividerLine);
  return headers.length > 0
    && headers.length === divider.length
    && divider.every((cell) => TABLE_DIVIDER_CELL.test(cell));
}

export function isMarkdownTableBodyRow(line: string): boolean {
  return Boolean(line.trim()) && hasUnescapedTablePipe(line);
}
