/** Keep login returns inside the app and prevent a login-to-login loop. */
export function safeNextPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/learn';
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return '/learn'; }
  if (decoded.startsWith('//') || [...decoded].some((character) => character === '\\' || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return '/learn';
  const path = new URL(decoded, 'https://local.invalid').pathname;
  return /^\/login(?:\/|$)/i.test(path) ? '/learn' : value;
}
