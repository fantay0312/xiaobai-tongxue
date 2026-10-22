import { setReaderVisible } from './visibility';
export const ASSET_BASE = import.meta.env?.BASE_URL ?? '/';
export const HOST_BASE = ASSET_BASE.replace(/reader\/$/, '');
export let account = { name: '', signedIn: false };
const nativeFetch = window.fetch.bind(window);
let owner = '';
export const nativeIdbOpen = indexedDB.open.bind(indexedDB);
const baseStorage = window.localStorage;
export type MediaPrefs = { speechModel: string; imageModel: string; voice: string; effort: string };
export let mediaPrefs: MediaPrefs = { speechModel: '', imageModel: '', voice: 'alloy', effort: 'low' };
let imageCatalog: { images?: { id: string }[]; defaultImage?: string } = {};
export function effectiveImageModel() {
  if (!imageCatalog.images) return mediaPrefs.imageModel;
  return imageCatalog.images.some((m) => m.id === mediaPrefs.imageModel) ? mediaPrefs.imageModel : imageCatalog.defaultImage || '';
}
export function defaultEffort() {
  try { return JSON.parse(baseStorage.getItem('xiaobai-model-prefs-v1') || '{}')?.state?.effort || 'low'; } catch { return 'low'; }
}
export const saveMediaPrefs = (patch: Partial<MediaPrefs>) => { mediaPrefs = { ...mediaPrefs, ...patch }; localStorage.setItem('media-prefs', JSON.stringify(mediaPrefs)); window.dispatchEvent(new CustomEvent('gloss:media-prefs-change')); };
export const hostMessage = (action: string) => window.parent.postMessage({ source: 'xiaobai-gloss', action }, location.origin);
export async function hostFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers); if (owner) headers.set('X-Xiaobai-User', encodeURIComponent(owner));
  return nativeFetch(`${HOST_BASE}api/${path}`, { ...init, headers });
}

export async function initializeBridge() {
  window.addEventListener('message', (event) => {
    if (event.origin === location.origin && event.source === window.parent && event.data?.source === 'xiaobai-host'
      && event.data.action === 'visibility' && typeof event.data.active === 'boolean') setReaderVisible(event.data.active);
  });
  const response = await nativeFetch(`${HOST_BASE}api/me`); const me = await response.json();
  if (!response.ok || !me.user?.name || me.emailBindingRequired || me.phoneBindingRequired) { hostMessage('login'); throw new Error('请先登录后使用阅读。'); }
  owner = me.user.name; account = { name: owner, signedIn: true };
  const prefix = `xiaobai-gloss:${encodeURIComponent(HOST_BASE)}:${encodeURIComponent(owner)}:`;
  const scoped = {
    getItem: (k: string) => baseStorage.getItem(prefix + k), setItem: (k: string, v: string) => baseStorage.setItem(prefix + k, v),
    removeItem: (k: string) => baseStorage.removeItem(prefix + k), key: (n: number) => Object.keys(baseStorage).filter((k) => k.startsWith(prefix))[n]?.slice(prefix.length) ?? null,
    clear: () => Object.keys(baseStorage).filter((k) => k.startsWith(prefix)).forEach((k) => baseStorage.removeItem(k)),
    get length() { return Object.keys(baseStorage).filter((k) => k.startsWith(prefix)).length; },
  };
  Object.defineProperty(window, 'localStorage', { value: scoped, configurable: true });
  const idbOpen = nativeIdbOpen;
  indexedDB.open = (name: string, version?: number) => idbOpen(prefix + name, version);
  try { mediaPrefs = { ...mediaPrefs, ...JSON.parse(localStorage.getItem('media-prefs') || '{}') }; } catch { /* Defaults remain. */ }
  window.addEventListener('storage', (event) => {
    if (event.key === prefix + 'media-prefs') { try { mediaPrefs = { ...mediaPrefs, ...JSON.parse(event.newValue || '{}') }; window.dispatchEvent(new CustomEvent('gloss:media-prefs-change')); } catch { /* Ignore malformed external writes. */ } }
    if (event.key === 'xiaobai-model-prefs-v1') { try { const prefs = JSON.parse(event.newValue || '{}')?.state; if (prefs?.model) window.dispatchEvent(new CustomEvent('gloss:default-model-change', { detail: prefs })); } catch { /* Keep the current valid choice. */ } }
  });
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      const headers = new Headers(init?.headers); headers.delete('Authorization'); headers.set('X-Xiaobai-User', encodeURIComponent(owner));
      let body = init?.body;
      if (typeof body === 'string' && headers.get('Content-Type')?.includes('application/json')) {
        const payload = JSON.parse(body); delete payload.apiKey;
        // Reading can paint before catalog discovery; an AI request still waits for
        // the authoritative model so a stale local alias is never sent upstream.
        const catalog = /^\/api\/(ask|brief|shelve|pdf-page|pdf-careful)$/.test(url.pathname) ? await loadChatModels() : null;
        const prefs = JSON.parse(baseStorage.getItem('xiaobai-model-prefs-v1') || '{}')?.state || {};
        payload.model = url.pathname.includes('speak') ? mediaPrefs.speechModel : url.pathname.includes('covers') ? effectiveImageModel() : catalog?.model || payload.model || prefs.model;
        payload.voice = mediaPrefs.voice; payload.effort = prefs.effort || 'low';
        body = JSON.stringify(payload);
      }
      const result = await nativeFetch(`${HOST_BASE}api/reader/gloss/${url.pathname.slice(5)}${url.search}`, { ...init, headers, body });
      if (result.status === 401) hostMessage('login');
      return result;
    }
    return nativeFetch(input, init);
  };
  return owner;
}

type ChatCatalog = { models: { id: string; label: string; description?: string }[]; defaultModel: string };
let chatRequest: Promise<ChatCatalog> | null = null;
let mediaRequest: Promise<typeof imageCatalog> | null = null;

async function catalogJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await hostFetch(path, { signal: controller.signal });
    if (!response.ok) throw new Error('模型目录暂时无法读取，请稍后重试。');
    return await response.json() as T;
  } finally { window.clearTimeout(timeout); }
}

export async function loadChatModels() {
  chatRequest ??= catalogJson<ChatCatalog>('model/catalog').catch((error) => { chatRequest = null; throw error; });
  const chat = await chatRequest;
  const prefs = JSON.parse(baseStorage.getItem('xiaobai-model-prefs-v1') || '{}')?.state || {};
  const model = chat.models.some((entry) => entry.id === prefs.model) ? prefs.model : chat.defaultModel;
  return { chat, model, effort: prefs.effort || 'low' };
}

export async function loadMediaModels() {
  mediaRequest ??= catalogJson<typeof imageCatalog>('reader/gloss/media/catalog').catch((error) => { mediaRequest = null; throw error; });
  imageCatalog = await mediaRequest;
  return imageCatalog;
}

export async function loadModels() {
  const [chat, media] = await Promise.all([loadChatModels(), loadMediaModels()]);
  return { ...chat, media };
}
export function saveDefaultModel(model: string, effort: string) {
  baseStorage.setItem('xiaobai-model-prefs-v1', JSON.stringify({ state: { model, effort }, version: 0 }));
  hostMessage('model-changed');
}
