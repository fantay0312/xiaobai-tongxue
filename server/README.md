# 小白同学 · 生产网关

零业务依赖 Node(≥18)网关:静态托管前端 + 密码/邮箱验证码会话 + LLM 代理 +
语音转写代理 + 按账号学习存档。
**DeepSeek、OpenRouter(ASR)与 Resend 密钥只存服务器，永远不出现在前端产物里。**

## 当前部署(2026-07-06,HTTPS 入口 2026-07-13 起)

- 服务器:106.53.163.57(Debian 13,腾讯云)
- **主入口(推荐)**:`https://tradingvane.com/xiaobai/` —— 复用同机 tradingvane.com 的
  Let's Encrypt 证书(`/etc/nginx/sites-available/tradingvane.com` 443 块追加了
  `/xiaobai/` location,改前备份 `tradingvane.com.bak-xiaobai`)。
  **语音输入只在这个入口可用**(浏览器只在安全上下文开放麦克风)
- 旧入口(保留):`http://106.53.163.57/xiaobai/`(nginx `location /xiaobai/` 反代 → 本机 `127.0.0.1:8000`);
  HTTP 明文,无语音;两个入口是不同 origin,浏览器本地缓存互不相通,但服务器档跟账号走,登录即还原
- 网关直听 `0.0.0.0:8000`,但云安全组未放行 8000;若在腾讯云控制台放行,
  `http://106.53.163.57:8000/` 也可直接访问(网关 `pathPrefix` 对两种入口同时兼容)
- 服务:`systemd` 单元 `xiaobai.service`(开机自启,`User=xiaobai` 非特权用户)
- 目录:`/opt/xiaobai/{dist,server}`;配置 `/opt/xiaobai/server/config.json`(chmod 600)
- nginx 变更:仅向 `/etc/nginx/conf.d/tradingvane-ip.conf` **追加**了 `/xiaobai/` location,
  原站点不受影响;改前备份在同目录 `tradingvane-ip.conf.bak-xiaobai`

## 鉴权模型

- 默认密码通道:`POST /api/login {identifier,password}`，`identifier` 可以是账号名或已验证邮箱，
  邮箱按去空格、忽略大小写后的规范值匹配；旧客户端的 `{username,password}` 字段继续兼容。
  未绑定邮箱、未知邮箱和错误密码统一返回 `401 invalid-credentials`，不暴露邮箱归属。
  没有已验证邮箱的预置账号或旧注册账号按账号名密码登录成功后只取得
  **restricted session**，响应与 `/api/me` 都带
  `emailBindingRequired:true`、`emailMasked:null`，必须先完成邮箱绑定：
  - `POST /api/account/email-code {email,currentPassword}`；
  - `POST /api/account/email {email,code,currentPassword}`。
  两个接口都要求 HTTPS、当前 restricted Cookie 以及与 Cookie 账号一致的
  `X-Xiaobai-User`。绑定码除邮箱与 `purpose=bind` 外还绑定账号 canonical name，不能跨账号消费。
  已占用邮箱与可用邮箱的发码响应保持一致：占用时不发信、不创建验证码，但仍消耗同一组
  邮箱/IP/全局发送窗口与冷却；完成绑定也不返回邮箱归属错误。绑定成功先原子持久化，
  再撤销该账号全部旧 restricted SID 并签发新 SID。
- 已验证邮箱的账号复用同两个接口执行换绑。服务端自动改用独立
  `purpose=change-email`，换绑码同时绑定 canonical name、目标新邮箱与发码时的旧邮箱版本；
  任何一次换绑成功后，基于更旧邮箱状态签发的码都不能再消费。发码阶段的同邮箱、可用邮箱与
  他人已占用邮箱保持同形 `200`：同邮箱真实发码给当前邮箱，他人已占用时抑制发信。同邮箱的
  有效码仅在最终提交时以中性 `409 email-unavailable` 拒绝，不写盘、不换 SID。换绑持久化
  成功后撤销该账号全部旧 SID，只签发一个新 SID。
- 邮箱验证码:
  - `POST /api/auth/email-code {email,purpose,invite?}`，`purpose` 仅允许 `login | register`;
    注册发码必须同时提交正确 `invite`。
  - `POST /api/login/email {email,code}` 验证成功后发同一种会话 Cookie。
  - 未注册邮箱请求登录码仍返回同形成功响应并进入同一限流，但不实际发信;
    服务端加近似发信延迟，减少账号枚举与邮件轰炸。
  - 验证码是 6 位数字、10 分钟有效、最多试 5 次、一次消费;重发成功后旧码失效。
    内存仅存进程随机 HMAC 摘要，不存明文码;服务重启后待验证码全部失效。
- 找回密码与修改密码:
  - `POST /api/auth/password-code {email}` 只向已绑定的验证邮箱发送重置码；
    未知邮箱与已知邮箱保持同形、同限流和统一最低响应延迟，不暴露账号归属。
  - `POST /api/auth/password-reset {email,code,newPassword}` 校验邮箱码后重置密码，
    撤销该账号全部旧会话并签发新会话。
  - `POST /api/account/password {currentPassword,newPassword}` 要求当前 Cookie 会话、
    匹配的 `X-Xiaobai-User` 与正确当前密码；成功后同样撤销其他旧会话。
  - 新密码统一限制 8–128 位。注册账号直接原子更新
    `registered-users.json`；只读 `config.users` 账号写入 `password-overrides.json`，
    重启后先严格校验再叠加。
- 注册仍是邀请制，但**服务端强制同时验证邮箱码**:
  `POST /api/register {username,password,email,code,invite}`。`inviteCode`、Resend key 或发件人
  任意一项缺失时注册 fail-closed 关闭，不会降级成免验证码注册。
- 注册规则:用户名 2-20 字(汉字/字母/数字/`_`/`-`)、用户名和规范化邮箱各自全站唯一;
  密码 8-128 位。密码用 scrypt 落盘，邮箱记录 `emailVerifiedAt`，文件仍是
  `dataDir/registered-users.json`(0600，tmp+rename 原子写)。
- `/api/me` 保留 `user/authRequired`，并返回
  `emailBindingRequired/emailMasked/emailAuthAvailable/registrationAvailable/inviteRequired`
  供前端按服务器真实能力显示入口。`emailMasked` 只向本人会话提供脱敏值。
- 登录发 HttpOnly Cookie(`xiaobai_sid`,SameSite=Lax,72h)。仅信本机 nginx 的
  `X-Forwarded-Proto:https`。默认对密码登录、邮箱登录、注册/登录发码、绑定发码/完成绑定
  fail-closed 拒绝非 HTTPS(`426 https-required`)，生产会话始终带 `Secure`;
  只有本地/测试显式配 `allowInsecureAuth:true` 才放行 HTTP。
- 密码 scrypt 均走异步线程池;未知用户也执行同参数 dummy scrypt。鉴权请求先做
  单 IP 30 次/分钟入场限流，通过后才消耗全局 120 次/分钟额度；并发槽独立限 8，
  鉴权请求体 5 秒绝对超时，避免单一来源或慢速请求拖垮全局登录。
- `/api/chat` `/api/asr` `/api/state` 均必须登录且已验证邮箱；restricted session 一律返回
  `403 email-verification-required`，只能访问 `/api/me`、登出与上述两个绑定接口。
- `/api/chat` `/api/asr` `/api/state` 还必须带 ASCII 请求头
  `X-Xiaobai-User: encodeURIComponent(当前用户名)`;解码后与 Cookie 会话账号不一致则
  `401 identity-mismatch`，阻止共享 Cookie 的跨标签页旧账号状态污染新账号。
- `/api/asr`(2026-07-13 起):语音转写代理。浏览器上传 WAV 原始体(≤8MB),
  网关持 `asrApiKey` 转发 `asrUpstreamUrl`(默认 OpenRouter `/v1/audio/transcriptions`,
  模型 `asrModel` 默认 qwen3-asr-flash);`asrApiKey` 为空 = 功能关闭(503)
- `/api/state`(2026-07-13 起):按账号学习存档。GET 取回 / PUT 覆盖(整包 LWW),
  落盘 `dataDir/userdata/<sha256(账号小写)>.json`(0600 原子写,上限 2MB)——
  换设备登录同一账号,学习记录自动还原
- 限流:登录失败按真实客户端 IP(仅信任本机 nginx 的 X-Real-IP)10 次/15 分钟，
  成功登录不清空该 IP 尚未到期的失败历史，无法用已知有效凭据循环重置;
  注册尝试(成败都计)8 次/15 分钟/IP,邀请码恒时比对,注册总量封顶 500;
  发码有邮箱 60s 冷却、5 次/小时，IP 10 次/小时，全局 4 次/秒、200 次/小时、500 次/日;
  多维限流先整体检查再原子计数，失败维度不污染其他额度;
  验码还有 IP 窗口与容量上限，IPv6 按 `/64` 聚合。
  聊天按**账号名** 12 次/分钟 + 400 次/日(重复登录铸新会话无法绕过);
  转写按账号 10 次/分钟 + 300 次/日;存档读写按账号 30 次/分钟
- **部署注意**:systemd 单元 `ProtectSystem=strict` 把 `/opt/xiaobai` 挂只读,
  注册状态与预置账号邮箱 overlay 写在 `StateDirectory=xiaobai`（即
  `/var/lib/xiaobai/{registered-users.json,email-bindings.json,password-overrides.json}`），
  生产 `config.json` 必须配 `"dataDir": "/var/lib/xiaobai"`;不配 dataDir 时回落
  网关同目录(本地裸跑用)。启动时用独立 probe 文件验证写权限，不重写真实注册表;
  `config.users`、`registered-users.json`、`email-bindings.json` 与 `password-overrides.json`
  必须是合法数组，任一坏行、
  悬空 overlay、规范化用户名/邮箱重复都会 fatal 拒绝启动，不再静默丢弃账号。

### 旧账号绑定数据迁移

- `registered-users.json` 的旧行可以没有 `email/emailVerifiedAt`；完成绑定后原行会原子升级为：
  `{name,salt,hash,...,email,emailVerifiedAt}`。
- `config.users` 视为只读，绑定或换绑结果单独写入 `email-bindings.json`：
  `[{"name":"原账号名","email":"规范化邮箱","emailVerifiedAt":"ISO-8601 时间"}]`。
  启动时 overlay 只允许指向现存预置账号，并与注册用户一起做全局邮箱唯一性校验。
  overlay 是该预置账号的运行时权威邮箱，因此即使 `config.users` 原行已有验证邮箱，换绑后也会由
  overlay 覆盖；重启后仍使用新邮箱并重做全局唯一性校验。
- `config.users` 的密码修改不回写只读配置，而是原子写入
  `password-overrides.json`：`[{name,salt,hash,changedAt}]`。覆盖只能指向现存预置账号，
  名称、scrypt 凭据、ISO 时间或对象形状任一异常都会 fail-closed 拒绝启动。
- 任一用户只要配置了 `email` 就必须同时有合法 `emailVerifiedAt`；不再把“管理员写了邮箱但
  没有验证时间”的账号当成已验证。旧配置若已有这类行，发布前应删除该 `email` 让用户登录后补绑，
  或在确认归属后同时补上真实验证时间。

## Resend 配置

- 发件人使用已验证发送子域:`小白同学 <noreply@mail.tradingvane.com>`。
- 程序优先读取 `RESEND_API_KEY` / `RESEND_FROM`，再回落 `config.json` 的
  `resendApiKey` / `resendFrom`。两处都不配默认密钥，配置不完整就关闭邮箱鉴权。
- 生产 systemd 单元可选读 `/etc/xiaobai/xiaobai.env`:

```ini
RESEND_API_KEY=<仅发送权限且限制到发送域的 API Key>
RESEND_FROM="小白同学 <noreply@mail.tradingvane.com>"
```

```bash
chown root:root /etc/xiaobai/xiaobai.env
chmod 600 /etc/xiaobai/xiaobai.env
```

不要从 `doc/` 读取密钥，不要把密钥写入前端 `.env`、测试、日志或 Git。发信固定走
`https://api.resend.com/emails`，并附 `User-Agent` 和单次 `Idempotency-Key`。

## HTTPS 生产门禁

`config.example.json` 的 `allowInsecureAuth` 默认 `false`。本地直连 HTTP 联调时才可在本机
`config.json` 显式改为 `true`，严禁把该开关带到生产。nginx 应同时完成 HTTP 跳转、协议传递和 HSTS:

```nginx
server {
    listen 80;
    server_name tradingvane.com;
    return 301 https://$host$request_uri;
}

# tradingvane.com 的 443 server 块
add_header Strict-Transport-Security "max-age=31536000" always;
location /xiaobai/ {
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:8000;
}
```

先确认整个域名始终可用 HTTPS 再开长时间 HSTS;本配置未加 `includeSubDomains`，避免误锁尚未上线 TLS 的子域。

## 运维速查

```bash
# 状态 / 日志
systemctl status xiaobai
journalctl -u xiaobai -f

# 新增账号:本地生成哈希 → 填进服务器 config.json 的 users → 重启
node index.mjs hash '新密码'      # 输出 {name,salt,hash},把 name 改成账号名
systemctl restart xiaobai

# 换 DeepSeek 密钥:改 config.json 的 apiKey → systemctl restart xiaobai
# 换 ASR(OpenRouter)密钥:改 config.json 的 asrApiKey → systemctl restart xiaobai
# 换 Resend 密钥:改 /etc/xiaobai/xiaobai.env 的 RESEND_API_KEY → systemctl restart xiaobai

# 后端语法与验证码状态机测试
cd /opt/xiaobai/server
npm run check
npm test
```

> **网关角色(2026-07-06 起为 4 个)**:`xiaobai / evaluator / report / coach`。
> `coach` 是备课助教「小砚」(备课页右下角宠物),温度恒 0.5、上限 700 token,
> 尾部护栏已改写为三角色措辞。**下次发布若只发前端不发网关:旧网关把未知 role
> 按 xiaobai 处理(上限 400 token),且旧护栏措辞只承认「小白/评估器」两角色,
> 会和助教人设打架、答非所问——发布时记得同步 `scp server/index.mjs` 到
> `/opt/xiaobai/server/` 并 `systemctl restart xiaobai`。**

## 重新发布前端

```bash
cd app
mv .env.local /tmp/keep.env.local   # 确保产物不含密钥
XB_BASE=/xiaobai/ npm run build
mv /tmp/keep.env.local .env.local
grep -c "sk-" dist/assets/*.js       # 必须为 0
COPYFILE_DISABLE=1 tar -czf /tmp/xb-dist.tgz -C dist .
scp /tmp/xb-dist.tgz root@106.53.163.57:/tmp/
ssh root@106.53.163.57 'rm -rf /opt/xiaobai/dist/* && tar -xzf /tmp/xb-dist.tgz -C /opt/xiaobai/dist && chown -R xiaobai:xiaobai /opt/xiaobai/dist && rm /tmp/xb-dist.tgz'
```

## 已知取舍

- **HTTP 旧入口仅用于无鉴权浏览**:密码、验证码和会话都应走
  `https://tradingvane.com/xiaobai/`。生产建议把 HTTP `/xiaobai/` 直接 301 到 HTTPS;
  HTTPS 经本机 nginx 反代时会话 Cookie 自动带 `Secure`。
- 会话在内存:重启服务=全员重新登录(无持久化依赖,故意保持零依赖)
- `doc/服务器相关.md`、`doc/aiapi.md`、`doc/openrouter key.md`与 `doc/resendkey.md`
  均已列入根 `.gitignore`
