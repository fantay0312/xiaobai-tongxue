import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceDir = path.join(root, 'doc/qa-evidence/2026-07-30-star-sea');
const designQa = await readFile(path.join(root, 'design-qa.md'), 'utf8');
const section = designQa.split('## 2026-07-30 · 科举科名与单一学问星海')[1]
  ?.split('\n## ')[0] ?? '';

assert.ok(section, 'the star-sea QA section must remain present');
assert.doesNotMatch(section, /`\/(?:Users|tmp|var\/folders)\//, 'QA links must survive a fresh clone');

const linkTargets = [...section.matchAll(/\[[^\]]*]\(([^)\s]+)\)/g)]
  .map((match) => match[1]);
const expectedTargets = [
  'doc/qa-evidence/2026-07-30-star-sea/desktop.png',
  'doc/qa-evidence/2026-07-30-star-sea/mobile.png',
  'doc/qa-evidence/2026-07-30-star-sea/reference-comparison.jpg',
  'doc/qa-evidence/2026-07-30-star-sea/README.md',
];
for (const expected of expectedTargets) {
  assert.ok(linkTargets.includes(expected), `missing QA evidence link: ${expected}`);
}
for (const target of linkTargets) {
  assert.doesNotMatch(target, /^(?:[a-z][a-z\d+.-]*:|[/\\]|[a-z]:[/\\])/i, `absolute QA link: ${target}`);
  const resolved = path.resolve(root, target.split(/[?#]/, 1)[0]);
  const relative = path.relative(root, resolved);
  assert.ok(relative && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative), `QA link escapes repository: ${target}`);
  await access(resolved);
}

const manifest = await readFile(path.join(evidenceDir, 'sha256sum.txt'), 'utf8');
for (const line of manifest.trim().split('\n')) {
  const match = line.match(/^([a-f0-9]{64})  ([^/]+)$/);
  assert.ok(match, `invalid evidence manifest line: ${line}`);
  const content = await readFile(path.join(evidenceDir, match[2]));
  assert.equal(createHash('sha256').update(content).digest('hex'), match[1]);
}

console.log('star-sea QA evidence: ok');
