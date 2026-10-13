import assert from 'node:assert/strict';
import { retryModule, isModuleLoadFailure } from '../src/lib/moduleRecovery';

let attempts = 0;
const result = await retryModule(async () => {
  if (++attempts < 3) throw new TypeError('Failed to fetch dynamically imported module: /assets/page.js');
  return { default: 'loaded' };
});
assert.equal(result.default, 'loaded');
assert.equal(attempts, 3);
attempts = 0;
await assert.rejects(retryModule(async () => { attempts++; throw new Error('render bug'); }), /render bug/);
assert.equal(attempts, 1, 'code errors must not become retry loops');
attempts = 0;
await assert.rejects(retryModule(async () => {
  attempts++; throw new TypeError('Failed to fetch dynamically imported module');
}));
assert.equal(attempts, 3, 'persistent network errors must stop after bounded retries');
assert.equal(isModuleLoadFailure(new Error('Loading chunk 12 failed')), true);
assert.equal(isModuleLoadFailure(new Error('permission denied')), false);
console.log('module loading recovery: ok');
