function emailCopy(purpose, code) {
  const action = purpose === 'register' ? '注册'
    : purpose === 'bind' ? '绑定邮箱'
      : purpose === 'change-email' ? '换绑邮箱'
        : purpose === 'reset-password' ? '重置密码' : '登录';
  const description = purpose === 'bind'
    ? '你正在为小白同学账号绑定邮箱。'
    : purpose === 'change-email'
      ? '你正在为小白同学账号更换验证邮箱。'
      : purpose === 'reset-password'
        ? '你正在重置小白同学账号密码。'
        : `你正在${action}小白同学。`;
  const subject = `【小白同学】${action}验证码`;
  const text = `${description}验证码：${code}。验证码 10 分钟内有效，请勿转告他人。`;
  const html = `<div style="font-family:system-ui,sans-serif;color:#24211d">`
    + `<p>${description}</p>`
    + `<p style="font-size:30px;letter-spacing:8px;font-weight:700">${code}</p>`
    + '<p>验证码 10 分钟内有效，请勿转告他人。</p></div>';
  return { subject, text, html };
}

export function safeDiagnosticMessage(value, limit = 200) {
  return String(value ?? '')
    .replace(
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi,
      '[redacted-email]',
    )
    .replace(/\b(?:re|sk)[_-][A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(
      /(["']?(?:password|token|code|authorization|cookie|api[-_ ]?key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi,
      '$1[redacted]',
    )
    .replace(/\b\d{6}\b/g, '[redacted-code]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

export function emailSendErrorMessage(error) {
  const message = error instanceof Error ? error.message : 'email-send-failed';
  return safeDiagnosticMessage(message, 240) || 'email-send-failed';
}

export function createResendSender(options) {
  const {
    apiKey,
    from,
    endpoint = 'https://api.resend.com/emails',
    fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
  } = options ?? {};
  if (!apiKey || !from || typeof fetchImpl !== 'function') throw new Error('resend-not-configured');

  return async ({ email, code, purpose, idempotencyKey }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'User-Agent': 'xiaobai-gateway/1.0',
        },
        body: JSON.stringify({ from, to: [email], ...emailCopy(purpose, code) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const rawDetail = await response.text().catch(() => '');
        const detail = safeDiagnosticMessage(rawDetail);
        throw new Error(`resend-request-failed:${response.status}${detail ? `:${detail}` : ''}`);
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
