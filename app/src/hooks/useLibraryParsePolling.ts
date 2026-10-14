import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { libraryParseState, type LibrarySnapshot } from '../lib/fileLibrary';
import { isParsing } from '../lib/libraryParsing';
import { useAuthStore } from '../store/authStore';

export function useLibraryParsePolling<T extends LibrarySnapshot | null | undefined>(snapshot: T, update: Dispatch<SetStateAction<T>>, owner: string | null) {
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const [warning, setWarning] = useState('');
  const key = (snapshot?.entries ?? []).filter(e => !e.deletedAt && e.phase === 'ready' && isParsing(e.parse?.status)).map(e => e.id).sort().join(',');
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let hadError = false;
      const entries = latest.current?.entries.filter(e => key.split(',').includes(e.id) && isParsing(e.parse?.status)) ?? [];
      for (let start = 0; start < entries.length; start += 4) {
        await Promise.all(entries.slice(start, start + 4).map(async entry => {
          try {
            const parse = await libraryParseState(entry.id, controller.signal);
            if (controller.signal.aborted || useAuthStore.getState().user !== owner) return;
            update(current => current ? { ...current, entries:current.entries.map(e => e.id === entry.id && e.parse?.assetId === entry.parse?.assetId && e.parse?.status === entry.parse?.status ? { ...e, parse } : e) } as T : current);
          } catch { if (!controller.signal.aborted) hadError = true; }
        }));
      }
      if (controller.signal.aborted) return;
      setWarning(hadError ? '暂时无法更新解析进度，后台任务仍可能继续；连接恢复后会自动重试。' : '');
      timer = setTimeout(() => void poll(), 2500);
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [key, owner, update]);
  return key ? warning : '';
}
