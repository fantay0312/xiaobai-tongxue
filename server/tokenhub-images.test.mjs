import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenhubImages, DEFAULT_TOKENHUB_IMAGE } from './reader/tokenhub-images.mjs';
import { createReaderMedia } from './reader/media.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXwsAAAAASUVORK5CYII=', 'base64');
const env = { READER_TOKENHUB_API_KEY: 'test-tokenhub-key' };

test('Seedream uses its documented endpoint and returns decoded image bytes', async () => {
  let call;
  const service = createTokenhubImages({ env, fetchImpl: async (url, init) => {
    call = { url, ...init, payload: JSON.parse(init.body) };
    return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  } });
  const image = await service.cover({ prompt: 'An open book, two-colour print.' });
  assert.equal(call.url, 'https://tokenhub.tencentmaas.com/v1/wand/si-image/generation');
  assert.equal(call.headers.Authorization, 'Bearer test-tokenhub-key');
  assert.equal(call.payload.model, 'seedream-image-v5.0-pro');
  assert.equal(call.payload.size, '1024x1024');
  assert.equal(call.payload.response_format, 'b64_json');
  assert.equal(call.redirect, 'error');
  assert.equal(image.mime, 'image/png');
  assert.deepEqual(image.bytes, png);
  assert.equal(image.model, DEFAULT_TOKENHUB_IMAGE);
});

test('HY uses the final image delta and downloads pixels without forwarding the key', async () => {
  let call, download;
  const service = createTokenhubImages({ env, fetchImpl: async (url, init) => {
    call = { url, payload: JSON.parse(init.body) };
    return Response.json({ choices: [{ delta: { type: 'image', image: { url: 'https://aigc-output-image-1326893053.cos.ap-guangzhou.myqcloud.com/cover.png?signature=test' } }, finish_reason: null }] });
  }, downloadImpl: async (url, options) => { download = { url, options }; return { bytes: png }; } });
  const image = await service.cover({ model: 'tokenhub:hy-image-v3.5-preview', prompt: 'An open book.' });
  assert.equal(call.url, 'https://tokenhub.tencentmaas.com/v1/wand/hunyuan-image/v35-generation');
  assert.equal(call.payload.messages[0].content[0].text, 'An open book.');
  assert.deepEqual(call.payload.use_search_tool, { value: false });
  assert.equal(download.options.headers, undefined);
  assert.ok(download.options.signal);
  assert.equal(image.mime, 'image/png');
});

test('untrusted download URLs, unknown models and cancelled requests fail before further work', async () => {
  let calls = 0, downloads = 0;
  const service = createTokenhubImages({ env, fetchImpl: async () => { calls++; return Response.json({ choices: [{ delta: { image: { url: 'http://127.0.0.1/private' } } }] }); }, downloadImpl: async () => { downloads++; return { bytes: png }; } });
  await assert.rejects(service.cover({ model: 'made-up', prompt: 'test' }), /请选择/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.cover({ prompt: 'test', signal: controller.signal }), /abort/i);
  assert.equal(calls, 0);
  await assert.rejects(service.cover({ model: 'hy-image-v3.5-preview', prompt: 'test' }));
  assert.equal(downloads, 0);
});

test('provider errors are surfaced without echoing credentials or raw upstream messages', async () => {
  const service = createTokenhubImages({ env, fetchImpl: async () => Response.json({ error: { code: 'Forbidden', message: 'test-tokenhub-key was denied' } }, { status: 403 }) });
  await assert.rejects(service.cover({ prompt: 'test' }), (e) => e.status === 503 && !e.message.includes('test-tokenhub-key'));
});

test('the built-in downloader only receives image headers and refuses redirect following', async () => {
  let downloaded = false;
  const service = createTokenhubImages({ env, fetchImpl: async (url, init) => {
    if (url.startsWith('https://tokenhub.tencentmaas.com/')) return Response.json({ choices: [{ delta: { image: { url: 'https://aigc-output-image-1326893053.cos.ap-guangzhou.myqcloud.com/cover.png?signed=yes' } } }] });
    downloaded = true;
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.redirect, 'error');
    assert.match(init.headers.Accept, /image\/png/);
    return new Response(png);
  } });
  assert.deepEqual((await service.cover({ model: 'hy-image-v3.5-preview', prompt: 'An open book.' })).bytes, png);
  assert.equal(downloaded, true);
});

test('configured TokenHub exposes exactly the two image models and replaces legacy defaults', async () => {
  const media = createReaderMedia({ env, cfg: { asrUpstreamUrl: 'https://openrouter.ai/api/v1', asrApiKey: 'unrelated-key' }, fetchImpl: async (url) => {
    if (url.startsWith('http://127.0.0.1')) return Response.json({ voices: [] });
    return Response.json({ data: [] });
  } });
  const catalog = await media.catalog();
  assert.equal(catalog.defaultImage, DEFAULT_TOKENHUB_IMAGE);
  assert.deepEqual(catalog.images.map((m) => m.label), ['Seedream 5.0 Pro', 'HY-Image-3.5']);
});
