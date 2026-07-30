const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })

export function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date)
}

export function formatInteger(value: string | number): string {
  if (typeof value === 'number') return integerFormatter.format(value)
  if (!/^-?\d+$/.test(value)) return value || '0'
  return BigInt(value).toLocaleString('zh-CN')
}

export function minorToMajor(amountMinor: string): string {
  if (!/^-?\d+$/.test(amountMinor)) return '0.00'
  const negative = amountMinor.startsWith('-')
  const digits = (negative ? amountMinor.slice(1) : amountMinor).padStart(3, '0')
  const whole = digits.slice(0, -2).replace(/^0+(?=\d)/, '')
  const fraction = digits.slice(-2)
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

export function majorToMinor(value: string): string | null {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null
  const [whole = '0', fraction = ''] = normalized.split('.')
  return `${BigInt(whole)}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '')
}

export function formatMoney(amountMinor: string, currency = 'CNY'): string {
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `
  const [whole, fraction] = minorToMajor(amountMinor).split('.')
  const grouped = formatInteger(whole ?? '0')
  return `${symbol}${grouped}.${fraction ?? '00'}`
}

export function downloadLines(filename: string, lines: string[]): void {
  const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
