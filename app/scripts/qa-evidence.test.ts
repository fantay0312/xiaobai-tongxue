import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceDir = path.join(root, 'doc/qa-evidence/2026-07-30-star-sea');
const designQa = await readFile(path.join(root, 'design-qa.md'), 'utf8');
const section = designQa.split('## 2026-07-30 · 科举科名与单一学问星海')[1]
  ?.split('\n## ')[0] ?? '';

assert.ok(section, 'the star-sea QA section must remain present');
assert.doesNotMatch(section, /`\/(?:Users|tmp|var\/folders)\//, 'QA links must survive a fresh clone');

const manifest = await readFile(path.join(evidenceDir, 'sha256sum.txt'), 'utf8');
for (const line of manifest.trim().split('\n')) {
  const match = line.match(/^([a-f0-9]{64})  ([^/]+)$/);
  assert.ok(match, `invalid evidence manifest line: ${line}`);
  const content = await readFile(path.join(evidenceDir, match[2]));
  assert.equal(createHash('sha256').update(content).digest('hex'), match[1]);
}

console.log('star-sea QA evidence: ok');
