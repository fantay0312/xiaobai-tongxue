/** Isolated server acceptance deployment. Authentication remains with the primary gateway. */
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPostgresPoolFromEnv, createPostgresStoreFromEnv, createPrivateCosStoreFromEnv, createRedisOtpStoreFromEnv } from './storage/index.mjs';
import { createWeKnoraClient } from './custom-content/weknora-client.mjs';
import { createCustomContentService } from './custom-content/service.mjs';
import { createCustomContentRouter } from './custom-content/router.mjs';
import { createJsonLlmClient, createTopicCompiler } from './custom-content/topic-compiler.mjs';
import { createFileLibraryService } from './file-library/service.mjs';
import { postgresFileLibraryStore } from './file-library/repository.mjs';
import { createFileLibraryRouter } from './file-library/router.mjs';
import { createStudyTutorRouter } from './study-tutor.mjs';
import { createDeepTutorProvider } from './deeptutor-provider.mjs';
import { createStaticHandler } from './static-hosting.mjs';
import { createLearningChat } from './learning-chat.mjs';
import { createLearningAnswerService } from './learning-answer.mjs';
import { createLearningAnswerRouter } from './learning-answer-router.mjs';
import { createModelCatalog } from './model-catalog.mjs';
import { createModelGatewayService, createModelGatewayRouter } from './model-gateway.mjs';
import { createReaderRouter } from './reader/router.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(process.env.LEARNING_TEST_CONFIG ?? '/etc/xiaobai/learning-test.json', 'utf8'));
const schema = process.env.LEARNING_TEST_SCHEMA ?? 'xiaobai_learning_test';
const prefix = '/learning-test';
const origin = 'https://xiaobai.tokentosea.com';
if (!/^xiaobai_learning_[a-z0-9_]+$/.test(schema)) throw new Error('test-schema-required');
const primary = createPostgresPoolFromEnv();
await primary.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
const dbUrl = new URL(process.env.DATABASE_URL);
dbUrl.searchParams.set('options', `-c search_path=${schema}`);
const env = { ...process.env, DATABASE_URL: dbUrl.toString(), COS_PREFIX: `${process.env.COS_PREFIX || 'xiaobai'}/learning-test` };
const postgres = createPostgresStoreFromEnv(env);
await postgres.connect();
// Check the per-connection startup setting before executing any migration.
const check = createPostgresPoolFromEnv(env);
const probes = await Promise.all([check.query('SELECT current_schema() AS schema'), check.query('SHOW search_path')]);
if (probes[0].rows[0].schema !== schema || probes[1].rows[0].search_path !== schema) throw new Error('test-schema-isolation-failed');
await check.end();
const migrations = await postgres.migrate();
const redis = createRedisOtpStoreFromEnv(env);
await redis.connect();
const cos = createPrivateCosStoreFromEnv(env);
await cos.healthCheck();
const weknora = createWeKnoraClient({ baseUrl: env.WK_BASE_URL, apiKey: env.WK_API_KEY });
const llm = createJsonLlmClient({ baseUrl: cfg.upstreamBaseUrl, apiKey: cfg.apiKey, model: cfg.upstreamModelCoach || cfg.upstreamModel });
const learningChat = createLearningChat({ baseUrl: cfg.upstreamBaseUrl, apiKey: cfg.apiKey, model: cfg.upstreamModel, coachModel: cfg.upstreamModelCoach || cfg.upstreamModel });
const custom = createCustomContentService({ repository: postgres.customContent, weknora, cos, compiler: createTopicCompiler({ weknora, llm }), embeddingModelId: env.WK_EMBEDDING_MODEL_ID, summaryModelId: env.WK_SUMMARY_MODEL_ID });

function send(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data));
}
function readRaw(req, limit, options = {}) {
  return new Promise((resolve, reject) => {
    let bytes = 0; const chunks = [];
    const timer = setTimeout(() => { reject(Object.assign(new Error('body-timeout'), { status: 408 })); req.destroy(); }, options.totalTimeoutMs || 180000);
    req.on('data', (chunk) => { bytes += chunk.length; if (bytes > limit) { clearTimeout(timer); reject(Object.assign(new Error('body-too-large'), { status: 413 })); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    req.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}
const readJson = async (req, limit = 65536) => JSON.parse((await readRaw(req, limit, { totalTimeoutMs: 15000 })).toString() || '{}');
const hasJsonContentType = (req) => req.headers['content-type']?.split(';')[0] === 'application/json';
function authHeaders(req) {
  return { Cookie: req.headers.cookie || '', 'X-Xiaobai-User': req.headers['x-xiaobai-user'] || '', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': req.headers['x-forwarded-for'] || '127.0.0.1' };
}
async function resolveOwner(req, res) {
  const headers = authHeaders(req);
  const me = await fetch('http://127.0.0.1:8000/api/me', { headers, signal: AbortSignal.timeout(15000) });
  const user = (await me.json()).user;
  if (!user?.name) { send(res, 401, { error: 'login-required' }); return null; }
  // Pass the original identity header: never replace it with the account returned by /me.
  const gate = await fetch('http://127.0.0.1:8000/api/xb/courses', { headers, signal: AbortSignal.timeout(15000) });
  if (!gate.ok) { const error = await gate.json(); send(res, gate.status, error); return null; }
  await gate.body?.cancel();
  const result = await primary.query('SELECT id,username FROM public.users WHERE username_normalized=$1 AND disabled_at IS NULL', [user.name.normalize('NFC').toLocaleLowerCase('en-US')]);
  const row = result.rows[0];
  if (!row) { send(res, 401, { error: 'login-required' }); return null; }
  await primary.query(`INSERT INTO ${schema}.users(id,source,username,username_normalized,display_name) VALUES($1,'configured',$2,$3,$2) ON CONFLICT(id) DO NOTHING`, [row.id,row.username,row.username.toLocaleLowerCase('en-US')]);
  return { id: row.id, name: row.username };
}
const limit = (input) => redis.rateLimit({ ...input, scope: `learning-test-${input.scope}` });
const customRouter = createCustomContentRouter({ service: custom, resolveOwner, send, readRaw, readJson, hasJsonContentType, rateLimit: limit, rateLimitMany: (inputs) => redis.rateLimitMany(inputs.map((input) => ({ ...input, scope: `learning-test-${input.scope}` }))) });
const library = createFileLibraryService({ metadata: postgresFileLibraryStore(postgres), blobs: cos, customContent: custom });
const modelCatalog = createModelCatalog(cfg);
const learningAnswers = createLearningAnswerService({ fileLibrary: library, customContent: custom, baseUrl: cfg.upstreamBaseUrl, apiKey: cfg.apiKey, model: cfg.upstreamModelCoach || cfg.upstreamModel, catalog: modelCatalog });
const reserveLearningCalls = async(owner,res)=>{
  const result=await redis.rateLimitMany([
    {scope:'learning-test-chat-minute',subject:owner.id,limit:15,windowSeconds:60},
    {scope:'learning-test-chat-day',subject:owner.id,limit:200,windowSeconds:86400},
  ]);
  if(!result.allowed)send(res,429,{error:'rate-limited'});
  return result.allowed;
};
const learningAnswerRouter = createLearningAnswerRouter({service:learningAnswers,resolveOwner,send,readJson,hasJsonContentType,reserveCalls:reserveLearningCalls});
const modelGatewayRouter = createModelGatewayRouter({ service: createModelGatewayService({ baseUrl: cfg.upstreamBaseUrl, apiKey: cfg.apiKey, catalog: modelCatalog }), resolveOwner, send, readJson, hasJsonContentType, reserveCalls: reserveLearningCalls });
const libraryRouter = createFileLibraryRouter({ service: library, resolveOwner, send, readRaw, readJson, rateLimit: (owner) => limit({ scope: 'upload', subject: owner.id, limit: 60, windowSeconds: 86400 }) });
const readerRouter = createReaderRouter({ repository: postgres.reader, postgres, cfg, library, resolveOwner, send, readJson, readRaw, reserveCalls: reserveLearningCalls });
const studyRouter = createStudyTutorRouter({ provider: createDeepTutorProvider({ enabled: process.env.DEEPTUTOR_ENABLED === '1', model: cfg.upstreamModelCoach || cfg.upstreamModel, baseUrl: cfg.upstreamBaseUrl, apiKey: cfg.apiKey }), fileLibrary: library, customContent: custom, resolveOwner, send, readJson, hasJsonContentType,
  reserveCalls: async (owner, res, units) => { const result = await limit({ scope: 'deep', subject: owner.id, limit: 80, windowSeconds: 86400, amount: units }); if (!result.allowed) send(res,429,{error:'rate-limited'}); return result.allowed; } });
function proxyPrimary(req, res, pathname) {
  const headers = { ...req.headers, host: 'xiaobai.tokentosea.com' }; delete headers.connection;
  const upstream = http.request({ hostname:'127.0.0.1', port:8000, path:pathname, method:req.method, headers, timeout:180000 }, (response) => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
  upstream.on('timeout', () => upstream.destroy(new Error('upstream-timeout')));
  upstream.on('error', () => send(res,502,{error:'primary-unavailable'}));
  req.on('aborted', () => upstream.destroy()); res.on('close', () => { if (!res.writableEnded) upstream.destroy(); }); req.pipe(upstream);
}
const staticHandler = createStaticHandler({ mainDist:path.resolve(root,'../dist'),adminDist:path.resolve(root,'../dist'),prefix,send });
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost');
    if (url.pathname === prefix) { res.writeHead(308,{Location:prefix+'/'});res.end();return; }
    if (!url.pathname.startsWith(prefix+'/')) return send(res,404,{error:'not-found'});
    const pathname = url.pathname.slice(prefix.length);
    if (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin && !(pathname === '/api/reader/mcp' && !req.headers.origin && req.headers.authorization?.startsWith('Bearer '))) return send(res,403,{error:'invalid-origin'});
    if (pathname === '/api/health') return send(res,200,{ok:true,deployment:'learning-test',parser:'WeKnora',model:cfg.upstreamModelCoach || cfg.upstreamModel});
    if (pathname.startsWith('/api/reader/')) return await readerRouter.handle(req,res,pathname);
    if (pathname.startsWith('/api/learning/')) return await learningAnswerRouter.handle(req,res,pathname);
    if (pathname.startsWith('/api/model/')) return await modelGatewayRouter.handle(req,res,pathname);
    if (pathname === '/api/chat') {
      if (req.method !== 'POST') return send(res,405,{error:'method-not-allowed'});
      const owner = await resolveOwner(req,res); if (!owner) return;
      if (!hasJsonContentType(req)) return send(res,415,{error:'json-required'});
      const quotas = await redis.rateLimitMany([
        {scope:'learning-test-chat-minute',subject:owner.id,limit:15,windowSeconds:60},
        {scope:'learning-test-chat-day',subject:owner.id,limit:200,windowSeconds:86400},
      ]);
      if (!quotas.allowed) return send(res,429,{error:'rate-limited'});
      const input = await readJson(req,256000);
      const controller = new AbortController();
      const disconnected = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close',disconnected);
      try {
        const result = await learningChat(input,controller.signal);
        console.log('[learning-chat]',JSON.stringify({role:input.role,model:result.model,finish:result.finish,usage:result.usage}));
        return send(res,200,result);
      } finally { res.off('close',disconnected); }
    }
    if (pathname === '/api/me' || pathname === '/api/logout' || pathname.startsWith('/api/login') || pathname.startsWith('/api/captcha/') || pathname.startsWith('/api/auth/') || (req.method === 'GET' && (pathname.startsWith('/api/account/') || pathname.startsWith('/api/commerce/')))) return proxyPrimary(req,res,pathname+url.search);
    if (pathname.startsWith('/api/library')) return await libraryRouter.handle(req,res,pathname);
    if (pathname.startsWith('/api/xb/')) return await customRouter.handle(req,res,pathname);
    if (pathname.startsWith('/api/study/')) return await studyRouter.handle(req,res,pathname);
    if (pathname === '/api/state') {
      const owner = await resolveOwner(req,res); if (!owner) return;
      const current = await postgres.learningStates.get(owner.id,'primary');
      if (req.method === 'GET') return send(res,200,{state:current?.state??null,updatedAt:current?.updatedAt??null});
      if (req.method === 'PUT') { const input=await readJson(req,2*1024*1024); const version=current?.updatedAt??null;
        if ((input.baseVersion??null)!==version) return send(res,409,{error:'conflict',updatedAt:version});
        const saved=await postgres.learningStates.put({userId:owner.id,key:'primary',state:input.state,expectedRevision:current?.revision??0});return send(res,200,{ok:true,updatedAt:saved.updatedAt}); }
    }
    if (pathname.startsWith('/api/')) return send(res,404,{error:'not-found'});
    if (!['GET','HEAD'].includes(req.method)) return send(res,405,{error:'method-not-allowed'});
    return staticHandler(req,res,pathname);
  } catch (error) { console.error('[learning-test]',String(error.code||error.message).slice(0,100)); send(res,error.status||502,{error:'request-failed'}); }
});
await custom.resumePendingJobs();
const maintenance = setInterval(() => { void library.reconcile().catch(() => console.error('[learning-test] cleanup pending')); }, 300000);
maintenance.unref();
server.listen(Number(process.env.LEARNING_TEST_PORT || 8014),'127.0.0.1',() => console.log(`Learning test ready; schema=${schema}; migrations=${migrations.total}; real parser/model configured.`));
