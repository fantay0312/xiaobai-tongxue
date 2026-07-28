export function mapRow(row) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
    value,
  ]));
}

export function requireText(value, label, maximum = 1_000) {
  if (typeof value !== 'string') throw new Error(`invalid-${label}`);
  const normalized = value.trim().normalize('NFC');
  if (normalized === '' || normalized.length > maximum || /[\u0000]/.test(normalized)) {
    throw new Error(`invalid-${label}`);
  }
  return normalized;
}

export function optionalText(value, label, maximum = 1_000) {
  if (value === undefined || value === null) return null;
  return requireText(value, label, maximum);
}

export function jsonValue(value, label) {
  if (value === undefined) throw new Error(`invalid-${label}`);
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error(`invalid-${label}`);
  return encoded;
}

export function validDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid-${label}`);
  return date;
}
