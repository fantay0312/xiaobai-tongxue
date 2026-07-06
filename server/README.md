# 小白同学 · 生产网关

零依赖 Node(≥18)单文件网关:静态托管前端 + 登录会话 + LLM 代理。
**DeepSeek 密钥只存在服务器的 `config.json`,永远不出现在前端产物里。**

## 当前部署(2026-07-06)

- 服务器:106.53.163.57(Debian 13,腾讯云)
- 入口:`http://106.53.163.57/xiaobai/`(nginx `location /xiaobai/` 反代 → 本机 `127.0.0.1:8000`)
- 网关直听 `0.0.0.0:8000`,但云安全组未放行 8000;若在腾讯云控制台放行,
  `http://106.53.163.57:8000/` 也可直接访问(网关 `pathPrefix` 对两种入口同时兼容)
- 服务:`systemd` 单元 `xiaobai.service`(开机自启,`User=xiaobai` 非特权用户)
- 目录:`/opt/xiaobai/{dist,server}`;配置 `/opt/xiaobai/server/config.json`(chmod 600)
- nginx 变更:仅向 `/etc/nginx/conf.d/tradingvane-ip.conf` **追加**了 `/xiaobai/` location,
  原站点不受影响;改前备份在同目录 `tradingvane-ip.conf.bak-xiaobai`

## 鉴权模型

- 预置账号(`config.json` 的 `users`,scrypt 哈希),**不开放注册**
- 登录发 HttpOnly Cookie(`xiaobai_sid`,SameSite=Lax,72h),会话存内存(重启全员登出)
- `/api/chat` 必须登录;未登录仅可查看前端页面
- 限流:登录失败按真实客户端 IP(仅信任本机 nginx 的 X-Real-IP)10 次/15 分钟;
  聊天按**账号名** 20 次/分钟(重复登录铸新会话无法绕过)

## 运维速查

```bash
# 状态 / 日志
systemctl status xiaobai
journalctl -u xiaobai -f

# 新增账号:本地生成哈希 → 填进服务器 config.json 的 users → 重启
node index.mjs hash '新密码'      # 输出 {name,salt,hash},把 name 改成账号名
systemctl restart xiaobai

# 换 DeepSeek 密钥:改 config.json 的 apiKey → systemctl restart xiaobai
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

- **HTTP 明文**:裸 IP 拿不到常规证书;登录密码走明文 HTTP。竞赛演示可接受;
  若挂子域名(服务器上已有 tradingvane.com 的 443),可申请证书后把 location 搬进 443 站点
- 会话在内存:重启服务=全员重新登录(无持久化依赖,故意保持零依赖)
- `doc/服务器相关.md`(服务器密码)与 `doc/aiapi.md`(API 密钥)均已列入根 `.gitignore`
