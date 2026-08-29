/**
 * 助教「小砚」的推理预算与空正文兜底。
 *
 * 线上事故:coach 走推理模型(upstreamModelCoach),思考 token 与正文共用 max_tokens。
 * 额度 700 时思考单次可吃满 → 正文空串 → 网关 502 → 前端静默降级「离线锦囊」,
 * 表现为「助教离线」而服务本身一切正常。这里钉死修复后的三条行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  authHeaders,
  copyRuntimeModules,
  login,
  openPort,
  waitForReady,
} from './integration.test-harness.mjs';

const VERIFIED_AT = '2026-07-17T00:00:00.000Z';
const MODEL_MAIN = 'test-flash';
const MODEL_COACH = 'test-pro-reasoner';

function passwordUser(name, password, email) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return {
    name,
    salt,
    hash,
    email,
    emailVerifiedAt: VERIFIED_AT,
    phone: '+8613900001234',
    phoneVerifiedAt: VERIFIED_AT,
  };
}

/** 每行一条上游请求记录 */
async function upstreamCalls(file) {
  const raw = await readFile(file, 'utf8').catch(() => '');
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('助教推理预算够用,空正文由非推理模型兜底,不再降级离线锦囊', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-coach-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  const upstreamLog = path.join(root, 'upstream.log');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  await copyRuntimeModules(root);

  // 假上游:推理模型恒返回空正文(复现线上故障);主模型正常出字。
  // user 文本带 ALL-EMPTY 时两个模型都空,用来验证兜底也失败时仍回 502。
  await writeFile(path.join(root, 'fake-llm.cjs'), `
const { appendFileSync } = require('node:fs');
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (url === 'https://llm.example/v1/chat/completions') {
    const body = JSON.parse(String(init?.body ?? '{}'));
    appendFileSync(process.env.LLM_TEST_LOG, JSON.stringify(body) + '\\n');
    const user = (body.messages || []).find((m) => m.role === 'user');
    const allEmpty = String(user?.content ?? '').includes('ALL-EMPTY');
    const empty = body.model === ${JSON.stringify(MODEL_COACH)} || allEmpty;
    return new Response(JSON.stringify({
      choices: [{
        finish_reason: empty ? 'length' : 'stop',
        message: { content: empty ? '' : '老师,开场可以先把小白的困惑摆出来。' },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return nativeFetch(input, init);
};
`);

  const teacher = passwordUser('CoachTeacher', 'coach-password', 'coach@example.com');
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port,
    distDir: './dist',
    dataDir: data,
    allowInsecureAuth: true,
    upstreamBaseUrl: 'https://llm.example/v1',
    upstreamModel: MODEL_MAIN,
    upstreamModelCoach: MODEL_COACH,
    apiKey: 'coach-test-key',
    users: [teacher],
  }));

  const child = spawn(process.execPath, ['--require', './fake-llm.cjs', 'index.mjs'], {
    cwd: root,
    env: { ...process.env, LLM_TEST_LOG: upstreamLog },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  });
  await waitForReady(child);

  const base = `http://127.0.0.1:${port}`;
  const { cookie } = await login(base, teacher.name, 'coach-password', teacher.name);
  const headers = { 'Content-Type': 'application/json', ...authHeaders(teacher, cookie) };
  const ask = (role, question) => fetch(`${base}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      role,
      messages: [
        { role: 'system', content: '你是「小砚」,备课助教。' },
        { role: 'user', content: question },
      ],
    }),
  });

  // ── 1. 推理模型吐空正文 → 网关用主模型补一刀,老师侧仍拿到真答案 ──
  const reply = await ask('coach', '帮我想个开场白');
  assert.equal(reply.status, 200, '助教不该因为推理模型吐空而 502');
  assert.match((await reply.json()).content, /开场/);

  const firstRound = await upstreamCalls(upstreamLog);
  assert.equal(firstRound.length, 2, '应当只补发一次,不能无限重试');

  const [primary, fallback] = firstRound;
  assert.equal(primary.model, MODEL_COACH);
  assert.equal(primary.max_tokens, 2200, '思考与正文共用额度,700 会把正文挤没');
  assert.equal(primary.reasoning_effort, 'low', '不封顶思考预算,延迟与截断都会回来');
  assert.equal(primary.temperature, 0.5);

  assert.equal(fallback.model, MODEL_MAIN, '兜底必须换成非推理模型');
  assert.equal(
    Object.hasOwn(fallback, 'reasoning_effort'), false,
    '非推理模型不该收到 reasoning_effort',
  );

  // ── 2. 兜底也吐空 → 仍是 502,不伪造内容 ──
  await writeFile(upstreamLog, '');
  const dead = await ask('coach', 'ALL-EMPTY 帮我想个开场白');
  assert.equal(dead.status, 502);
  assert.deepEqual(await dead.json(), { error: 'upstream-empty' });
  assert.equal((await upstreamCalls(upstreamLog)).length, 2);

  // ── 3. 课堂角色不受影响:不带思考参数、额度照旧、不触发兜底 ──
  await writeFile(upstreamLog, '');
  const xiaobai = await ask('xiaobai', '老师讲完了');
  assert.equal(xiaobai.status, 200);

  const classroom = await upstreamCalls(upstreamLog);
  assert.equal(classroom.length, 1, '主模型答得出来就不该有第二次调用');
  assert.equal(classroom[0].model, MODEL_MAIN);
  assert.equal(classroom[0].max_tokens, 1200);
  assert.equal(classroom[0].reasoning_effort, 'none', '课堂小白关思考:台词不撞上限、首字更快');
});
