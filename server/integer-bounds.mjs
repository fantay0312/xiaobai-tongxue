export const PG_INT64_MAX = 9_223_372_036_854_775_807n;
export const PG_INT64_MIN = -9_223_372_036_854_775_808n;

export function pgBigIntString(value, label, {
  allowNegative = false,
  positive = false,
  nonZero = false,
  symmetric = false,
} = {}) {
  const pattern = allowNegative ? /^-?\d+$/ : /^\d+$/;
  const maximumLength = allowNegative ? 20 : 19;
  if (typeof value !== 'string' || value.length > maximumLength || !pattern.test(value)) {
    throw new Error(`invalid-${label}`);
  }
  const parsed = BigInt(value);
  const minimum = symmetric ? -PG_INT64_MAX : PG_INT64_MIN;
  if (parsed > PG_INT64_MAX || parsed < minimum
      || (positive && parsed <= 0n)
      || (nonZero && parsed === 0n)) {
    throw new Error(`invalid-${label}`);
  }
  return parsed.toString();
}

export function isPgBigInt(value) {
  return value >= PG_INT64_MIN && value <= PG_INT64_MAX;
}
