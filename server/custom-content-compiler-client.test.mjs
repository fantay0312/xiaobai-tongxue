import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPILER_REASONING_EFFORT, createJsonLlmClient } from './custom-content/topic-compiler.mjs';

const silent = { error() {} };

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function reply(content, finish = 'stop') {
  return jsonResponse(200, { choices: [{ finish_reason: finish, message: { content } }] });
}

function client(fetchImpl, extra = {}) {
  return createJsonLlmClient({
    baseUrl: 'https://upstream.example/v1',
    apiKey: 'k',
    model: 'reasoning-model',
    fetchImpl,
    logger: silent,
    ...extra,
  });
}

test('默认带思考预算与 JSON 模式,一次成功不重试', async () => {
  const bodies = [];
  const llm = client(async (url, init) => {
    bodies.push({ url, body: JSON.parse(init.body) });
    return reply('{"title":"x"}');
  });
  const out = await llm.generate({ system: 's', user: 'u', requestId: 'r1' });
  assert.equal(out, '{"title":"x"}');
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].url, 'https://upstream.example/v1/chat/completions');
  assert.equal(bodies[0].body.reasoning_effort, COMPILER_REASONING_EFFORT);
  assert.deepEqual(bodies[0].body.response_format, { type: 'json_object' });
  assert.equal(bodies[0].body.max_tokens, 16_000);
});

test('finish=length 的断尾正文 → 关思考重发;仍截断 → compiler-truncated', async () => {
  const efforts = [];
  const llm = client(async (url, init) => {
    efforts.push(JSON.parse(init.body).reasoning_effort ?? null);
    return efforts.length === 1 ? reply('{"title":"半截', 'length') : reply('{"title":"完整"}');
  });
  assert.equal(await llm.generate({ system: 's', user: 'u' }), '{"title":"完整"}');
  assert.deepEqual(efforts, ['low', 'none']);

  const alwaysCut = client(async () => reply('{"title":"半截', 'length'));
  await assert.rejects(alwaysCut.generate({ system: 's', user: 'u' }), (error) => {
    assert.equal(String(error.message).split(':', 1)[0], 'compiler-truncated');
    return true;
  });
});

test('思考吃光 max_tokens 正文为空 → 关思考重发一次', async () => {
  const efforts = [];
  const llm = client(async (url, init) => {
    const body = JSON.parse(init.body);
    efforts.push(body.reasoning_effort ?? null);
    return efforts.length === 1 ? reply('', 'length') : reply('{"ok":true}');
  });
  assert.equal(await llm.generate({ system: 's', user: 'u' }), '{"ok":true}');
  assert.deepEqual(efforts, ['low', 'none']);
});

test('关思考后仍为空 → compiler-empty(稳定错误码前缀)', async () => {
  const llm = client(async () => reply('   ', 'stop'));
  await assert.rejects(llm.generate({ system: 's', user: 'u' }), (error) => {
    assert.equal(String(error.message).split(':', 1)[0], 'compiler-empty');
    return true;
  });
});

test('上游不认 reasoning_effort(400)→ 去参数重发', async () => {
  const efforts = [];
  const llm = client(async (url, init) => {
    const body = JSON.parse(init.body);
    efforts.push(Object.hasOwn(body, 'reasoning_effort') ? body.reasoning_effort : 'absent');
    return efforts.length === 1 ? jsonResponse(400, { error: 'bad param' }) : reply('{"ok":1}');
  });
  assert.equal(await llm.generate({ system: 's', user: 'u' }), '{"ok":1}');
  assert.deepEqual(efforts, ['low', 'absent']);
});

test('429 → compiler-rate-limited;其他非 2xx → compiler-upstream-failed', async () => {
  await assert.rejects(client(async () => jsonResponse(429, {})).generate({ system: 's', user: 'u' }), /^Error: compiler-rate-limited$/);
  await assert.rejects(client(async () => jsonResponse(502, {})).generate({ system: 's', user: 'u' }), /compiler-upstream-failed/);
});

test('超时 → compiler-timeout', async () => {
  const llm = client((url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }), { timeoutMs: 20 });
  await assert.rejects(llm.generate({ system: 's', user: 'u' }), /^Error: compiler-timeout$/);
});

test('reasoningEffort 显式设为 none 时空正文不再重试', async () => {
  let calls = 0;
  const llm = client(async () => { calls += 1; return reply('', 'stop'); }, { reasoningEffort: 'none' });
  await assert.rejects(llm.generate({ system: 's', user: 'u' }), /compiler-empty/);
  assert.equal(calls, 1);
});
