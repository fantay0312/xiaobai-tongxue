"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { startSync, syncConflicts } from "@/lib/sync";
import { download } from "@/lib/export";

/** Runs account sync while someone is signed in. Renders nothing. */
export function SyncAgent() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    const onError = (event: Event) => setError((event as CustomEvent<string>).detail);
    const onConflict = () => { setConflict(true); setError('检测到其他设备的修改，已保留冲突副本并继续同步本机内容。'); };
    window.addEventListener('gloss:sync-error', onError);
    window.addEventListener('gloss:sync-conflict', onConflict);
    return () => { window.removeEventListener('gloss:sync-error', onError); window.removeEventListener('gloss:sync-conflict', onConflict); };
  }, []);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;
    useStore.getState().hydrate();
    const s = startSync(userId);
    return () => s.stop();
  }, [isLoaded, isSignedIn, userId]);
  return error ? <div role="status" className="fixed bottom-20 left-1/2 z-50 flex w-max max-w-[90vw] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border border-rule bg-bg px-4 py-3 text-[12px] text-ink shadow-lg"><span className="min-w-0 flex-1">{error}</span>{conflict && userId && <button type="button" className="underline" onClick={() => download(new Blob([JSON.stringify(syncConflicts(userId), null, 2)], { type: 'application/json' }), '阅读同步冲突副本.json')}>导出冲突副本</button>}<button type="button" aria-label="关闭同步提示" onClick={() => setError('')}>×</button></div> : null;
}
