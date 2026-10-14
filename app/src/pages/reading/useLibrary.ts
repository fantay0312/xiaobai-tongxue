import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { readerError } from './api';
import { fetchCloud, listCloud, localDocument, localDocuments, saveCloud, saveLocal } from './storage';
import type { ReaderDocument, ReaderSummary } from './types';

export function useReaderLibrary(owner: string) {
  const [documents, setDocuments] = useState<ReaderSummary[]>([]);
  const [status, setStatus] = useState('正在载入书架…');
  const alive = useRef(true); const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const latest = useRef(new Map<string, ReaderDocument>()); const running = useRef(new Set<string>());
  const isCurrent = useCallback(() => alive.current && useAuthStore.getState().user === owner, [owner]);
  const upsert = useCallback((doc: ReaderSummary) => {
    if (isCurrent()) setDocuments((current) => [doc, ...current.filter((item) => item.id !== doc.id)]);
  }, [isCurrent]);
  const sync = useCallback(async (id: string) => {
    if (running.current.has(id) || !isCurrent()) return;
    running.current.add(id);
    try {
      let doc = latest.current.get(id);
      while (doc?.localDirty && isCurrent()) {
        const revision = await saveCloud(doc);
        const current = latest.current.get(id) ?? doc;
        const same = current === doc;
        const saved = { ...current, revision, localDirty: !same };
        latest.current.set(id, saved); await saveLocal(owner, saved);
        // A keystroke can arrive while IndexedDB commits. Never publish the older snapshot over it.
        const newest = latest.current.get(id);
        if (newest === saved) upsert(saved);
        doc = newest;
        if (!doc?.localDirty) break;
      }
      if (isCurrent()) setStatus('已同步');
    } catch (error) { if (isCurrent()) setStatus(`本机已保存 · ${readerError(error)}`); }
    finally { running.current.delete(id); }
  }, [isCurrent, owner, upsert]);
  const save = useCallback(async (doc: ReaderDocument) => {
    if (!isCurrent()) return;
    const current = latest.current.get(doc.id);
    const next = { ...doc, revision: current?.revision ?? doc.revision, updatedAt: Date.now(), localDirty: true };
    latest.current.set(doc.id, next); upsert(next);
    try { await saveLocal(owner, next); if (isCurrent()) setStatus('本机已保存 · 待同步'); }
    catch { if (isCurrent()) setStatus('本机空间不足，正在尝试云端保存；请导出笔记。'); }
    clearTimeout(timers.current.get(doc.id)); timers.current.set(doc.id, setTimeout(() => { void sync(doc.id); }, 1200));
  }, [isCurrent, owner, upsert, sync]);
  const refresh = useCallback(async () => {
    try {
      const local = await localDocuments(owner); if (!isCurrent()) return;
      for (const doc of local) if (!latest.current.has(doc.id)) latest.current.set(doc.id, doc);
      setDocuments([...latest.current.values()]);
      const cloud = await listCloud(); if (!isCurrent()) return;
      const merged = new Map<string, ReaderSummary>(cloud.map((doc) => [doc.id, doc]));
      for (const doc of latest.current.values()) if (doc.localDirty || !merged.has(doc.id) || (doc.revision ?? 0) >= (merged.get(doc.id)?.revision ?? 0)) merged.set(doc.id, doc);
      setDocuments([...merged.values()]); setStatus('已同步');
      for (const doc of latest.current.values()) if (doc.localDirty) void sync(doc.id);
    } catch { if (isCurrent()) setStatus('离线可读 · 本机保存'); }
  }, [isCurrent, owner, sync]);
  const open = useCallback(async (id: string, forceCloud = false) => {
    const local = latest.current.get(id) ?? await localDocument(owner, id);
    if (local?.localDirty && !forceCloud) return local;
    try {
      const cloud = await fetchCloud(id); if (!isCurrent()) return undefined;
      const newest = latest.current.get(id);
      // Respect edits made after this read began, even during an explicit reload.
      if (newest && newest !== local && (newest.localDirty || (newest.revision ?? 0) > (cloud.revision ?? 0))) return newest;
      latest.current.set(id, cloud); await saveLocal(owner, cloud);
      const committed = latest.current.get(id);
      if (committed && committed !== cloud) return committed;
      upsert(cloud); return cloud;
    } catch (error) { if (local && !forceCloud) return local; throw error; }
  }, [isCurrent, owner, upsert]);
  const patch = useCallback((id: string, fields: Partial<ReaderDocument>) => {
    const doc = latest.current.get(id);
    if (!doc || !isCurrent()) return undefined;
    const next = { ...doc, ...fields, id: doc.id, revision: doc.revision };
    void save(next);
    return next;
  }, [isCurrent, save]);
  useEffect(() => {
    alive.current = true; void refresh();
    const online = () => void refresh();
    window.addEventListener('online', online); window.addEventListener('focus', online);
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30000);
    return () => { alive.current = false; clearInterval(interval); window.removeEventListener('online', online); window.removeEventListener('focus', online); timers.current.forEach(clearTimeout); };
  }, [refresh]);
  return { documents, status, save, open, patch, refresh };
}
