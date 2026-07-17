import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = (await readdir(here))
  .filter((file) => file.endsWith('.mjs') && !file.includes('.test'))
  .sort();

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: here, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
