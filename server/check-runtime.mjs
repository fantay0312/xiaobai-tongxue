import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

async function moduleFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await moduleFiles(path.join(directory, entry.name), relative));
    } else if (entry.name.endsWith('.mjs') && !entry.name.includes('.test.')) {
      files.push(relative);
    }
  }
  return files;
}

const files = (await moduleFiles(here)).sort();

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: here, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
