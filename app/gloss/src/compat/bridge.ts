export const ASSET_BASE = import.meta.env.BASE_URL;
export const HOST_BASE = ASSET_BASE.replace(/reader\/$/, '');
export let account = { name: '', signedIn: false };
const nativeFetch = window.fetch.bind(window);
let owner = '';
export const nativeIdbOpen = indexedDB.open.bind(indexedDB);
const baseStorage = window.localStorage;
export type MediaPrefs = { speechModel: string; imageModel: string; voice: string; effort: string };
export let mediaPrefs: MediaPrefs = { speechModel: '', imageModel: '', voice: 'alloy', effort: 'low' };
export function defaultEffort() {
  try { return JSON.parse(baseStorage.getItem('xiaobai-model-prefs-v1') || '{}')?.state?.effort || 'low'; } catch { return 'low'; }
}
export const saveMediaPrefs = (patch: Partial<MediaPrefs>) => { mediaPrefs = { ...mediaPrefs, ...patch }; localStorage.setItem('media-prefs', JSON.stringify(mediaPrefs)); };
export const hostMessage = (action: string) => window.parent.postMessage({ source: 'xiaobai-gloss', action }, location.origin);
export async function hostFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers); if (owner) headers.set('X-Xiaobai-User', encodeURIComponent(owner));
  return nativeFetch(`${HOST_BASE}api/${path}`, { ...init, headers });
}

export async function initializeBridge() {
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
    if (event.key === prefix + 'media-prefs') { try { mediaPrefs = { ...mediaPrefs, ...JSON.parse(event.newValue || '{}') }; } catch { /* Ignore malformed external writes. */ } }
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
        const prefs = JSON.parse(baseStorage.getItem('xiaobai-model-prefs-v1') || '{}')?.state || {};
        payload.model = url.pathname.includes('speak') ? mediaPrefs.speechModel : url.pathname.includes('covers') ? mediaPrefs.imageModel : payload.model || prefs.model;
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

export async function loadModels() {
  const [chatResponse, mediaResponse] = await Promise.all([hostFetch('model/catalog'), hostFetch('reader/gloss/media/catalog')]);
  const chat = await chatResponse.json(); const media = await mediaResponse.json();
  const prefs = JSON.parse(baseStorage.getItem('xiaobai-model-prefs-v1') || '{}')?.state || {};
  return { chat, media, model: prefs.model || chat.defaultModel, effort: prefs.effort || 'low' };
}
export function saveDefaultModel(model: string, effort: string) {
  baseStorage.setItem('xiaobai-model-prefs-v1', JSON.stringify({ state: { model, effort }, version: 0 }));
  hostMessage('model-changed');
}
