/**
 * 小白同学 生产网关(零依赖,Node ≥ 18)
 *  - 静态托管前端 dist(SPA 回退)
 *  - /api/login /api/logout /api/me:预置账号会话(scrypt 哈希,HttpOnly Cookie),不开放注册
 *  - /api/chat:登录后才可用的 LLM 代理 —— DeepSeek 密钥只存在服务器 config.json,永不下发
 *
 * 用法:
 *   node index.mjs                 # 读取同目录 config.json 启动
 *   node index.mjs hash <密码>     # 生成账号的 scrypt 哈希条目(粘进 config.json 的 users)
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ───────────────────────── CLI:密码哈希生成 ─────────────────────────
if (process.argv[2] === 'hash') {
  const pw = process.argv[3];
  if (!pw) { console.error('用法: node index.mjs hash <密码>'); process.exit(2); }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  console.log(JSON.stringify({ name: '改成账号名', salt, hash }));
  process.exit(0);
}

// ───────────────────────── 配置 ─────────────────────────
const CONFIG_PATH = path.join(HERE, 'config.json');
if (!existsSync(CONFIG_PATH)) {
  console.error('缺少 config.json(参照 config.example.json)');
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const PORT = cfg.port ?? 8787;
const DIST = path.resolve(HERE, cfg.distDir ?? '../dist');
const UPSTREAM = String(cfg.upstreamBaseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
const MODEL = cfg.upstreamModel ?? 'deepseek-chat';
const API_KEY = cfg.apiKey ?? '';
const USERS = Array.isArray(cfg.users) ? cfg.users : [];
const SESSION_TTL = (cfg.sessionTtlHours ?? 72) * 3600_000;
/** 路径前缀部署(nginx location /xiaobai/ 反代时设为 "/xiaobai"):网关自己剥前缀,双入口可用 */
const PREFIX = String(cfg.pathPrefix ?? '').replace(/\/+$/, '');
/** 与同机其他站点共用源时避免 Cookie 名冲突 */
const COOKIE = 'xiaobai_sid';
if (!API_KEY) console.warn('[warn] config.apiKey 为空,/api/chat 将全部 502');
if (USERS.length === 0) console.warn('[warn] config.users 为空,无人能登录');

// ───────────────────────── 会话与限流(内存态,重启即清) ─────────────────────────
const sessions = new Map(); // token -> { name, expires }
const loginFails = new Map(); // ip -> { count, resetAt }
const chatHits = new Map(); // token -> { count, resetAt }
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t);
  for (const [k, v] of loginFails) if (v.resetAt < now) loginFails.delete(k);
  for (const [k, v] of chatHits) if (v.resetAt < now) chatHits.delete(k);
}, 60_000).unref();

const LOGIN_MAX_FAILS = 10;          // 15 分钟内同 IP 最多失败次数
const LOGIN_WINDOW = 15 * 60_000;
const CHAT_MAX_PER_MIN = 20;         // 单会话每分钟 LLM 调用上限

function clientIp(req) {
  const direct = req.socket.remoteAddress ?? 'unknown';
  // 仅当请求来自本机(nginx 反代)时才信任 X-Real-IP;公网直连不信任任何头,防伪造绕限流
  if (direct === '127.0.0.1' || direct === '::1' || direct === '::ffff:127.0.0.1') {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real) return real;
  }
  return direct;
}

function getCookie(req, name) {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function currentUser(req) {
  const token = getCookie(req, COOKIE);
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) { if (token) sessions.delete(token); return null; }
  return { token, name: s.name };
}

/** 会话数量上限:单账号与全局各设天花板,超出逐出最旧(Map 迭代序=插入序);防刷登录撑爆内存 */
const MAX_SESSIONS_PER_USER = 20;
const MAX_SESSIONS_TOTAL = 500;
function pruneSessions(name) {
  const mine = [];
  for (const [t, s] of sessions) if (s.name === name) mine.push(t);
  while (mine.length >= MAX_SESSIONS_PER_USER) sessions.delete(mine.shift());
  while (sessions.size >= MAX_SESSIONS_TOTAL) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

function verifyPassword(user, password) {
  try {
    const expect = Buffer.from(user.hash, 'hex');
    const got = crypto.scryptSync(password, user.salt, expect.length);
    return crypto.timingSafeEqual(expect, got);
  } catch { return false; }
}

// ───────────────────────── 请求体与响应工具 ─────────────────────────
const BODY_LIMIT = 64 * 1024;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(new Error('body-too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('bad-json')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

// ───────────────────────── API 处理 ─────────────────────────
async function handleLogin(req, res) {
  const ip = clientIp(req);
  const fails = loginFails.get(ip);
  if (fails && fails.count >= LOGIN_MAX_FAILS && fails.resetAt > Date.now()) {
    return send(res, 429, { error: 'too-many-attempts' });
  }
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: 'bad-request' }); }
  const { username, password } = body ?? {};
  const user = USERS.find((u) => u.name === username);
  if (!user || typeof password !== 'string' || !verifyPassword(user, password)) {
    const f = loginFails.get(ip) ?? { count: 0, resetAt: Date.now() + LOGIN_WINDOW };
    f.count += 1; loginFails.set(ip, f);
    return send(res, 401, { error: 'invalid-credentials' });
  }
  loginFails.delete(ip);
  pruneSessions(user.name);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { name: user.name, expires: Date.now() + SESSION_TTL });
  send(res, 200, { user: { name: user.name } }, {
    'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}`,
  });
}

function handleLogout(req, res) {
  const u = currentUser(req);
  if (u) sessions.delete(u.token);
  send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
}

function handleMe(req, res) {
  const u = currentUser(req);
  send(res, 200, { user: u ? { name: u.name } : null, authRequired: true });
}

/** LLM 代理:模型/密钥/端点全部服务器侧决定,客户端只能传对话内容与少量参数 */
const ROLE_MAX_TOKENS = { xiaobai: 400, evaluator: 700, report: 900 };
const UPSTREAM_TIMEOUT = 45_000;

async function handleChat(req, res) {
  const u = currentUser(req);
  if (!u) return send(res, 401, { error: 'login-required' });

  // 限流按账号名而非会话 token:重复登录铸新会话无法刷新额度
  const rate = chatHits.get(u.name) ?? { count: 0, resetAt: Date.now() + 60_000 };
  if (rate.resetAt < Date.now()) { rate.count = 0; rate.resetAt = Date.now() + 60_000; }
  rate.count += 1; chatHits.set(u.name, rate);
  if (rate.count > CHAT_MAX_PER_MIN) return send(res, 429, { error: 'rate-limited' });

  let body;
  try { body = await readJson(req); } catch (e) {
    return send(res, e.message === 'body-too-large' ? 413 : 400, { error: e.message });
  }
  const role = ROLE_MAX_TOKENS[body?.role] ? body.role : 'xiaobai';
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const clean = messages
    .filter((m) => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))
    .slice(0, 12);
  if (clean.length === 0) return send(res, 400, { error: 'empty-messages' });
  const temperature = Math.min(1.5, Math.max(0, Number(body?.temperature) || 0));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT);
  try {
    const upstream = await fetch(`${UPSTREAM}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature,
        max_tokens: ROLE_MAX_TOKENS[role],
        ...(body?.json ? { response_format: { type: 'json_object' } } : {}),
        messages: clean,
      }),
      signal: ctrl.signal,
    });
    if (!upstream.ok) {
      console.error(`[chat] upstream ${upstream.status}`);
      return send(res, 502, { error: 'upstream', status: upstream.status });
    }
    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content) return send(res, 502, { error: 'upstream-empty' });
    send(res, 200, { content });
  } catch (e) {
    console.error('[chat] error:', e?.name === 'AbortError' ? 'timeout' : e?.message);
    send(res, 504, { error: 'upstream-timeout' });
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── 静态资源(SPA) ─────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json',
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(DIST, rel));
  // 必须带分隔符比较:裸 startsWith(DIST) 会放行 /opt/xiaobai/distX 这类同前缀兄弟目录
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return send(res, 403, 'forbidden');
  let target = file;
  if (!existsSync(target) || !statSync(target).isFile()) {
    target = path.join(DIST, 'index.html'); // SPA 回退
  }
  const ext = path.extname(target).toLowerCase();
  const immutable = /\/assets\//.test(target);
  try {
    const data = readFileSync(target);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    res.end(data);
  } catch {
    send(res, 500, 'read-error');
  }
}

// ───────────────────────── 路由 ─────────────────────────
const server = http.createServer((req, res) => {
  let { pathname } = new URL(req.url, 'http://localhost');
  // 路径前缀部署:/xiaobai/... 与根路径 ... 等价(nginx 反代不改写,前缀由这里剥)
  if (PREFIX && (pathname === PREFIX || pathname.startsWith(`${PREFIX}/`))) {
    pathname = pathname.slice(PREFIX.length) || '/';
  }
  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/login' && req.method === 'POST') return void handleLogin(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') return handleLogout(req, res);
    if (pathname === '/api/me' && req.method === 'GET') return handleMe(req, res);
    if (pathname === '/api/chat' && req.method === 'POST') return void handleChat(req, res);
    return send(res, 404, { error: 'not-found' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method-not-allowed');
  serveStatic(req, res, pathname === '/' ? '/index.html' : pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`小白同学网关已启动: http://0.0.0.0:${PORT} (dist: ${DIST}, model: ${MODEL})`);
});
