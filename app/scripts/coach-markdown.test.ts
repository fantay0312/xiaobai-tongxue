import assert from 'node:assert/strict';
import {
  isMarkdownTableBodyRow,
  isMarkdownTableStart,
  splitMarkdownTableRow,
} from '../src/components/coach/markdownTable';
import { markdownToPlainText } from '../src/components/coach/coachMarkdownText';

assert.deepEqual(
  splitMarkdownTableRow('| expression | a \\| b |'),
  ['expression', 'a | b'],
  'escaped pipes must stay inside their table cell',
);
assert.deepEqual(
  splitMarkdownTableRow('| path | C:\\\\ | next |'),
  ['path', 'C:\\\\', 'next'],
  'an even backslash run must not escape a column boundary',
);
assert.deepEqual(
  splitMarkdownTableRow(String.raw`| odd | a \\\| b |`),
  ['odd', String.raw`a \\| b`],
  'an odd backslash run must consume only the pipe-escaping backslash',
);
assert.deepEqual(
  splitMarkdownTableRow('| first || third |'),
  ['first', '', 'third'],
  'empty cells must be preserved while outer delimiters are removed',
);
assert.deepEqual(
  splitMarkdownTableRow('| :--- | ---: |'),
  [':---', '---:'],
  'alignment divider cells must retain their Markdown syntax',
);
assert.equal(
  isMarkdownTableStart('| h1 \\| h2 |', '| --- | --- |'),
  false,
  'a header and divider with different parsed column counts must not start a table',
);
assert.equal(
  isMarkdownTableStart('| h1 | h2 |', '| --- | ---: |'),
  true,
  'matching header and divider columns must start a table',
);
assert.equal(
  isMarkdownTableBodyRow('Use a \\| b'),
  false,
  'an escaped-only pipe after a table must remain ordinary paragraph text',
);
assert.equal(
  isMarkdownTableBodyRow('| a \\| b | c |'),
  true,
  'outer unescaped pipes must keep a table body row active',
);
assert.equal(
  markdownToPlainText('[documentation](https://example.com/a_(nested))'),
  'documentation',
  'links containing a parenthesized URL segment must retain their label',
);
const malformedLink = `[label](${'a'.repeat(10_000)}`;
assert.equal(
  markdownToPlainText(malformedLink),
  malformedLink,
  'a long link missing its closing parenthesis must remain plain text',
);

console.log('coach markdown table parsing: ok');
