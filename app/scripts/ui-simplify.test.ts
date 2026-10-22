import assert from 'node:assert/strict';
import { shouldAutoOpenNotebook } from '../gloss/src/lib/notebook-policy';
import { DEFAULT_SETTINGS } from '../gloss/src/lib/settings';

assert.equal(DEFAULT_SETTINGS.notebook, false, 'fresh users should start with unobstructed reading');
for (const width of [320, 390, 768, 1079, 1080, 1440, 1920]) {
  assert.equal(shouldAutoOpenNotebook(true, false, width), false, `empty notebook must stay closed at ${width}`);
  assert.equal(shouldAutoOpenNotebook(false, true, width), false, 'never override an unpinned preference');
  assert.equal(shouldAutoOpenNotebook(true, true, width), width >= 1080, 'honor pinned notes only when there is room');
}
console.log('Unobstructed notebook defaults, narrow screens, empty books and saved preferences: passed.');
