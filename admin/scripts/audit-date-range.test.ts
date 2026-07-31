import assert from 'node:assert/strict'
import { auditDateRangeForQuery } from '../src/lib/audit-date-range'

process.env.TZ = 'Asia/Shanghai'

assert.deepEqual(
  auditDateRangeForQuery('2026-07-30', '2026-07-30'),
  {
    from: '2026-07-29T16:00:00.000Z',
    to: '2026-07-30T15:59:59.999Z',
  },
  'a Shanghai calendar day must map to its local midnight boundaries',
)
assert.deepEqual(auditDateRangeForQuery('', ''), {})
assert.throws(
  () => auditDateRangeForQuery('2026-02-30', ''),
  /invalid-audit-local-date/,
)

console.log('audit local date range: ok')
