import { safeDiagnosticMessage } from '../email-delivery.mjs';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createAdminInvitationSender({
  apiKey,
  from,
  fetchImpl = globalThis.fetch,
  endpoint = 'https://api.resend.com/emails',
  timeoutMs = 10_000,
} = {}) {
  if (!apiKey || !from || typeof fetchImpl !== 'function') {
    throw new Error('admin-invitation-email-not-configured');
  }
  return async ({ email, activationUrl, idempotencyKey }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const safeUrl = escapeHtml(activationUrl);
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'User-Agent': 'xiaobai-admin/1.0',
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: '【小白同学】管理后台激活邀请',
          text: `你已受邀使用小白同学管理后台。请在邀请有效期内打开以下链接设置密码：${activationUrl}`,
          html: '<div style="font-family:system-ui,sans-serif;color:#24211d">'
            + '<h2>管理后台激活邀请</h2>'
            + '<p>请在邀请有效期内设置你的独立管理员密码。</p>'
            + `<p><a href="${safeUrl}">激活管理账号</a></p>`
            + '<p>若你不认识此邀请，请忽略本邮件。</p></div>',
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = safeDiagnosticMessage(await response.text().catch(() => ''));
        throw new Error(`admin-invitation-send-failed:${response.status}${detail ? `:${detail}` : ''}`);
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
