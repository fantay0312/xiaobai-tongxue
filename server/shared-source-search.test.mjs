import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSelectedSources } from './custom-content/source-search.mjs';
test('shared sources search their original knowledge bases and reject forged or unselected hits', async () => {
  const calls=[];
  const sources=[{id:'a',wkKbId:'kb-a',wkKnowledgeId:'k-a'},{id:'b',wkKbId:'kb-b',wkKnowledgeId:'k-b'}];
  const chunks=[{id:'c-a',content:'TRUSTED_A'},{id:'c-b',content:'TRUSTED_B'}];
  const client={search:async args=>{calls.push(args);return[{id:args.kbId==='kb-a'?'c-a':'c-b',content:'FORGED_REPLACEMENT'},{id:'foreign',content:'secret'}];}};
  const found=await searchSelectedSources(client,{assets:sources,fallbackKb:'wrong-course-kb',query:'test',chunks,requestId:'test'});
  assert.deepEqual(calls.map(x=>x.kbId),['kb-a','kb-b']);
  assert.deepEqual(found,chunks); assert.doesNotMatch(JSON.stringify(found),/FORGED|secret/);
});
