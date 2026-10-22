import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const assets = path.join(root, 'assets');
const files = new Map(readdirSync(assets).filter((name) => name.endsWith('.js')).map((name) => [name, readFileSync(path.join(assets, name), 'utf8')]));
function closure(seeds: string[]) {
  const seen = new Set<string>();
  const pending = [...seeds];
  while (pending.length) {
    const name = pending.pop()!;
    if (seen.has(name) || !files.has(name)) continue;
    seen.add(name);
    pending.push(...Array.from(files.get(name)!.matchAll(/(?:from\s*|import\s*)["']\.\/([^"']+\.js)["']/g), (m) => m[1]));
  }
  return [...seen];
}
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const entry = closure(Array.from(html.matchAll(/(?:src|href)="\/assets\/([^"\s]+\.js)"/g), (m) => m[1]));
const reader = closure([...files.keys()].filter((name) => name.startsWith('ReadingTerminal-')));
assert.ok(entry.length > 0 && reader.length > 0, 'build both app entry and lightweight reader before this check');
for (const names of [entry, reader]) {
  assert.ok(!names.some((name) => /^(topics|appStore|scheduler|diagrams|learn)-/.test(name)), `heavy learning code leaked into lightweight entry: ${names}`);
}
const bytes = (names: string[]) => names.reduce((sum, name) => sum + Buffer.byteLength(files.get(name)!), 0);
assert.ok(bytes(entry) < 800_000, `initial JS exceeds 800 KB: ${bytes(entry)}`);
assert.ok(bytes(reader) < 850_000, `reader shell JS exceeds 850 KB: ${bytes(reader)}`);
console.log(JSON.stringify({ entryBytes: bytes(entry), readingShellBytes: bytes(reader), heavyLearningCode: false }));
