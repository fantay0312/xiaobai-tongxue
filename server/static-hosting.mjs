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
  '.map': 'application/json',
};

const ADMIN_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
].join('; ');

const MAIN_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' https://turing.captcha.qcloud.com 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.captcha.qcloud.com",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "frame-src https://*.captcha.qcloud.com",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
].join('; ');

function serve(req, res, send, urlPath, {
  root,
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
      'Content-Security-Policy': admin ? ADMIN_CSP : MAIN_CSP,
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
        fallback: isAsset ? null : 'index.html',
        immutableAssets: isAsset,
        admin: true,
      });
      return;
    }
    serve(req, res, send, pathname === '/' ? '/index.html' : pathname, {
      root: mainDist,
    });
  };
}
