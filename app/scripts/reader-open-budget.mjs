import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const warm = rows.filter((row) => row.kind === 'reading-click' && row.reusedFrame);
assert.ok(warm.length >= 30, 'collect at least 30 real warm switches');
assert.ok(warm.every((row) => Number.isFinite(row.ms)), 'all switches must finish with visible content');
const sorted = warm.map((row) => row.ms).sort((a, b) => a - b);
const percentile = (p) => sorted[Math.ceil(sorted.length * p) - 1];
const result = { samples: sorted.length, p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1), budget: 100 };
console.log(JSON.stringify(result));
assert.ok(result.p95 <= result.budget, 'warm reading p95 must be <=100ms');
