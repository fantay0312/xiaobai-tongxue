import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const lock = JSON.parse(fs.readFileSync(new URL('./image-lock.json', import.meta.url)));
const stable = (value) => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
for (const [index, [name, expected]] of Object.entries(lock.images).entries()) {
  const reference = process.argv[index + 2] || expected.reference;
  const [image] = JSON.parse(execFileSync('docker', ['image', 'inspect', reference], { encoding: 'utf8' }));
  const c = image.Config;
  const identity = { layers: image.RootFS.Layers, os: image.Os, arch: image.Architecture,
    entrypoint: c.Entrypoint || [], cmd: c.Cmd || [], env: c.Env || [], user: c.User || '', workdir: c.WorkingDir || '', labels: c.Labels || {} };
  const hash = createHash('sha256').update(JSON.stringify(stable(identity))).digest('hex');
  if (hash !== expected.identitySha256 || `${image.Os}/${image.Architecture}` !== lock.platform
    || image.Config.Labels?.['org.opencontainers.image.revision'] !== lock.sourceCommit) {
    throw new Error(`Unexpected ${name} image; refusing deployment`);
  }
  console.log(`${name}: ${lock.version} ${image.Id} verified`);
}
