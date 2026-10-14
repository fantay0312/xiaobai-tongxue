# 腾讯 TTS 接入验收

复用服务器现有腾讯语音凭据，不创建新密钥、不把密钥传给客户端。默认服务腾讯云 TTS，默认智菊阅读女声，可选择智斌、智瑜、智云。

- `real-voices.jsonl`：四个音色真实合成结果、时长、延迟、非静音指标。
- `zhiju-reading.wav`：真实智菊试听。
- 单元测试覆盖音色传递、凭据目标域名、中文/英文分段、WAV拼接、取消、旧偏好兼容和上游目录失败。
- 324 项服务端回归通过。部署及浏览器结果完成后补充。

音色来源：[腾讯官方音色表](https://cloud.tencent.com/document/product/1073/92668)。

## 图片选型（本轮不接入）

建议先用 Seedream-Image-v5.0-pro 做通用图像/封面，HY-Image-3.5-preview 做复杂指令和多轮编辑；需要参考图主体一致性时再考虑 Vidu-Image-q2。仅依据官方能力匹配场景，尚未做相同提示词的画质、速度及成本实测。

来源：[Seedream 调用指南](https://cloud.tencent.com/document/product/1823/136609)、[Hy 调用指南](https://cloud.tencent.com/document/product/1823/135745)、[模型概览](https://intl.cloud.tencent.com/zh/document/product/1300/83707)。
