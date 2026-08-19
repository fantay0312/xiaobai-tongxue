import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.map': 'application/json',
};

function adminCsp(inlineScripts) {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    ["script-src 'self'", ...inlineScripts].join(' '),
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
  ].join('; ');
}

const CAPTCHA_PRIMARY_ORIGINS = [
  'https://turing.captcha.qcloud.com',
  'https://turing.captcha.gtimg.com',
].join(' ');
const CAPTCHA_SCRIPT_ORIGINS = `${CAPTCHA_PRIMARY_ORIGINS} https://cloudcache.tencentcs.com`;

function mainCsp(inlineScripts) {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    [`script-src 'self' ${CAPTCHA_SCRIPT_ORIGINS} 'unsafe-eval'`, ...inlineScripts].join(' '),
    `style-src 'self' 'unsafe-inline' ${CAPTCHA_PRIMARY_ORIGINS}`,
    `img-src 'self' data: blob: ${CAPTCHA_PRIMARY_ORIGINS}`,
    "font-src 'self' data:",
    // 浏览器直连模式允许用户配置任意 OpenAI 兼容 HTTPS LLM / ASR 端点。
    "connect-src 'self' https:",
    "frame-src https://turing.captcha.qcloud.com",
    `media-src 'self' blob: ${CAPTCHA_PRIMARY_ORIGINS}`,
    "worker-src 'self' blob:",
  ].join('; ');
}

/* 只匹配无 src 的内联 <script>;带 src 的外链由 'self' 覆盖。 */
const INLINE_SCRIPT = /<script(?![^>]*\ssrc[\s=])[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * 外观主题必须在首屏绘制前落到 <html data-theme>,否则选了动漫/黑夜的用户每次刷新
 * 都先闪一帧默认票据风;外链脚本会多一次阻塞往返,所以那段启动脚本只能内联。
 * 但 script-src 绝不开 'unsafe-inline' —— 改为按发布产物 index.html 的实际内容
 * 逐段算 SHA-256 放行:脚本内容变了哈希跟着变,任何未随产物一同发布的注入脚本仍被拦。
 */
function inlineScriptHashes(indexHtml) {
  if (!existsSync(indexHtml) || !statSync(indexHtml).isFile()) return [];
  const html = readFileSync(indexHtml, 'utf8');
  const hashes = new Set();
  for (const [, body] of html.matchAll(INLINE_SCRIPT)) {
    if (!body.trim()) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return [...hashes];
}

function serve(req, res, send, urlPath, {
  root,
  csp,
  fallback = 'index.html',
  immutableAssets = true,
  admin = false,
}) {
  let relative;
  try {
    relative = decodeURIComponent(urlPath);
  } catch {
    return send(res, 400, 'bad-path');
  }
  if (relative.endsWith('/')) relative += 'index.html';
  const file = path.normalize(path.join(root, relative));
  if (file !== root && !file.startsWith(root + path.sep)) {
    return send(res, 403, 'forbidden');
  }
  let target = file;
  if (!existsSync(target) || !statSync(target).isFile()) {
    if (!fallback) return send(res, 404, 'not-found');
    target = path.join(root, fallback);
    if (!existsSync(target) || !statSync(target).isFile()) {
      return send(res, 404, 'not-found');
    }
  }
  const extension = path.extname(target).toLowerCase();
  const immutable = immutableAssets && /\/assets\//.test(target);
  try {
    const data = readFileSync(target);
    res.writeHead(200, {
      'Content-Type': MIME[extension] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Security-Policy': csp,
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': admin
        ? 'camera=(), geolocation=(), microphone=(), payment=(), usb=()'
        : 'camera=(self), geolocation=(), microphone=(self), payment=(), usb=()',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(res, 500, 'read-error');
  }
}

export function createStaticHandler({
  mainDist,
  adminDist,
  prefix = '',
  send,
} = {}) {
  if (!mainDist || !adminDist || !send) throw new Error('static-handler-dependencies-required');
  /* 发布时算一次:运行期不再读 index.html,产物换了必须重启服务(与 systemd 发布流程一致)。 */
  const mainPolicy = mainCsp(inlineScriptHashes(path.join(mainDist, 'index.html')));
  const adminPolicy = adminCsp(inlineScriptHashes(path.join(adminDist, 'index.html')));
  return function handleStatic(req, res, pathname) {
    if (pathname === '/admin') {
      res.writeHead(308, {
        Location: `${prefix || ''}/admin/`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }
    if (pathname === '/admin/' || pathname.startsWith('/admin/')) {
      const adminPath = pathname.slice('/admin'.length) || '/';
      const isAsset = adminPath.startsWith('/assets/');
      serve(req, res, send, adminPath, {
        root: adminDist,
        csp: adminPolicy,
        fallback: isAsset ? null : 'index.html',
        immutableAssets: isAsset,
        admin: true,
      });
      return;
    }
    serve(req, res, send, pathname === '/' ? '/index.html' : pathname, {
      root: mainDist,
      csp: mainPolicy,
    });
  };
}
