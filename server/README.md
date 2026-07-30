# 小白同学生产网关

Node.js 20+ 网关，负责主站与独立管理后台静态入口、两套身份会话、腾讯验证码、邮箱/手机验证码、
商业套餐/权益/积分/CDK、LLM/视觉/语音代理，以及 PostgreSQL、Redis、COS 和 Resend 入站邮件。

生产入口：<https://xiaobai.tokentosea.com/>

管理后台：<https://xiaobai.tokentosea.com/admin/>

## 生产拓扑

```text
浏览器
  → 腾讯云 CDN（TLS 1.2/1.3、HTTP/2、OCSP、HSTS、HTTP→HTTPS 308）
  → nginx HTTPS 源站（校验 CDN 专用回源头，透传真实客户端 IP）
  → Node 网关 127.0.0.1:8000
      ├─ PostgreSQL：用户、独立管理员/RBAC、套餐权益、积分账本、CDK、学习状态、来信
      ├─ Redis RESP2：短信 OTP、后台/商业入口限流及分布式配额（仅 xiaobai:*）
      ├─ 私有 COS：成绩单与来信附件（xiaobai/*，SSE-COS）
      ├─ 腾讯云 SMS：手机验证码
      └─ Resend：发信及 email.received Webhook
```

旧入口 `/xiaobai/` 只保留到新域名根路径的 308 跳转，不再承担业务。

## 鉴权契约

- 密码登录：`POST /api/login`，账号名或已验证邮箱 + 密码 + 登录验证码。
- 邮箱验证码登录：`POST /api/auth/email-code` → `POST /api/login/email`。
- 手机验证码登录：`POST /api/auth/sms-code` → `POST /api/login/phone`。
- 手机重置密码：`POST /api/auth/sms-code`（`purpose=reset-password`）→
  `POST /api/auth/password-reset/phone`。
- 邮箱重置密码仍作为次级兜底：
  `POST /api/auth/password-code` → `POST /api/auth/password-reset`。
- 绑定/换绑手机：`POST /api/account/phone-code` → `POST /api/account/phone`，
  两步都要求当前密码，发码还要求腾讯图形验证码。
- 未绑定手机号的历史用户可以取得受限会话，但所有业务 API 都返回
  `403 phone-verification-required`，直至完成短信验证绑定。
- 注册仍是邀请制并要求已验证邮箱；新注册用户登录后同样必须绑定手机号。
- 短信仅接受中国大陆手机号，后端统一保存为 `+86` E.164。
- 验证码 6 位、10 分钟有效、最多尝试 5 次、一次消费。Redis 仅保存 HMAC 摘要，不保存明文码。

`/api/me` 返回前端所需的能力与门禁状态：

```json
{
  "user": null,
  "emailBindingRequired": false,
  "phoneBindingRequired": false,
  "captchaAvailable": true,
  "emailAuthAvailable": true,
  "smsAuthAvailable": true
}
```

管理账号与主站用户完全分离：

- 后台 API 固定为 `/api/admin/v1`，使用独立管理员表、scrypt 密码、会话和
  `__Host-xiaobai_admin_sid` Cookie；没有管理员自助注册。
- `ADMIN_OWNER_EMAIL` 对应唯一 Owner。Owner 首次启动创建为待激活账号，并通过 Resend 收到
  一次性激活链接；后续管理账号也只能由 Owner 创建和预配角色。
- Cookie 是 HMAC 签名的 Owner/成员类别 envelope。随机、篡改或过期 Cookie 在查询会话表前失败；
  匿名、成员与 Owner 的本机并发和 Redis 配额相互隔离。
- 后台写操作要求精确 HTTPS Origin、会话 CSRF 和规范化变更原因。高风险业务写入前先持久化
  `attempt` 审计，成功或失败后再追加结果。
- 生产建议设置 `ADMIN_SESSION_TTL_HOURS=4`。首版尚未提供 TOTP/WebAuthn 或敏感操作 step-up。

## 数据存储

- `users`：稳定 UUID、用户名、scrypt 密码凭据和会话版本。
- `contacts`：邮箱/手机号的 HMAC 查询摘要与 AES-256-GCM 密文，数据库不保存联系方式明文。
- `learning_states`：按用户保存学习状态，使用 revision 做乐观并发。
- `user_files`：COS 键、内容类型、大小和 SHA-256；COS 桶保持私有。
- `inbound_emails`：经 Resend Webhook 签名验证后保存的来信正文和元数据。
- `auth_audit_events`：预留的鉴权审计表。
- `admin_*`：独立管理账号、会话、邀请、角色权限和不可变审计事件。
- `subscription_*`、`entitlement_*`、`commerce_features`：版本化套餐、订阅快照、权益和固定功能门禁。
- `point_*`：幂等双分录积分账本、余额投影和积分批次。
- `cdk_*`：版本化 HMAC 代码、冻结奖励、原子兑换，以及短期认证加密的幂等创建导出。

生产启动会幂等导入 `/var/lib/xiaobai` 中的旧用户 JSON 和学习状态；数据库已有记录时不会用旧文件
覆盖。旧目录继续保留，供发布回滚和迁移核验使用。

## 入站邮件

Webhook：`POST /api/webhooks/resend`

只接受 Resend `email.received` 事件，必须使用原始请求体通过 Svix 签名校验。收件地址
`<账号名>@mail.tokentosea.com` 会映射到同名账号；无法映射时进入生产配置指定的默认收件账号。
附件先用 Resend 元数据校验单件/总量并在 Redis 原子预留当日配额；拒额时不会下载附件。通过后
才流式下载并再次核对声明长度与实际长度，随后写入私有 COS，元数据与正文在 PostgreSQL
事务中提交。默认限制为：
单件附件 10 MiB、附件不超过 10 个且合计不超过 25 MiB、正文合计不超过 2 MiB、并发处理不超过
4 封；Redis 按北京时间自然日原子限制单用户 50 封/100 MiB、全站 200 封/500 MiB，同一
provider message ID 重试不会重复扣额，跨日重试仍归首次预留日。超额事件返回
`quota-rejected` 并停止入库；附件/正文超限、未知收件人等永久策略拒绝返回 HTTP 200
`policy-rejected`；下载长度不一致按完整性故障处理，仅它、Redis、PostgreSQL、COS、Resend 网络
故障或并发繁忙返回 503 让上游重试。零字节附件在下载前按无效元数据拒绝。

## 生产环境变量

只写入 `/etc/xiaobai/xiaobai.env`（`root:root`、`0600`），不要写进仓库、前端 `.env` 或日志。

```ini
NODE_ENV=production
STORAGE_REQUIRED=true

DATABASE_URL=postgresql://...
DATABASE_SSL_MODE=disable
DATABASE_ALLOW_PRIVATE_PLAINTEXT=true
CONTACT_ENCRYPTION_KEY=<32-byte base64>

REDIS_URL=redis://...
REDIS_ALLOW_PLAINTEXT=true
OTP_HMAC_KEY=<32-byte base64>

COS_SECRET_ID=...
COS_SECRET_KEY=...
COS_BUCKET=...
COS_REGION=ap-guangzhou
COS_PREFIX=xiaobai

RESEND_API_KEY=...
RESEND_FROM=小白同学 <noreply@mail.tokentosea.com>
RESEND_WEBHOOK_SECRET=...
RESEND_INBOUND_DOMAIN=mail.tokentosea.com
RESEND_INBOUND_USER=...
RESEND_MAX_ATTACHMENT_BYTES=10485760
RESEND_MAX_ATTACHMENTS=10
RESEND_MAX_TOTAL_ATTACHMENT_BYTES=26214400
RESEND_MAX_BODY_BYTES=2097152
RESEND_MAX_CONCURRENT=4
RESEND_USER_DAILY_MESSAGE_LIMIT=50
RESEND_USER_DAILY_BYTE_LIMIT=104857600
RESEND_GLOBAL_DAILY_MESSAGE_LIMIT=200
RESEND_GLOBAL_DAILY_BYTE_LIMIT=524288000

SMS_SDK_APP_ID=...
SMS_SIGN_NAME=...
SMS_TEMPLATE_ID=...
SMS_SECRET_ID=...
SMS_SECRET_KEY=...
SMS_REGION=ap-guangzhou

ADMIN_OWNER_EMAIL=owner@example.com
ADMIN_PUBLIC_ORIGIN=https://xiaobai.tokentosea.com
COMMERCE_PUBLIC_ORIGIN=https://xiaobai.tokentosea.com
ADMIN_TOKEN_HMAC_KEY=<32-byte base64>
ADMIN_SESSION_TTL_HOURS=4
ADMIN_INVITE_TTL_HOURS=24
ADMIN_BOOTSTRAP_RETRY_SECONDS=300
CDK_HMAC_KEY_VERSION=1
CDK_HMAC_KEY=<32-byte base64>
```

PostgreSQL 与 Redis 的明文连接只允许 RFC1918 私网地址，并且必须显式开启对应的
`*_ALLOW_PRIVATE_PLAINTEXT` 开关；公网明文地址仍会拒绝启动。Redis 客户端固定 RESP2，避免影响
同实例中的既有业务。

## 本地运行与验证

未配置生产存储环境变量时，网关自动使用 `/var/lib/xiaobai` 兼容文件存储，便于本地测试。

```bash
cd server
npm ci
npm run check
npm test
node index.mjs
```

前端根路径生产构建：

```bash
cd app
npm ci
npm run lint
npm run test:commerce
npm run simulate
npm run test:sync
npm run test:landing-data
npm run build
```

独立后台构建：

```bash
cd admin
npm ci
npm run test
npm run lint
npm run build
```

主站生产构建在代码层强制使用服务端代理，即使本地开发保留 `VITE_LLM_API_KEY` 也不会把它编译进
浏览器产物。发布前仍必须用已知秘密的精确值扫描 `dist/` 和服务器包，并确认其中不存在 API key、
数据库密码、短信密钥、本地 `.env` 或生产 `config.json`。

## 生产部署约束

- 服务目录：`/opt/xiaobai/{dist,admin/dist,server}`。
- 配置：`/opt/xiaobai/server/config.json`（`root:xiaobai`、`0640`）。
- 兼容状态与回滚备份：`/var/lib/xiaobai`。
- systemd：`xiaobai.service`，以非特权用户 `xiaobai` 运行，代码目录只读。
- 每次发布先完整备份当前 `/opt/xiaobai`、`/var/lib/xiaobai`、nginx 配置和环境文件，再整体替换
  runtime bundle；不能只上传 `index.mjs`。
- 先在 PostgreSQL 18 临时实例恢复生产备份并演练全部迁移，再在候选端口验证 PostgreSQL、
  Redis、COS、`/api/me`、`/api/commerce/catalog`、后台 401 边界与两套静态资源，最后将候选服务切换到
  `127.0.0.1:8000`；常规发布不变更 DNS，CDN CNAME 必须保持
  `xiaobai.tokentosea.com.cdn.dnsv1.com`，上线后仅按需刷新 CDN 缓存。
- 回滚必须同时恢复完整服务包、配置与兼容状态；数据库迁移采用只增不改的版本化 SQL。
- 当前后台与主站同源，身份域独立但浏览器安全 origin 尚未隔离；下一阶段应配置独立后台 DNS/TLS
  并将 `ADMIN_PUBLIC_ORIGIN` 切换到该 origin。
