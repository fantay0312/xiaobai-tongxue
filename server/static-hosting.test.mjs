import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStaticHandler } from './static-hosting.mjs';

function response() {
  return {
    status: null,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

function directiveSources(csp, name) {
  const directive = csp.split(';')
    .map((value) => value.trim())
    .find((value) => value === name || value.startsWith(`${name} `));
  assert.ok(directive, `missing ${name} directive`);
  return directive.split(/\s+/).slice(1);
}

test('main and admin SPAs have isolated fallbacks and cache policies', async (context) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'xiaobai-static-'));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const mainDist = path.join(temporary, 'main');
  const adminDist = path.join(temporary, 'admin');
  await Promise.all([
    mkdir(path.join(mainDist, 'assets'), { recursive: true }),
    mkdir(path.join(adminDist, 'assets'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(mainDist, 'index.html'), '<main>Main SPA</main>'),
    writeFile(path.join(adminDist, 'index.html'), '<main>Admin SPA</main>'),
    writeFile(path.join(adminDist, 'assets', 'admin.js'), 'export default 1'),
  ]);
  const send = (res, status, body) => {
    res.writeHead(status, { 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const handle = createStaticHandler({
    mainDist,
    adminDist,
    prefix: '/xiaobai',
    send,
  });

  const redirect = response();
  handle({ method: 'GET' }, redirect, '/admin');
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.Location, '/xiaobai/admin/');

  const admin = response();
  handle({ method: 'GET' }, admin, '/admin/operators/123');
  assert.equal(admin.status, 200);
  assert.equal(admin.headers['Cache-Control'], 'no-cache');
  assert.match(admin.headers['Content-Security-Policy'], /script-src 'self';/);
  assert.doesNotMatch(admin.headers['Content-Security-Policy'], /captcha|https:/);
  assert.equal(admin.headers['Referrer-Policy'], 'no-referrer');
  assert.match(admin.headers['Permissions-Policy'], /microphone=\(\)/);
  assert.equal(admin.body.toString(), '<main>Admin SPA</main>');

  const asset = response();
  handle({ method: 'GET' }, asset, '/admin/assets/admin.js');
  assert.equal(asset.status, 200);
  assert.equal(
    asset.headers['Cache-Control'],
    'public, max-age=31536000, immutable',
  );

  const missingAsset = response();
  handle({ method: 'GET' }, missingAsset, '/admin/assets/missing.js');
  assert.equal(missingAsset.status, 404);

  const main = response();
  handle({ method: 'GET' }, main, '/');
  assert.equal(main.status, 200);
  const mainCsp = main.headers['Content-Security-Policy'];
  assert.deepEqual(directiveSources(mainCsp, 'script-src'), [
    "'self'",
    'https://turing.captcha.qcloud.com',
    'https://turing.captcha.gtimg.com',
    'https://cloudcache.tencentcs.com',
    "'unsafe-eval'",
  ]);
  assert.deepEqual(directiveSources(mainCsp, 'style-src'), [
    "'self'", "'unsafe-inline'",
    'https://turing.captcha.qcloud.com',
    'https://turing.captcha.gtimg.com',
  ]);
  assert.deepEqual(directiveSources(mainCsp, 'img-src'), [
    "'self'", 'data:', 'blob:',
    'https://turing.captcha.qcloud.com',
    'https://turing.captcha.gtimg.com',
  ]);
  assert.deepEqual(directiveSources(mainCsp, 'frame-src'), [
    'https://turing.captcha.qcloud.com',
  ]);
  assert.deepEqual(directiveSources(mainCsp, 'media-src'), [
    "'self'", 'blob:',
    'https://turing.captcha.qcloud.com',
    'https://turing.captcha.gtimg.com',
  ]);
  assert.deepEqual(directiveSources(mainCsp, 'connect-src'), ["'self'", 'https:']);
  assert.match(main.headers['Permissions-Policy'], /microphone=\(self\)/);
  assert.equal(main.body.toString(), '<main>Main SPA</main>');
});

test('themed index boots inline without opening script-src, and audio keeps its media type', async (context) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'xiaobai-static-theme-'));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const mainDist = path.join(temporary, 'main');
  const adminDist = path.join(temporary, 'admin');
  await Promise.all([
    mkdir(path.join(mainDist, 'sounds'), { recursive: true }),
    mkdir(adminDist, { recursive: true }),
  ]);
  /* 与 app/index.html 同形:首屏绘制前恢复 <html data-theme>,不能靠外链脚本。 */
  const boot = "\n  document.documentElement.dataset.theme = 'anime';\n";
  await Promise.all([
    writeFile(
      path.join(mainDist, 'index.html'),
      `<!doctype html><html data-theme="paper"><head><script>${boot}</script>`
      + '<script type="module" crossorigin src="/assets/index.js"></script>'
      + '</head><body></body></html>',
    ),
    writeFile(path.join(mainDist, 'sounds', 'bgm.mp3'), 'ID3-not-really'),
    writeFile(path.join(adminDist, 'index.html'), '<main>Admin SPA</main>'),
  ]);
  const handle = createStaticHandler({
    mainDist,
    adminDist,
    send: (res, status, body) => {
      res.writeHead(status, {});
      res.end(body);
    },
  });

  const index = response();
  handle({ method: 'GET' }, index, '/');
  const scriptSrc = directiveSources(index.headers['Content-Security-Policy'], 'script-src');
  const expected = `'sha256-${createHash('sha256').update(boot, 'utf8').digest('base64')}'`;
  assert.ok(scriptSrc.includes(expected), '内联启动脚本必须按内容哈希放行');
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), "script-src 永不开 'unsafe-inline'");
  /* 外链 <script src> 由 'self' 覆盖,不该多算一个哈希。 */
  assert.equal(scriptSrc.filter((source) => source.startsWith("'sha256-")).length, 1);

  const audio = response();
  handle({ method: 'GET' }, audio, '/sounds/bgm.mp3');
  assert.equal(audio.status, 200);
  assert.equal(audio.headers['Content-Type'], 'audio/mpeg');
  assert.equal(audio.headers['X-Content-Type-Options'], 'nosniff');

  /* 后台产物没有内联脚本时,其 script-src 必须仍是最紧的 'self'。 */
  const admin = response();
  handle({ method: 'GET' }, admin, '/admin/');
  assert.deepEqual(
    directiveSources(admin.headers['Content-Security-Policy'], 'script-src'),
    ["'self'"],
  );
});

test('decoded traversal cannot leave either distribution root', async (context) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'xiaobai-static-traversal-'));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const mainDist = path.join(temporary, 'main');
  const adminDist = path.join(temporary, 'admin');
  await Promise.all([
    mkdir(mainDist, { recursive: true }),
    mkdir(adminDist, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(temporary, 'secret.txt'), 'secret'),
    writeFile(path.join(mainDist, 'index.html'), 'main'),
    writeFile(path.join(adminDist, 'index.html'), 'admin'),
  ]);
  const handle = createStaticHandler({
    mainDist,
    adminDist,
    send: (res, status, body) => {
      res.writeHead(status, {});
      res.end(body);
    },
  });
  const res = response();
  handle({ method: 'GET' }, res, '/admin/%2e%2e/secret.txt');
  assert.equal(res.status, 403);
  assert.notEqual(String(res.body), 'secret');
});
