# 阅读器自然语音

使用 Kokoro-82M-v1.1-zh（Apache-2.0）和 kokoro-onnx，在 CPU 上合成中文语音。不需要读者 API key，不依赖外部语音余额。

- Python 版本由本目录 `mise.toml` 固定。
- 依赖完整锁定在 `requirements.txt`。
- 模型与音色来自 [kokoro-onnx 官方发布](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1)，模型说明来自 [Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)。
- 模型目录：`/opt/xiaobai-media/kokoro`；服务脚本：`server/reader/kokoro_server.py`；监听 `127.0.0.1:18082`，仅站内网关可访问。
- `xiaobai-reader-voice.service` 使用 `xiaobai` 用户运行，内存上限 2 GiB、CPU 上限 1.8 核；请求和原文不写入日志。

模型文件校验：

| 文件 | SHA-256 |
| --- | --- |
| kokoro-v1.1-zh.onnx | `859f9ded9f53be16c24857cdab3254a45da53c3afd5ba6ef134c7de3f822e326` |
| voices-v1.1-zh.bin | `14cb6186c99e4f6016871405f62046c5df863ae27465cbdc4ee08be7dd703acd` |
| config.json | `bc333efa5ce4ceff433c8c8e5d027a1eca0166001e4e4a62bea2d26ff7a46890` |

主站通过健康检查发现已启用的本地音色，在阅读设置中选择。腾讯云 TTS 仅在明确开通后设置 `READER_TENCENT_TTS_ENABLED=1`；OpenRouter 的语音、图像模型使用服务器既有凭据，并保留余额或区域错误，不回落为模拟输出。
