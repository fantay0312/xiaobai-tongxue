# TokenHub 封面生成验收

两种模型均从服务器真实调用，使用用户指定的服务端 TokenHub 密钥，未把密钥输出或交给浏览器。

- `seedream-cover.png`：Seedream 5.0 Pro，1024×1024 PNG。
- `hy-cover.png`：HY-Image-3.5，1024×1024 PNG。
- `generation-proof.json`：真实模型、字节数、耗时和结果。

Seedream 使用 `/v1/wand/si-image/generation`，HY 使用 `/v1/wand/hunyuan-image/v35-generation`。HY 最终输出保存在腾讯 COS；同地域 CVM 的官方 COS 域名可能解析为内网地址，因此下载仅允许固定的官方输出桶域名模式，保持 HTTPS 证书校验，拒绝重定向，不转发 TokenHub 密钥。通用网页导入的 SSRF 限制未改动。

默认 Seedream，设置只提供这两种 TokenHub 封面模型。图片保存进账号的服务端封面存储，避免临时链接失效。部署和浏览器验证结果完成后补充。

来源：[Seedream 官方协议](https://cloud.tencent.com/document/product/1823/136609)、[HY 官方协议](https://cloud.tencent.com/document/product/1823/135745)、[腾讯 COS 同地域访问说明](https://cloud.tencent.com/document/practice/213/57441)。
