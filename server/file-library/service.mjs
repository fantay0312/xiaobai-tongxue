import crypto from 'node:crypto';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const cleanName = (raw) => { const name = typeof raw === 'string' ? raw.trim() : ''; if (!name || name.length > 180 || /[\x00-\x1f/\\]/.test(name) || ['.', '..'].includes(name)) fail('library-name-invalid'); return name; };
const parentOf = (entries, id) => { if (id === null) return null; const parent = entries.find((item) => item.id === id && item.kind === 'folder' && !item.deletedAt); if (!parent) fail('library-folder-not-found', 404); return parent; };
const ownedEntry = (entries, id) => { const item = entries.find((entry) => entry.id === id); if (!item) fail('library-entry-not-found', 404); return item; };
const uniqueName = (entries, parentId, name, except) => { if (entries.some((item) => item.id !== except && !item.deletedAt && item.parentId === parentId && item.name === name)) fail('library-name-exists', 409); };
const publicEntry = ({ objectKey, parse, ...entry }) => ({ ...entry, ...(parse ? { parse: { assetId: parse.assetId, status: parse.status, error: parse.error, updatedAt: parse.updatedAt } } : {}) });

export function createFileLibraryService({ metadata, blobs, mode = 'cloud', maxBytes = 80 * 1024 * 1024, customContent, now = () => new Date().toISOString() }) {
  const maximum = Math.min(maxBytes, blobs.maxObjectBytes ?? maxBytes);
  const mutate = (owner, work) => metadata.mutate(owner.id, work);
  return {
    maxFileBytes: maximum,
    async list(owner) {
      let syncWarning = null;
      // Register existing course originals once, without copying or changing their ownership.
      if (customContent?.listLibraryFiles) {
        try {
          const files = await customContent.listLibraryFiles(owner);
          await mutate(owner, (entries) => {
          for (const file of files) {
            const registered = entries.find((entry) => entry.sourceAssetId === file.assetId || entry.parse?.assetId === file.assetId || entry.courseImports?.some((link) => link.assetId === file.assetId));
            if (registered) {
              if (registered.phase !== 'removed' && !registered.courseImports?.some((link) => link.courseId === file.courseId)) registered.courseImports = [...(registered.courseImports ?? []), { courseId: file.courseId, assetId: file.assetId, at: now() }];
              if (file.parseStatus && registered.phase === 'ready'
                && (!registered.parse || registered.parse.assetId === file.assetId)) {
                registered.parse = { assetId:file.assetId, status:file.parseStatus, error:file.errorMessage, updatedAt:now() };
              }
              continue;
            }
            let folder = entries.find((entry) => entry.sourceCourseId === file.courseId && !entry.deletedAt && entry.phase === 'ready');
            if (!folder) {
              const base = cleanName(file.courseTitle.replace(/[\\/\x00-\x1f]/g, ' ').slice(0, 160) || '课程项目');
              let name = base, n = 1;
              while (entries.some((entry) => entry.parentId === null && !entry.deletedAt && entry.phase !== 'removed' && entry.name === name)) name = `${base} (${n++})`;
              folder = { id: crypto.randomUUID(), kind: 'folder', sourceCourseId: file.courseId, name, parentId: null, phase: 'ready', favorite: false, createdAt: now(), updatedAt: now(), deletedAt: null };
              entries.push(folder);
            }
            const base = cleanName(file.name.slice(0, 160)); let name = base, n = 1;
            while (entries.some((entry) => entry.parentId === folder.id && !entry.deletedAt && entry.phase !== 'removed' && entry.name === name)) name = `${base} (${n++})`;
            entries.push({ id: crypto.randomUUID(), kind: 'file', name, parentId: folder.id, sourceAssetId: file.assetId,
              byteSize: file.byteSize, contentType: file.contentType, sha256: file.sha256, phase: 'ready', favorite: false,
              createdAt: file.createdAt || now(), updatedAt: now(), deletedAt: null,
              ...(file.parseStatus ? { parse:{assetId:file.assetId,status:file.parseStatus,error:file.errorMessage,updatedAt:now()} } : {}),
              courseImports: [{ courseId: file.courseId, assetId: file.assetId, at: file.createdAt || now() }] });
          }
          });
        } catch { syncWarning = '旧课程文件暂未同步，已保存的文件仍可使用。请稍后刷新。'; }
      }
      return { entries: (await metadata.list(owner.id)).filter((entry) => entry.phase !== 'removed').map(publicEntry), storage: mode, maxFileBytes: maximum, syncWarning };
    },
    async folder(owner, input) {
      return mutate(owner, (entries) => {
        if (entries.filter((entry) => entry.phase !== 'removed').length >= 2500) fail('library-entry-limit', 409);
        const parentId = input.parentId ?? null; parentOf(entries, parentId);
        const name = cleanName(input.name); uniqueName(entries, parentId, name);
        const entry = { id: crypto.randomUUID(), kind: 'folder', name, parentId, createdAt: now(), updatedAt: now(), deletedAt: null, favorite: false, phase: 'ready' };
        entries.push(entry); return publicEntry(entry);
      });
    },
    async upload(owner, input) {
      if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > maximum) fail('library-file-size', 413);
      const id = crypto.randomUUID(), parentId = input.parentId ?? null, name = cleanName(input.name);
      const sha256 = crypto.createHash('sha256').update(input.bytes).digest('hex');
      const objectKey = blobs.createLibraryFileKey({ userId: owner.id });
      await mutate(owner, (entries) => {
        parentOf(entries, parentId); uniqueName(entries, parentId, name);
        if (entries.filter((entry) => entry.phase !== 'removed').length >= 2500 || entries.reduce((sum, item) => sum + (item.byteSize ?? 0), 0) + input.bytes.length > 512 * 1024 * 1024) fail('library-storage-limit', 409);
        entries.push({ id, kind: 'file', name, parentId, byteSize: input.bytes.length, contentType: /^[\w.+-]+\/[\w.+-]+$/.test(input.contentType ?? '') ? input.contentType : 'application/octet-stream', sha256, objectKey, phase: 'pending', createdAt: now(), updatedAt: now(), deletedAt: null, favorite: false, courseImports: [] });
      });
      try {
        await blobs.uploadLibraryFile({ userId: owner.id, key: objectKey, body: input.bytes, contentType: input.contentType || 'application/octet-stream' });
        if ((await blobs.verifySize({ userId: owner.id, key: objectKey })).byteSize !== input.bytes.length) fail('library-upload-integrity', 502);
        return await mutate(owner, (entries) => { const entry = ownedEntry(entries, id); if (entry.phase !== 'pending') fail('library-upload-expired', 409); entry.phase = 'ready'; entry.updatedAt = now(); return publicEntry(entry); });
      } catch (error) {
        try { await blobs.delete({ userId: owner.id, key: objectKey }); await mutate(owner, (entries) => { const index = entries.findIndex((entry) => entry.id === id); if (index >= 0) entries.splice(index, 1); }); } catch { /* The pending catalog entry remains a durable cleanup intent. */ }
        throw error;
      }
    },
    async update(owner, id, input) {
      return mutate(owner, (entries) => {
        const entry = ownedEntry(entries, id);
        if (entry.phase !== 'ready') fail('library-upload-pending', 409);
        if (input.trashed === true) {
          if (entry.parse?.status === 'starting') fail('library-parse-busy', 409);
          if (entry.kind === 'folder' && entries.some((child) => child.parentId === id && !child.deletedAt)) fail('library-folder-not-empty', 409);
          entry.deletedAt = now();
        } else if (input.trashed === false) {
          if (entry.parentId && !entries.some((parent) => parent.id === entry.parentId && !parent.deletedAt)) entry.parentId = null;
          uniqueName(entries, entry.parentId, entry.name, entry.id); entry.deletedAt = null;
        }
        if (Object.hasOwn(input, 'parentId')) {
          const parentId = input.parentId; parentOf(entries, parentId);
          let cursor = parentId; const seen = new Set();
          while (cursor) { if (cursor === id || seen.has(cursor)) fail('library-folder-cycle', 409); seen.add(cursor); cursor = parentOf(entries, cursor)?.parentId; }
          uniqueName(entries, parentId, entry.name, entry.id); entry.parentId = parentId;
        }
        if (Object.hasOwn(input, 'name')) { const name = cleanName(input.name); uniqueName(entries, entry.parentId, name, id); entry.name = name; }
        if (typeof input.favorite === 'boolean') entry.favorite = input.favorite;
        entry.updatedAt = now(); return publicEntry(entry);
      });
    },
    async purge(owner, id) {
      const target = await mutate(owner, (entries) => {
        const entry = ownedEntry(entries, id);
        if (!entry.deletedAt || !['ready', 'purging'].includes(entry.phase)) fail('library-trash-required', 409);
        if (entry.kind === 'folder' && entries.some((child) => child.parentId === id && child.phase !== 'removed')) fail('library-folder-not-empty', 409);
        entry.phase = 'purging'; entry.updatedAt = now(); return { ...entry };
      });
      if (target.parse || customContent?.findLibraryAsset) {
        try {
          if (customContent?.deleteLibraryFile) await customContent.deleteLibraryFile(owner, id);
          else {
            const canonicalId = target.parse?.assetId ?? (await customContent?.findLibraryAsset?.(owner, id))?.id;
            if (canonicalId) await customContent.deleteLibraryAsset(owner, canonicalId);
          }
        }
        catch (error) {
          if (error.message === 'asset-in-use') await mutate(owner, (entries) => { ownedEntry(entries, id).phase = 'ready'; });
          throw error;
        }
      }
      if (target.objectKey) await blobs.delete({ userId: owner.id, key: target.objectKey });
      await mutate(owner, (entries) => {
        const entry = ownedEntry(entries, id);
        if (entry.phase !== 'purging') fail('library-trash-required', 409);
        const index = entries.indexOf(entry);
        // Keep only an identity marker so a removed legacy reference cannot reappear on sync.
        if (entry.sourceAssetId || entry.courseImports?.length) entries[index] = { id, sourceAssetId: entry.sourceAssetId, courseImports: entry.courseImports, phase: 'removed' };
        else entries.splice(index, 1);
      });
    },
    async content(owner, id) {
      const entry = ownedEntry(await metadata.list(owner.id), id);
      if (entry.kind !== 'file' || entry.deletedAt || entry.phase !== 'ready') fail('library-file-not-found', 404);
      const bytes = entry.sourceAssetId
        ? await customContent.readLibraryFile(owner, entry.sourceAssetId)
        : Buffer.from((await blobs.read({ userId: owner.id, key: entry.objectKey })).body);
      if (bytes.length !== entry.byteSize || crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) fail('library-file-integrity', 502);
      return { entry: publicEntry(entry), bytes };
    },
    async importCourse(owner, id, input) {
      if (!customContent?.validateLibraryCourse) fail('custom-content-unavailable', 503);
      await customContent.validateLibraryCourse(owner, input.courseId);
      const asset = await this.parse(owner, id);
      const current = ownedEntry(await metadata.list(owner.id), id);
      if (current.deletedAt || current.phase !== 'ready') fail('library-file-not-found', 404);
      await customContent.attachLibraryAsset(owner, input.courseId, asset.assetId, input.assetRole ?? 'lecture');
      await mutate(owner, (entries) => { const file = ownedEntry(entries, id); file.courseImports = [...(file.courseImports ?? []).filter((link) => link.courseId !== input.courseId), { courseId: input.courseId, assetId: asset.assetId, at: now() }]; });
      return { assetId: asset.assetId };
    },
    async detachCourse(owner, id, courseId) {
      const file = ownedEntry(await metadata.list(owner.id), id);
      const link = file.courseImports?.find((item) => item.courseId === courseId);
      if (!link) fail('library-course-not-found', 404);
      await customContent.detachLibraryAsset(owner, courseId, link.assetId);
      await mutate(owner, (entries) => { const current = ownedEntry(entries, id); current.courseImports = (current.courseImports ?? []).filter((item) => item.courseId !== courseId); });
    },
    async parseState(owner, id) {
      const file = ownedEntry(await metadata.list(owner.id), id);
      if (file.kind !== 'file' || file.deletedAt || file.phase !== 'ready') fail('library-file-not-found', 404);
      let asset;
      if (file.parse?.assetId) asset = await customContent?.getAsset(owner, file.parse.assetId, `library-${id}`);
      else if (customContent?.findLibraryAsset) asset = await customContent.findLibraryAsset(owner, id);
      if (asset) {
        const parse = { assetId: asset.id, status: asset.parseStatus, error: asset.errorMessage, updatedAt: now() };
        return mutate(owner, (entries) => {
          const current = ownedEntry(entries, id);
          // A poll which started before a retry must not restore the previous terminal state.
          if (JSON.stringify(current.parse) === JSON.stringify(file.parse)) current.parse = parse;
          return { assetId:current.parse?.assetId ?? null, status:current.parse?.status ?? 'unparsed',
            error:current.parse?.error, updatedAt:current.parse?.updatedAt };
        });
      }
      return { status: file.parse?.status ?? 'unparsed', error: file.parse?.error, assetId: null };
    },
    async parse(owner, id, { retry = false } = {}) {
      if (!customContent?.parseLibraryFile) fail('custom-content-unavailable', 503);
      const state = await this.parseState(owner, id);
      if (state.assetId) {
        if (retry && ['failed', 'cancelled', 'completed'].includes(state.status)) { await customContent.reparseAsset(owner, state.assetId, `library-retry-${id}`); return this.parseState(owner, id); }
        return state;
      }
      const entry = ownedEntry(await metadata.list(owner.id), id);
      if (!/\.(pdf|pptx?|docx|md|txt)$/i.test(entry.name)) fail('file-type-unsupported', 415);
      const token = crypto.randomUUID();
      await mutate(owner, (entries) => {
        const file = ownedEntry(entries, id);
        if (file.deletedAt || file.phase !== 'ready') fail('library-file-not-found', 404);
        if (file.parse?.status === 'starting' && Date.now() - Date.parse(file.parse.updatedAt) < 240000) fail('library-parse-busy', 409);
        file.parse = { status: 'starting', token, updatedAt: now() };
      });
      try {
        const legacyAssetId = entry.sourceAssetId ?? entry.courseImports?.[0]?.assetId;
        let asset = legacyAssetId
          ? await customContent.adoptLibraryAsset(owner, legacyAssetId, id)
          : await customContent.reuseLibraryAsset?.(owner, id, token);
        if (!asset) {
          const { bytes } = await this.content(owner, id);
          asset = await customContent.parseLibraryFile(owner, { fileId:id, parseToken:token, filename:entry.name, bytes,
            objectKey:entry.objectKey, sha256:entry.sha256, requestId:`library-${id}` });
        }
        const parse = { assetId: asset.id, status: asset.parseStatus, error: asset.errorMessage, updatedAt: now() };
        await mutate(owner, (entries) => { const file = ownedEntry(entries, id); if (file.parse?.token === token) file.parse = parse; });
        return parse;
      } catch (error) {
        await mutate(owner, (entries) => { const file = ownedEntry(entries, id); if (file.parse?.token === token) file.parse = { status: 'failed', error: '解析未完成，可重试。', updatedAt: now() }; });
        throw error;
      }
    },
    async sources(owner, ids, query = '') {
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 12 || ids.some((id) => typeof id !== 'string')) fail('library-selection-invalid');
      const entries = await metadata.list(owner.id); const refs = [];
      for (const id of new Set(ids)) {
        const file = ownedEntry(entries, id);
        if (file.kind !== 'file' || file.deletedAt || file.phase !== 'ready') fail('library-file-not-found', 404);
        const state = await this.parseState(owner, id);
        if (!state.assetId || state.status !== 'completed') fail('library-parse-not-ready', 409);
        refs.push({ fileId: id, assetId: state.assetId, name: file.name });
      }
      return customContent.readLibrarySources(owner, refs, typeof query === 'string' ? query.slice(0, 3000) : '');
    },
    async reconcile() {
      const stale = await metadata.pendingBefore(new Date(Date.now() - 15 * 60000).toISOString());
      for (const group of stale) for (const entry of group.entries) {
        if (entry.phase === 'purging') { await this.purge({ id: group.userId }, entry.id); continue; }
        const claimed = await metadata.mutate(group.userId, (entries) => {
          const current = entries.find((item) => item.id === entry.id);
          if (!current || !['pending', 'cleaning'].includes(current.phase)) return false;
          current.phase = 'cleaning'; return true;
        });
        if (!claimed) continue;
        await blobs.delete({ userId: group.userId, key: entry.objectKey });
        await metadata.mutate(group.userId, (entries) => { const index = entries.findIndex((item) => item.id === entry.id && item.phase === 'cleaning'); if (index >= 0) entries.splice(index, 1); });
      }
    },
  };
}
