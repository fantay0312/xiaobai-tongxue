"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { startSync } from "@/lib/sync";

/** Runs account sync while someone is signed in. Renders nothing. */
export function SyncAgent() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [error, setError] = useState('');
  useEffect(() => {
    const onError = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener('gloss:sync-error', onError);
    return () => window.removeEventListener('gloss:sync-error', onError);
  }, []);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;
    useStore.getState().hydrate();
    const s = startSync(userId);
    return () => s.stop();
  }, [isLoaded, isSignedIn, userId]);
  return error ? <div role="status" className="fixed bottom-20 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-xl border border-rule bg-bg px-4 py-3 text-[12px] text-ink shadow-lg">{error}<button type="button" aria-label="关闭同步提示" onClick={() => setError('')}>×</button></div> : null;
}
