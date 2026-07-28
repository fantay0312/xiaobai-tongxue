# verify (2026-07-05)
- npm run build ✓ (chunk 1.28MB 警告,演示无碍)
- npm run simulate ✓ 全部断言(两知识点:正确路径7轮出师/被带偏/卡壳R1-R4/偏题/学习力节奏)
- 浏览器走查 ✓ 全页面+全闭环;遗留:traces 不持久化(复盘逐轮判语仅当次会话);api 模式未实测

# verify (2026-07-06 真实 API 接入)
- npm run build ✓ / npm run lint ✓(仅 2 条既有 fast-refresh 警告)
- npm run simulate ✓ 全部断言(mock 保稳路径无回归)
- npm run livetest ✓ ×3(DeepSeek 真实调用:语义命中 c1/c2、M1 注入→语义判定纠正、R1 救援、偏题围栏、全程零泄漏;单轮均值 3.9-4.4s)
- HIGH-1 定点回归 ✓:规则假 adopted("不一样"含"一样")被 LLM 语义判定覆盖为 corrected
- 对抗审查(13 agents):10 项发现 → 8 项确认 → 7 项独立缺陷全部修复,2 项驳回
- 未做:浏览器点击走查(Chrome 扩展未连接;已用 headless 验证 env 注入进 dev/dist + DeepSeek CORS 放行)

# verify (2026-07-06 部署+登录墙)
- 公网验收 http://106.53.163.57/xiaobai/ ✓ 九项:首页/资源/产物零密钥/匿名me/未登录chat 401/错误密码401/登录/真实LLM(1.0s)/登出即失效
- 引擎级 E2E(node 改写 fetch 穿网关)✓:未登录评估纯规则降级;登录后 proxy 语义评估命中+LLM台词+零泄漏
- 安全审查(14 agents):11 项发现 → 6 项确认全部修复(HIGH:renderer/evaluator 的 LLM 分支漏 proxy 模式;会话Map无上限;authStore 瞬断误判 standalone;init/login 竞态;next 参数未校验),5 项驳回(其中2项为审查期间已预修的限流问题)
- nginx 原站点回归 ✓(根路径 200 不受影响);simulate/tsc/lint 全绿;simulate 曾被 api.ts 的 import.meta.env 炸掉,已修 node 回退

# verify (2026-07-24 腾讯云验证码)
- 腾讯控制台 ✓ 邮箱应用=始终验证/感知模式/风险拦截关闭，登录应用=无感验证；两个应用的 CaptchaAppId 强制校验与一次一密均开启。
- 服务端 ✓ `npm test` 76/76、`npm run check`；覆盖 TC3 固定向量、GCM 布局、场景绑定、并发重放、风险票据、headers 后 body 超时、流式大小上限、静态/CVM role 凭据、五个受保护入口缺票拒绝。
- 前端 ✓ TypeScript/Vite 生产构建、oxlint(仅 fsImpl 两条既有 warning)、pending-sync 41 项、simulate 1561 项。
- 供应链/密钥 ✓ `.env.local` 隔离构建；9 组真实凭据值扫描 release 221 文件零命中；AppSecret/CAM 临时凭据未进入仓库、前端、日志或发布包。
- 部署 ✓ release SHA 校验、状态+server+dist+env 备份、失败自动回滚；生产 systemd active、nginx -t 通过，代理明确覆盖 X-Real-IP/X-Forwarded-Proto。
- 公网 ✓ `/api/me` 返回 captchaAvailable/emailAuthAvailable=true；email/login challenge 均为 GCM、360s、AppId 正确且 no-store；缺票 428，错票/重放/跨场景 403，无拒绝登录 Cookie；bundle 与 8 个后端运行文件 SHA-256 一致。

# verify (2026-07-28 手机认证、生产存储、邮件与 CDN)
- 服务端 ✓ `npm test` 113/113；新增覆盖手机登录/强制绑定/换绑/手机重置密码、模板双参数、Redis 持久 OTP、PostgreSQL/COS/Resend、提交后重载 fail-stop、畸形 URI、入站邮件单封/并发/日配额及真实临时 Redis Lua 原子性；增量安全复审后补齐“拒额前零附件下载”、流式读取、零字节拒绝、元数据/实际长度复核，以及永久策略拒绝 200、完整性/临时故障 503 的负向测试。`npm audit --omit=dev` 0 漏洞，`npm run check` 与 `git diff --check` 通过；最终独立安全复审 `passed=true`、10/10、零遗留警告。
- 前端 ✓ lint（仅 `fsImpl.ts` 两条既有 warning）、simulate 1561、sync 41、landing data、TypeScript/Vite build 全绿；`dist` 无旧 `/xiaobai/` 路径与秘密特征。
- 数据 ✓ PostgreSQL 6 用户、4/4 联系方式均为密文结构、5 份学习状态、1 封上线验证来信；Redis 共 14 键，其中 `xiaobai:*` 3 键为该来信的幂等预留与日配额，既有非小白键未清理；COS 桶匿名访问 403，当前无活动文件。
- 腾讯云 ✓ 短信签名 `709872`、模板 `2698914` 均 `StatusCode=0`；模板正文含 `{1}` 验证码与 `{2}` 分钟，代码发送 `[code,"10"]`。SMS/COS API 用户分别仅挂 `XiaobaiSmsSendOnly`、`XiaobaiCosStorageOnly`。未提供真实手机号，因此未执行真实短信投递。
- 邮件 ✓ Resend 域 `mail.tokentosea.com` 为 verified，`email.received` webhook 为 enabled；真实自发自收验证达到 `outbound=accepted`、`inbound=stored`、用户映射成功。无签名 webhook 公网返回 400。
- CDN/HTTPS ✓ DNSPod `xiaobai` 记录为 CNAME `xiaobai.tokentosea.com.cdn.dnsv1.com.`；腾讯 CDN online、global/web、HTTPS 回源、SNI、HTTP/2、OCSP、TLS1.2/1.3、HSTS、308。目录 purge 任务 `630327820517691484` 为 done。
- 公网 ✓ HTTPS 根页与 `/api/me` 均 200，HTTP/2，API `Cache-Control: no-store`，HTTP→HTTPS 308；旧 `tradingvane.com/xiaobai/course?id=7` → `https://xiaobai.tokentosea.com/course?id=7` 308；直连源站无 CDN 头 403；旧回源令牌 403、新令牌 200、无令牌 403；私有 COS 匿名 403。
- 部署 ✓ 最终增量版本 `20260728T105500Z` 已原子切换，切换前完整备份位于 `/var/backups/xiaobai/20260728T105500Z`；systemd active+enabled，Node 只监听 `127.0.0.1:8000`，CapabilityBoundingSet/AmbientCapabilities 均为空，Nginx 语法通过；本地 server（排除生产 config）与线上 `rsync --checksum --dry-run` 为 0 差异，变更模块 SHA-256 一致；公网根页 HTTP/2 200、`/api/me` 能力正常且 no-store、无签名 webhook 400、旧入口 308。发布包扫描 105 个代码/产物文件，真实环境秘密与回源令牌 0 泄漏；数据库与 Resend 凭据文档均被 Git ignore。
