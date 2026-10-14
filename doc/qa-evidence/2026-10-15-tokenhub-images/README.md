# TokenHub 封面生成验收

两种模型均从服务器真实调用，使用用户指定的服务端 TokenHub 密钥，未把密钥输出或交给浏览器。

- `seedream-cover.png`：Seedream 5.0 Pro，1024×1024 PNG。
- `hy-cover.png`：HY-Image-3.5，1024×1024 PNG。
- `generation-proof.json`：真实模型、字节数、耗时和结果。

Seedream 使用 `/v1/wand/si-image/generation`，HY 使用 `/v1/wand/hunyuan-image/v35-generation`。HY 最终输出保存在腾讯 COS；同地域 CVM 的官方 COS 域名可能解析为内网地址，因此下载仅允许固定的官方输出桶域名模式，保持 HTTPS 证书校验，拒绝重定向，不转发 TokenHub 密钥。通用网页导入的 SSRF 限制未改动。

默认 Seedream，设置只提供这两种 TokenHub 封面模型。图片保存进账号的服务端封面存储，避免临时链接失效。

## 线上验收

- 发布 `20261015-reader-e4f2d7d`，代码提交 `e4f2d7debd1c2ddda9b172d5a49cdadf7dcda819`。发布前备份运行目录、数据库、环境和反向代理配置；候选启动检查、密钥扫描、上线健康检查通过。
- `deployment-proof.json`：生产发布与回滚路径。只增加服务端 TokenHub 环境变量；原有腾讯 TTS 配置保留。封面生成接口代理等待时间设为 210 秒。
- `catalog-proof.json`：生产实际目录只有 Seedream 5.0 Pro、HY-Image-3.5 两个封面选项，默认 Seedream；朗读仍默认腾讯 TTS。
- `tests.json`：服务端 330 项测试全部通过，父应用与阅读器类型检查、完整生产构建通过。
- `browser-generation-proof.json`：已登录账号通过原版“粘贴文字 → 书库 → 绘制封面”生成两张图片。Seedream 请求 HTTP 200，41.820 秒；设置切换后 HY 请求 HTTP 200，13.295 秒。响应模型与用户选择一致。
- `database-proof.json`：两篇验收文章均保存 `painted` 状态与实际 PNG 字节，而非依赖上游临时图片链接。
- `settings-default.png`：验收结束后的真实设置页面，已恢复默认 Seedream。切换到 HY 后的真实调用由 `browser-generation-proof.json` 记录。
- `browser-persistence-proof.json`、`covers-after-refresh.png`：整页刷新后，两张 1024×1024 封面完整加载，默认模型仍为 Seedream。

验收文章保留在当前账号书库，名称为“Seedream 封面验收”和“HY 封面验收”。

来源：[Seedream 官方协议](https://cloud.tencent.com/document/product/1823/136609)、[HY 官方协议](https://cloud.tencent.com/document/product/1823/135745)、[腾讯 COS 同地域访问说明](https://cloud.tencent.com/document/practice/213/57441)。
