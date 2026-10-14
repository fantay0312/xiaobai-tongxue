import assert from 'node:assert/strict';
import test from 'node:test';
import { splitTencentText, tencentVoice } from './reader/tencent-voice.mjs';
import { createReaderMedia } from './reader/media.mjs';
import { TENCENT_DEFAULT_VOICE } from './reader/tencent-voices.mjs';

const env = { READER_TENCENT_TTS_ENABLED: '1', TENCENT_ASR_SECRET_ID: 'test-id', TENCENT_ASR_SECRET_KEY: 'test-secret' };
const pcmResponse = () => new Response(JSON.stringify({ Response: { Audio: Buffer.from([1, 0, 2, 0]).toString('base64') } }));

test('mixed-language chunks keep every character and stay under the Chinese limit', () => {
  const text = 'English words before Chinese. '.repeat(8) + '这是一段需要完整保留的中文。'.repeat(20);
  const parts = splitTencentText(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every((p) => Array.from(p).length <= 130));
  assert.ok(splitTencentText('a'.repeat(900)).every((p) => p.length <= 450));
});

test('chosen voice and credentials go only to Tencent and returned PCM is a valid combined WAV', async () => {
  const requests = [];
  const output = await tencentVoice('阅读'.repeat(100), 501000, env, undefined, async (url, init) => {
    requests.push({ url, ...JSON.parse(init.body) });
    assert.match(init.headers.Authorization, /Credential=test-id\//);
    return pcmResponse();
  });
  assert.ok(requests.length > 1);
  assert.ok(requests.every((r) => r.url === 'https://tts.tencentcloudapi.com/' && r.VoiceType === 501000 && r.Codec === 'pcm'));
  assert.equal(requests.map((r) => r.Text).join(''), '阅读'.repeat(100));
  assert.equal(output.bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(output.bytes.readUInt32LE(40), requests.length * 4);
  assert.equal(output.voice, '501000');
});

test('Tencent default does not depend on optional image providers or accept arbitrary voice IDs', async () => {
  let posts = 0;
  const media = createReaderMedia({ env, cfg: { asrUpstreamUrl: 'https://openrouter.ai/api/v1', asrApiKey: 'media-key' }, fetchImpl: async (url, init) => {
    if (url === 'https://tts.tencentcloudapi.com/') { posts++; return pcmResponse(); }
    throw new Error('optional provider unavailable');
  } });
  const catalog = await media.catalog();
  assert.equal(catalog.defaultSpeech, 'tencent-tts');
  assert.equal(catalog.speech[0].defaultVoice, TENCENT_DEFAULT_VOICE);
  const audio = await media.speech({ text: '开始阅读。' });
  assert.equal(audio.voice, TENCENT_DEFAULT_VOICE);
  await assert.rejects(media.speech({ text: '开始阅读。', model: 'tencent-tts', voice: '999999' }), /音色无效/);
  assert.equal(posts, 1);
  const legacy = await media.speech({ text: '开始阅读。', model: 'tencent-tts:101001' });
  assert.equal(legacy.voice, '101001');
  assert.equal((await media.speech({ text: '开始阅读。', voice: 'nova' })).voice, TENCENT_DEFAULT_VOICE);
});

test('disabled service and cancelled synthesis do not contact upstream', async () => {
  let calls = 0;
  const media = createReaderMedia({ env: {}, fetchImpl: async () => { calls++; return pcmResponse(); } });
  await assert.rejects(media.speech({ text: '阅读', model: 'tencent-tts' }), /尚未启用/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(tencentVoice('阅读', 101001, env, controller.signal, async () => { calls++; return pcmResponse(); }), /abort/i);
  assert.equal(calls, 0);
});
