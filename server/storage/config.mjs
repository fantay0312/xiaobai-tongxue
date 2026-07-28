const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;

export function requireConfig(env, name) {
  const value = env?.[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`missing-config:${name}`);
  }
  if (/填入|replace[-_ ]?me|change[-_ ]?me|your[-_ ]?(?:key|secret|password)|<[^>]+>/i.test(value)) {
    throw new Error(`placeholder-config:${name}`);
  }
  return value.trim();
}

export function requireBase64Key(env, name) {
  const encoded = requireConfig(env, name);
  if (!BASE64_32_BYTES.test(encoded)) throw new Error(`invalid-config:${name}`);
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error(`invalid-config:${name}`);
  }
  return key;
}

export function requireUrl(env, name, protocols) {
  const value = requireConfig(env, name);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`invalid-config:${name}`);
  }
  if (!protocols.includes(parsed.protocol)) throw new Error(`invalid-config:${name}`);
  return value;
}

export function positiveInteger(value, fallback, label, maximum = Number.MAX_SAFE_INTEGER) {
  const selected = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(selected) || selected <= 0 || selected > maximum) {
    throw new Error(`invalid-config:${label}`);
  }
  return selected;
}
