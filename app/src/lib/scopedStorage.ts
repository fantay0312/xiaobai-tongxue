/** Prefix deployments keep their browser data separate from the main site. */
export function createScopedStorage(storage: Storage, prefix: string): Storage {
  const keys = () => Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => !!key && key.startsWith(prefix));
  const methods = {
    getItem: (key: string) => storage.getItem(prefix + key),
    setItem: (key: string, value: string) => storage.setItem(prefix + key, value),
    removeItem: (key: string) => storage.removeItem(prefix + key),
    clear: () => keys().forEach((key) => storage.removeItem(key)),
    key: (index: number) => keys()[index]?.slice(prefix.length) ?? null,
  };
  return new Proxy(storage, {
    get: (_target, key) => key === 'length' ? keys().length : key in methods ? methods[key as keyof typeof methods] : typeof key === 'string' ? methods.getItem(key) : undefined,
    set: (_target, key, value) => { if (typeof key === 'string') methods.setItem(key, String(value)); return true; },
    deleteProperty: (_target, key) => { if (typeof key === 'string') methods.removeItem(key); return true; },
  });
}

const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
if (typeof window !== 'undefined' && base !== '/') {
  const prefix = `xiaobai-site:${base}:`;
  const scoped = createScopedStorage(window.localStorage, prefix);
  Object.defineProperty(window, 'localStorage', { value: scoped, configurable: true });
  window.addEventListener('storage', (event) => {
    if (event.key?.startsWith(prefix)) window.dispatchEvent(new StorageEvent('storage', { key: event.key.slice(prefix.length), oldValue: event.oldValue, newValue: event.newValue }));
  });
}
