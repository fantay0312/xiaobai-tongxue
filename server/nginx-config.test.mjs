import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('nginx does not trust the viewer-controlled client IP header', async () => {
  const config = await readFile(new URL('./xiaobai.nginx.conf', import.meta.url), 'utf8');

  assert.doesNotMatch(config, /\$http_x_xiaobai_client_ip/i);
  assert.match(config, /proxy_set_header\s+X-Real-IP\s+\$remote_addr\s*;/);
  assert.match(config, /proxy_set_header\s+X-Forwarded-For\s+\$remote_addr\s*;/);
});
