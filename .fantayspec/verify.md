# verify (2026-07-30 学问星海小星精修)
- 视觉/功能 ✓ 突出知识星由 29px 空心轮廓改为 13px 实心四芒星，选中/焦点最大 13.78px；普通节点为 3px 实心光点、锁定节点 2px。桌面继续保留 6 突出 + 28 装饰星，手机 4 + 14；装饰星实测 3.17–7.95px、最高透明度 0.177。点击热区仍为 44×44px，Token 星选择、2 个语义邻星、证据面板、方向键焦点与状态筛选均正常。
- 设计/浏览器 ✓ 原始四芒星参考与 625×656 星海区域经等比归一后放进同一张 1262×640 对照图；两轮修复把 18px 空心菱形继续收敛为 13px 实心光点。线上 1440×1000 与 390×844 均无根级横向溢出；30 星手机课程最小中心距 52.65px，浏览器 console 无 error/warning。`design-qa.md` 最终为 passed。
- 代码/秘密 ✓ PR `#9` squash 合并为 `03a4add`；最终 lint 仅 `fsImpl.ts:542` 两条既有 warning，TypeScript/Vite clean build 转换 2074 modules。clean dist 226 文件，真实本地 API key 精确值、通用 secret pattern 与 AppleDouble 均为 0；GitGuardian 成功。
- 发布/回滚 ✓ release `20260730T151517Z-03a4add-star-polish`，tar SHA-256 `6010102de65e77dc986fa107a497cb65db0e30a3dae2c417edbe363dc6764e07`，源站 226/226 清单与完整备份清单均复验。备份 `/var/backups/xiaobai/20260730T151517Z-03a4add-star-polish`（root:root 700，约 102M），回滚副本 `/opt/xiaobai/dist.prev-20260730T151517Z-03a4add-star-polish`。仅原子切换前端，服务未重启、配置/环境/数据未改。
- CDN/公网 ✓ 腾讯 CDN purge `630647494077853763` 为 done；公网 index、growth JS 与 growth CSS 和 clean build 逐字节一致。HTTPS `/` 与 `/admin/` 200，`/api/me`、`/api/commerce/catalog` 200 + no-store，HTTP→HTTPS 与旧入口 308，无 CDN 回源头直连源站 403；systemd active、`NRestarts=0`、Nginx 通过、journal warning 0。

# verify (2026-07-30 科举科名与学问星海)
- 功能 ✓ 五阶科名统一为童生/秀才/举人/贡士/进士，副题分别为初入问学/初通一艺/旁涉群书/问难穷理/学成登科；原 XP、门槛、事件和持久化键不变，五阶之后继续显示「第 N 阶」。卷三改为一片 42 星连续星海，课程巡览、星图/名录、状态筛选、证据链与跨课语义关系均可用；装饰星是独立视觉层，不占知识节点与读屏语义。
- 设计/浏览器 ✓ 线上桌面实测 42 知识星、6 突出星、28 装饰星；390×844 手机默认单课 6/4/14，操作系统 30 星以 5 列排布，最小中心距 52.65px、44px 点击目标、根级横向溢出 0。Token 星选择后出现 2 个语义邻星与 2 条星链，证据链同步展开；方向键焦点正确移动且全场仅 1 个 roving `tabIndex=0`；浏览器日志为空。设计对照与桌面/手机截图记录在 `output/design-qa/`，`design-qa.md` 结论为 passed。
- 代码门禁 ✓ PR `#7` squash 合并为 `c93169e`；App lint（仅 `fsImpl.ts:542` 两条既有 warning）、commerce contract、landing data、sync 41、simulate 1565、TypeScript/Vite clean build 全部通过；Server check + 195/195 tests，Admin domain/lint/build，`git diff --check` 均通过。
- 秘密/发布树 ✓ 合并提交 clean build 共 226 文件，真实本地 API key 精确值与通用 secret pattern 均为 0；GitGuardian 成功。发布 tar SHA-256 为 `b6944e329bb8605fc6f6f4dfce6bfc09f4f0a1c8250fde58a9f948f46767a4da`，不含 AppleDouble，226/226 清单本地与源站均校验通过。
- 发布/回滚 ✓ release `20260730T092256Z-c93169e-star-sea` 已切换到 `/opt/xiaobai/dist`；完整备份 `/var/backups/xiaobai/20260730T092256Z-c93169e-star-sea`（700），回滚副本 `/opt/xiaobai/dist.prev-20260730T092256Z-c93169e-star-sea`。候选预检与自动回滚闸门先后拦下远端缺少 `rg`、校验器路径错误两次，无用户流量进入失败候选；修正校验后最终切换成功。仅发布前端，未重启服务、未迁移数据。
- CDN/公网 ✓ 腾讯 CDN purge `630612165304266818` 为 done；公网 index 与 growth JS/CSS、银河 WebP、科名模块均和 clean build 逐字节一致。HTTPS HTTP/2 `/`、`/admin/`、`/api/me`、`/api/commerce/catalog` 为 200，API no-store，HTTP→HTTPS 和旧入口均 308，绕过 CDN 直连源站 403；systemd active、只监听 `127.0.0.1:8000`、`NRestarts=0`，Nginx 语法与上线后 journal warning 检查通过。

# verify (2026-07-30 商业化独立管理后台)
- 功能 ✓ 管理身份域与主站用户完全分离，无自助注册；Owner 可邀请成员、预配/变更角色和 18 项权限。订阅套餐/版本/权益、功能门禁、用户订阅、封禁、积分双分录、CDK 三类奖励、审计以及主站商业入口均已上线。Owner 为 pending，最新邀请 `sent=true/valid=true/revoked=false/consumed=false`。
- 代码门禁 ✓ Server check + 195/195 tests + audit 0；Admin domain/lint/TypeScript/Vite build + audit 0；App lint（仅 `fsImpl.ts:542` 两条既有 warning）、commerce contract、sync 41、landing contract、simulate 1561、TypeScript/Vite build + audit 0；`git diff --check` 通过，安全复核 P0/P1=0。
- 秘密门禁 ✓ 发布前发现本地开发 `VITE_LLM_API_KEY` 曾进入旧的未发布 `app/dist`，立即销毁已上传候选包；生产当前资源精确匹配为 0。代码已限制生产构建永远走服务端代理，保留 `.env.local` 重建后精确值匹配仍为 0；最终发布树同时扫描常见 API key、Owner 邮箱、数据库 URL、`.env` 和生产 `config.json`，均为 0。
- 数据/备份 ✓ 发布前完整备份 `/opt/xiaobai`、`/var/lib/xiaobai`、环境、Nginx、systemd 与 PostgreSQL 18 custom dump，位置 `/var/backups/xiaobai/20260729T184903Z-admin-commercial`，清单复验通过。一次性 PostgreSQL 18 容器分别恢复生产 dump 和创建空库，两条路径均成功执行 `001_initial.sql`、`002_commercial_admin.sql`、`003_cdk_campaign_idempotency.sql`，容器随后销毁。
- 发布 ✓ release `20260729T184903Z-admin-commercial`，禁用 macOS 扩展属性后的 tar SHA-256 `8787d35db993570484ca454b95af3f7b09f3d2400409071412bbc94112067456`，457 项 SHA-256 清单在线逐项通过。首次切换的 AppleDouble 元数据被 `ExecStartPre` 语法检查拒绝并自动恢复旧版；清洁重打后再次经过候选 8001 验证并成功切换，回滚副本为 `/opt/xiaobai/rollback-20260729T184903Z-admin-commercial-attempt2`。
- 公网/浏览器 ✓ HTTPS HTTP/2 的 `/`、`/admin/`、`/api/me`、`/api/commerce/catalog` 分别 200，后台匿名 `/api/admin/v1/auth/me` 401；API `Cache-Control: no-store`，后台 CSP 为 self-only 且禁止 frame，HTTP→HTTPS 308，直连源站无 CDN 回源头为 403。17 个关键 HTML/JS/CSS 与本地构建逐字节一致。后台登录/激活和主站在 1440×900、390×844 均无根级横向溢出，console 0 error/warn。
- CDN/运行态 ✓ 三个不同伪造 `X-Xiaobai-Client-IP` 的公网登录探针只使一个非伪造、非回环/未知 Redis IP 桶增加 3，证明 CDN 覆盖用户同名头。生产服务 active、仅监听 `127.0.0.1:8000`、`NRestarts=0`，Nginx 配置通过，上线后 journal warning 为 0。
- 已知边界 △ 本次没有支付网关、TOTP/WebAuthn/step-up、后台独立 HTTPS origin 或审计自动分区归档；同源主站 XSS/第三方脚本仍可能触及既有后台会话，需按设计文档的后续路线补齐。

# verify (2026-07-29 备课助教 Markdown)
- 功能 ✓ 小砚回复支持标题、段落、强调、删除线、行内/围栏代码、列表、引用、分隔线、表格与链接；逐字阶段不解析半截语法，完成后原子切换语义 DOM，减少动画直接显示完整 Markdown。教师消息保持纯文本，完成态仅在用户原本贴底时补一次跟滚。
- 安全/无障碍 ✓ 无 `dangerouslySetInnerHTML`；仅 `http/https` 生成外链并带 `_blank + noopener noreferrer`，`javascript:` 不生成链接，图片语法不发起远程请求，原始 `<img onerror>` 只显示文字。读屏 live region 会清理标题、列表、引用、表格分隔线、链接和强调标记；代码/表格横滚区均可键盘聚焦。
- 门禁 ✓ PR `#6` squash 合并为 `5495a80`；合并提交 clean archive 的 lint（仅 `fsImpl.ts:542` 两条既有 warning）、TypeScript、Vite build（2013 modules）、sync 41、landing data 全绿；此前同一改动 simulate 1561 项通过。桌面 1280×720、手机 390×844、减少动画和恶意 Markdown 夹具浏览器回归通过，页面/对话框无横向溢出，超长代码 `808>278` 仅内部滚动，console 0 error/warn。
- 供应链 ✓ `npm audit --omit=dev` 仍仅报 React Router RSC Mode 的 `GHSA-qwww-vcr4-c8h2`；本项目为 Vite HashRouter SPA，未启用 React Server Components/Server Actions，适用条件不命中，沿用既有依赖升级待办。
- 发布 ✓ release `20260729T104429Z-5495a80`，tar SHA-256 `dc682f5369988900fcb515b3854e33ea756f2256bdb4bde0d12677c2707e0229`；源站 224 文件清单逐项校验通过，备份 `/var/backups/xiaobai/20260729T104429Z-5495a80`，旧版 `/opt/xiaobai/dist.prev` 可回滚。仅切换前端目录，Node 服务未重启，网关/config/env/数据未改。
- CDN/公网 ✓ 按腾讯云 CDN `PurgePathCache`/`DescribePurgeTasks` 官方参数顺序调用并串行轮询，任务 `630475004114423900` 返回 done；公网 index、`prep-D8MLhhWY.js`、`prep-C-QFbBTL.css` 与 clean build 逐字节一致并命中 Markdown 安全/横滚规则。HTTPS HTTP/2 200、`/api/me` 200 + `Cache-Control: no-store`、HTTP→HTTPS 308、旧 `tradingvane.com/xiaobai/course?id=7` 去前缀 308、绕过 CDN 直连源站 403、systemd active 且 `NRestarts=0`。

# verify (2026-07-29 小白/小砚自然动作)
- 功能 ✓ 小白保留既有 mood/level/speaking/size/variant/ARIA 契约，在独立 breath/gesture wrapper 上新增随机微动作和不等节拍说话点头；小砚保留 forwardRef、按钮属性与六帧图集，新增五状态动作、随机休息/思考、hover 与 `:focus-visible` 招呼；助教回复运行态实测 `working → explaining → listening`，未再卡态。
- 动效边界 ✓ 所有动画仅使用 transform/opacity，未覆盖图集裁切 transform；后台页与减少动画模式下 JS 计时器停止、CSS 动画停用；桌面与 390×844 手机无横向溢出，控制台无 error/warn。
- 门禁 ✓ 最终合并提交 `3e12359` 的 clean archive 重新执行 lint（仅 `fsImpl.ts:542` 两条既有 warning）、TypeScript/Vite build（2010 modules）并通过；此前 simulate 1561、sync 41、landing data、server 113/113 与 server check 全过；质量审查 9.5/10、测试审查 PASSED。`npm audit --omit=dev` 报 React Router unstable RSC 专属高危通告，本项目为 Vite SPA 且未使用 RSC API，按官方适用条件判定不影响本次发布，留待独立依赖升级轮处理。
- 发布 ✓ PR `#5` squash 合并；release `20260729T101553Z-3e12359` 的 tar SHA-256 为 `0946e47f4e384d9bb8371f3bdbd2ae1f27d972764b0b3fccf153b2c831790c82`，源站 224 文件清单逐项校验通过；备份 `/var/backups/xiaobai/20260729T101553Z-3e12359`，旧版 `/opt/xiaobai/dist.prev` 可回滚，Node 服务未重启。
- CDN/公网 ✓ 腾讯 CDN purge `630472106991165757` 为 done；公网 index 与 5 份关键 JS/CSS 和本地 clean build 逐字节一致，且命中 `pupilBreath`、`speakingNod`、`petSpeakingBreath` 等新规则；HTTPS HTTP/2 200、`/api/me` 200 + `Cache-Control: no-store`、HTTP→HTTPS 308、旧 `tradingvane.com/xiaobai/course?id=7` 去前缀 308、绕过 CDN 直连源站 403、systemd active 且 `NRestarts=0`。

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
