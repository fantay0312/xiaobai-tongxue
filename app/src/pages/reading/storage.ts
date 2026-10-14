import { readerApi } from './api';
import { DEFAULT_PREFS, type ReaderDocument, type ReaderPrefs, type ReaderSummary } from './types';
const base = import.meta.env.BASE_URL;
let database: Promise<IDBDatabase> | undefined;
function db() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('xiaobai-reader-v1', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('documents'); request.result.createObjectStore('pdfs'); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => { database = undefined; reject(request.error); };
  });
  return database;
}
function key(owner: string, id: string) { return `${encodeURIComponent(base)}:${encodeURIComponent(owner)}:${id}`; }
async function run<T>(store: string, mode: IDBTransactionMode, work: (data: IDBObjectStore) => IDBRequest): Promise<T> {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(store, mode); const request = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result as T); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export async function localDocuments(owner: string): Promise<ReaderDocument[]> {
  const keys = await run<IDBValidKey[]>('documents', 'readonly', (store) => store.getAllKeys());
  return Promise.all(keys.filter((id) => String(id).startsWith(key(owner, ''))).map((id) => run<ReaderDocument>('documents', 'readonly', (store) => store.get(id))));
}
export const localDocument = (owner: string, id: string) => run<ReaderDocument | undefined>('documents', 'readonly', (store) => store.get(key(owner, id)));
export const saveLocal = (owner: string, doc: ReaderDocument) => run('documents', 'readwrite', (store) => store.put(doc, key(owner, doc.id)));
export const savePdf = (owner: string, id: string, blob: Blob) => run('pdfs', 'readwrite', (store) => store.put(blob, key(owner, id)));
export const loadPdf = (owner: string, id: string) => run<Blob | undefined>('pdfs', 'readonly', (store) => store.get(key(owner, id)));
export async function listCloud() { return (await readerApi<{ documents: ReaderSummary[] }>('/documents')).documents; }
export const fetchCloud = (id: string) => readerApi<ReaderDocument>(`/documents/${id}`);
export async function saveCloud(doc: ReaderDocument) {
  return (await readerApi<{ revision: number }>(`/documents/${doc.id}`, { document: doc, revision: doc.revision ?? 0 }, 'PUT')).revision;
}
export function readPrefs(owner: string): ReaderPrefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(key(owner, 'prefs')) || '{}') }; } catch { return { ...DEFAULT_PREFS }; }
}
export function writePrefs(owner: string, prefs: ReaderPrefs) { localStorage.setItem(key(owner, 'prefs'), JSON.stringify(prefs)); }
