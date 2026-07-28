import test from 'node:test';
import assert from 'node:assert/strict';
import { commitThenRefresh } from './committed-mutation.mjs';

test('commit failure remains recoverable and never invokes the fail-stop handler', async () => {
  let fatalCalls = 0;
  await assert.rejects(
    commitThenRefresh({
      commit: async () => { throw new Error('commit-failed'); },
      refresh: async () => 'unused',
      onRefreshFailure: () => { fatalCalls += 1; },
    }),
    /commit-failed/,
  );
  assert.equal(fatalCalls, 0);
});

test('post-commit refresh failure invokes fail-stop before propagating', async () => {
  let fatalError;
  await assert.rejects(
    commitThenRefresh({
      commit: async () => 'committed',
      refresh: async () => { throw new Error('reload-failed'); },
      onRefreshFailure: (error) => { fatalError = error; },
    }),
    /reload-failed/,
  );
  assert.equal(fatalError?.message, 'reload-failed');
});

test('successful commit and refresh return both authoritative results', async () => {
  assert.deepEqual(await commitThenRefresh({
    commit: async () => 'committed',
    refresh: async () => 'refreshed',
    onRefreshFailure: () => assert.fail('unexpected fail-stop'),
  }), {
    committed: 'committed',
    refreshed: 'refreshed',
  });
});
