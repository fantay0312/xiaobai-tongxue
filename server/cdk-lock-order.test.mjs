import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('CDK and admin subscription bonuses acquire user before wallet locks', async () => {
  const service = await readFile(
    new URL('./commerce/service.mjs', import.meta.url),
    'utf8',
  );
  const rewards = service.slice(
    service.indexOf('async function issueFrozenRewards'),
    service.indexOf('async function redeemLockedCode'),
  );
  const subscription = rewards.indexOf('createFrozenSubscription');
  const points = rewards.indexOf('tx.points.post');
  assert.ok(subscription > 0);
  assert.ok(points > subscription);
});
