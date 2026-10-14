export function createFileLibraryRouter({ service, resolveOwner, send, readJson, readRaw, rateLimit }) {
  let uploading = 0; const owners = new Set(); const parsingOwners = new Map();
  return { async handle(req, res, pathname) {
    const owner = await resolveOwner(req, res); if (!owner) return;
    if (!service) return send(res, 503, { error: 'library-unavailable' });
    try {
      if (pathname === '/api/library' && req.method === 'GET') return send(res, 200, await service.list(owner));
      if (pathname === '/api/library/sources' && req.method === 'POST') { const input = await readJson(req, 8192); return send(res, 200, await service.sources(owner, input.fileIds, input.query)); }
      if (pathname === '/api/library/folders' && req.method === 'POST') return send(res, 201, { entry: await service.folder(owner, await readJson(req, 4096)) });
      const entryMatch = /^\/api\/library\/entries\/([a-f0-9-]{36})$/.exec(pathname);
      if (entryMatch && req.method === 'PATCH') return send(res, 200, { entry: await service.update(owner, entryMatch[1], await readJson(req, 4096)) });
      if (entryMatch && req.method === 'DELETE') { await service.purge(owner, entryMatch[1]); return send(res, 200, { deleted: true }); }
      if (pathname === '/api/library/files' && req.method === 'POST') {
        if (uploading >= 2 || owners.has(owner.id)) return send(res, 429, { error: 'library-upload-busy' });
        uploading += 1; owners.add(owner.id);
        try {
          if (rateLimit && !(await rateLimit(owner)).allowed) return send(res, 429, { error: 'rate-limited' });
          const url = new URL(req.url, 'http://localhost');
          const name = decodeURIComponent(String(req.headers['x-file-name'] ?? ''));
          const bytes = await readRaw(req, service.maxFileBytes, { idleTimeoutMs: 30000, totalTimeoutMs: 180000 });
          const entry = await service.upload(owner, { name, parentId: url.searchParams.get('parentId') || null, bytes, contentType: String(req.headers['content-type'] ?? '') });
          if (!res.destroyed) send(res, 201, { entry });
        } finally { uploading -= 1; owners.delete(owner.id); }
        return;
      }
      const detachMatch = /^\/api\/library\/files\/([a-f0-9-]{36})\/course\/([a-f0-9-]{36})$/.exec(pathname);
      if (detachMatch && req.method === 'DELETE') { await service.detachCourse(owner, detachMatch[1], detachMatch[2]); return send(res, 200, { detached: true }); }
      const fileMatch = /^\/api\/library\/files\/([a-f0-9-]{36})\/(content|course|parse)$/.exec(pathname);
      if (fileMatch && fileMatch[2] === 'parse' && req.method === 'GET') return send(res, 200, await service.parseState(owner, fileMatch[1]));
      if (fileMatch && fileMatch[2] === 'content' && req.method === 'GET') {
        const { entry, bytes } = await service.content(owner, fileMatch[1]);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(entry.name)}`, 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); res.end(bytes); return;
      }
      if (fileMatch && ['course', 'parse'].includes(fileMatch[2]) && req.method === 'POST') {
        const parsing = fileMatch[2] === 'parse';
        if (uploading >= 2 || owners.has(owner.id) || (!parsing && parsingOwners.has(owner.id))) return send(res, 429, { error: 'library-upload-busy' });
        uploading += 1;
        if (parsing) parsingOwners.set(owner.id, (parsingOwners.get(owner.id) ?? 0) + 1);
        else owners.add(owner.id);
        try {
          if (rateLimit && !(await rateLimit(owner)).allowed) return send(res, 429, { error: 'rate-limited' });
          const input = await readJson(req, 4096);
          return send(res, 201, fileMatch[2] === 'course' ? await service.importCourse(owner, fileMatch[1], input) : await service.parse(owner, fileMatch[1], input));
        }
        finally {
          uploading -= 1;
          if (parsing) { const left = parsingOwners.get(owner.id) - 1; if (left) parsingOwners.set(owner.id, left); else parsingOwners.delete(owner.id); }
          else owners.delete(owner.id);
        }
      }
      send(res, 404, { error: 'not-found' });
    } catch (error) {
      if (res.destroyed) return;
      const status = error.status ?? (error.message === 'body-too-large' ? 413 : error instanceof SyntaxError || error instanceof URIError ? 400 : 502);
      const code = /^library-[a-z-]+$|^custom-content-unavailable$|^file-type-unsupported$|^asset-(duplicate|not-found|in-use)$|^course-not-found$/.test(error.message) ? error.message : status === 413 ? 'library-file-size' : 'library-request-failed';
      send(res, status, { error: code });
    }
  } };
}
