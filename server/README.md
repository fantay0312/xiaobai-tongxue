# 小白同学生产网关

Node.js 20+ 网关，负责主站与独立管理后台静态入口、两套身份会话、腾讯验证码、邮箱/手机验证码、
商业套餐/权益/积分/CDK、LLM/视觉/语音代理，以及 PostgreSQL、Redis、COS 和 Resend 入站邮件。

生产入口：<https://xiaobai.tokentosea.com/>

管理后台：<https://xiaobai.tokentosea.com/admin/>

## 生产拓扑

```text
浏览器
  → 腾讯云 CDN（TLS 1.2/1.3、HTTP/2、OCSP、HSTS、HTTP→HTTPS 308）
  → nginx HTTPS 源站（校验 CDN 专用回源头，仅透传已验证的直接对端 IP）
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
- 更换手机号、邮箱或登录密码：先调用 `POST /api/account/verify-password` 验证当前密码，
  取得只绑定当前会话、账号、操作类型和凭据版本的 10 分钟一次性授权，再进入新凭据设置步骤；
  手机号/邮箱换绑仍需验证码，发码还要求腾讯图形验证码。
- 首次绑定与旧客户端保留当前密码提交路径；新个人中心只使用上述两步授权，不把授权写入 URL 或浏览器存储。
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
COS_MAX_OBJECT_BYTES=83886080

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

# 自定义课程 sidecar（真实值只放此 root 专属环境文件）
WK_BASE_URL=http://127.0.0.1:8180/api/v1
WK_API_KEY=...
WK_EMBEDDING_MODEL_ID=...
WK_SUMMARY_MODEL_ID=...
WK_MAX_FILE_MB=80
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

## 自定义课程接口

`/api/xb/*` 全部沿用现网登录会话、手机号/邮箱验证与账号访问门禁；WeKnora API Key 永不下发浏览器。

- `GET/POST /api/xb/courses`：列出或创建当前账号的自选课程；创建时在 sidecar 建独立 document/FAQ 双库。
- `GET/POST /api/xb/courses/:id/assets`：列出资料或 multipart 上传；单账号一次一份、全站最多两份并发。
- `GET/DELETE /api/xb/assets/:id`、`POST /api/xb/assets/:id/reparse`：查状态、删除与重新解析；开放编译任务或草稿引用的资料由 PostgreSQL 行锁阻止删除。
- `POST /api/xb/topics/compile`、`GET /api/xb/compile-jobs/:id`：从已完成资料异步编译课题。
- `GET /api/xb/courses/:id/compile-job`：刷新或重新进入页面时找回该课程唯一的编译中/待校订任务，避免草稿失联。
- `POST /api/xb/topics/:id/source-candidates`：只在该草稿原始资料范围内返回最多 5 个出处候选，不接受客户端传 knowledge ID。
- `POST /api/xb/topics/:topicId/evaluate`：完整 `groundTruth` 与纠正标准只在 BFF 内参与自定义课语义评估，浏览器只收到脱敏判定。
- `PUT/DELETE /api/xb/topics/:id/draft`、`POST /api/xb/topics/:id/publish`：校订、放弃或发布；放弃会原子归档草稿并关闭任务，发布课题与完成任务也在 PostgreSQL 内原子提交。
- `GET /api/xb/topics` 与 `GET /api/xb/topics/:topicId`：只返回学生视图，剥离 `groundTruth`、`correctionCriteria`、`probe.explanation`、源分块正文与 WeKnora 绑定。
- `GET /api/xb/topics/:topicId/teacher`：仅课程所有者在备课页按需读取完整稿；前端只放页面局部内存，不注册进学生运行时课题表。

Sidecar 编排与首次模型/API Key 初始化见 `deploy/weknora-sidecar/README.md`。未配置任一 `WK_*` 时功能整体返回 503，预埋课程与其它 API 不受影响；若开始配置但缺项，网关拒绝启动，避免出现可上传却不可检索的半成品。

用户上传的原文件由小白 BFF 先写既有私有 COS，路径按 `users/<user UUID>/custom-course-assets/<course UUID>/...` 隔离，并启用 COS 服务端 AES256 加密；数据库只保存私有 object key、SHA-256 与大小。写入后只 Range 读取 1 字节，从 `Content-Range` 核对对象总长度，再把字节副本交给 WeKnora（现有 CAM 未开放 `HeadObject`，因此不依赖该动作）。任一步失败都会补偿删除已写对象；删除资料时先确认没有课题引用，再同时清理 WeKnora 知识与 COS 原件。浏览器响应不返回 COS key。

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
