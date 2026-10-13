import assert from 'node:assert/strict';
import { createScopedStorage } from '../src/lib/scopedStorage';
const data=new Map<string,string>([['main','protected']]);
const store={ get length(){return data.size;}, getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,String(v));},removeItem:(k:string)=>{data.delete(k);},clear:()=>data.clear(),key:(n:number)=>[...data.keys()][n]??null } as Storage;
const scoped=createScopedStorage(store,'test:');
assert.equal(scoped.getItem('main'),null);scoped.setItem('main','isolated');assert.equal(store.getItem('main'),'protected');assert.equal(scoped.getItem('main'),'isolated');assert.equal(scoped.length,1);assert.equal(scoped.key(0),'main');scoped.removeItem('main');assert.equal(store.getItem('main'),'protected');scoped.setItem('a','1');scoped.clear();assert.equal(data.size,1);
console.log('Prefix deployment storage is isolated from the main site.');
