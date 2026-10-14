import assert from 'node:assert/strict';
import { libraryPath, visibleLibraryEntries, type LibraryEntry } from '../src/lib/fileLibrary';
import { advanceAuthEpoch, isCurrentAccount } from '../src/lib/api';
assert.equal(isCurrentAccount('alice', {user:'alice',status:'authed'}, true), true);
advanceAuthEpoch();
assert.equal(isCurrentAccount('alice', {user:'alice',status:'authed'}, true), true, 'returning to a tab must not strand an in-flight library operation for the same account');
assert.equal(isCurrentAccount('alice', {user:'bob',status:'authed'}, true), false, 'a different account must never receive the previous library result');
assert.equal(isCurrentAccount('alice', {user:null,status:'anon'}, true), false);
assert.equal(isCurrentAccount('alice', {user:'alice',status:'authed'}, false), false, 'an unmounted session cannot write back');
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
Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout,clearTimeout}});
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

const { waitForLibraryFiles } = await import('../src/lib/libraryParsing');
let clock=0;const starts:string[]=[];
await waitForLibraryFiles(['a','b','c'],new AbortController().signal,{
  start:async(id)=>{starts.push(id);return {assetId:id,status:'pending'};},
  status:async(id)=>({assetId:id,status:'completed'}),
  now:()=>clock,timeoutMs:240,pollMs:100,
  wait:async(ms)=>{clock+=ms;},
});
assert.deepEqual(starts,['a','b','c']);assert.ok(clock>240,'each file gets its own deadline');
let attempts=0;
await waitForLibraryFiles(['one'],new AbortController().signal,{
  start:async()=>({assetId:'one',status:'pending'}),
  status:async()=>{if(++attempts===1)throw Object.assign(new Error('temporary'),{retryable:true,status:503});return {assetId:'one',status:'completed'};},
  wait:async()=>{},
});
assert.equal(attempts,2,'a transient status failure is retried');
const aborted=new AbortController();aborted.abort();
await assert.rejects(waitForLibraryFiles(['one'],aborted.signal,{start:async()=>{throw new Error('must not start');},status:async()=>({assetId:null,status:'completed'})}),{name:'AbortError'});
await assert.rejects(waitForLibraryFiles(['one'],new AbortController().signal,{start:async()=>({assetId:null,status:'failed',error:'bad document'}),status:async()=>({assetId:null,status:'completed'})}),/bad document/);
console.log('library parsing: bounded concurrency, per-file deadlines, transient retry and cancellation passed');
