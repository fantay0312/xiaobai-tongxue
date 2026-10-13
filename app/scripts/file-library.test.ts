import assert from 'node:assert/strict';
import { libraryPath, visibleLibraryEntries, type LibraryEntry } from '../src/lib/fileLibrary';
const base = { phase: 'ready' as const, createdAt: '', updatedAt: '', deletedAt: null, favorite: false };
const entries: LibraryEntry[] = [
  { ...base, id: 'f', kind: 'folder', name: '数学', parentId: null },
  { ...base, id: 'a', kind: 'file', name: '函数.txt', parentId: 'f', favorite: true },
  { ...base, id: 'b', kind: 'file', name: '函数.md', parentId: null },
  { ...base, id: 'c', kind: 'file', name: '回收.txt', parentId: null, deletedAt: '2026-10-14' },
];
assert.deepEqual(visibleLibraryEntries(entries, 'f', 'all', '').map((entry) => entry.id), ['a']);
assert.deepEqual(visibleLibraryEntries(entries, null, 'favorites', '函数').map((entry) => entry.id), ['a']);
assert.deepEqual(visibleLibraryEntries(entries, null, 'all', '函数').map((entry) => entry.id), ['a', 'b']);
assert.deepEqual(visibleLibraryEntries(entries, null, 'trash', '').map((entry) => entry.id), ['c']);
assert.deepEqual(libraryPath(entries, 'f').map((entry) => entry.name), ['数学']);
assert.equal(libraryPath([{ ...entries[0], parentId: 'f' }], 'f').length, 1, 'a malformed cycle cannot hang the breadcrumb');
console.log('file-library: folder view, scoped search, favorites, trash and breadcrumb cycle guard passed');
const { prepareLibrarySources } = await import('../src/lib/fileLibrary');
const originalFetch = globalThis.fetch;
const calls: string[] = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  if (String(url).endsWith('/parse')) return new Response(JSON.stringify({ status: 'completed', assetId: 'canonical' }));
  return new Response(JSON.stringify({ sources: [{ id: 'library:one', libraryFileId: 'one', title: 'lesson', content: 'verified', kind: 'library' }], evidence: [] }));
};
const prepared = await prepareLibrarySources(['one'], new AbortController().signal);
assert.equal(prepared.sources[0].content, 'verified');
assert.equal(calls.length, 2);
assert.ok(calls[0].endsWith('/files/one/parse'));
assert.ok(calls[1].endsWith('/sources'));
assert.ok(!calls.some((path) => path.endsWith('/files')), 'selecting an existing file never uploads it again');
globalThis.fetch = originalFetch;
