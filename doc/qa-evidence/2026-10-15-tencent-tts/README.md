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

## TokenHub 配置核对

用户随后提供本地密钥文件，并明确确认“先核对配置，绘图仍暂缓”。只调用官方 `GET /v1/models` 验证：HTTP 200，返回 120 个模型，目录包含推荐的 Seedream 5.0 Pro、HY-Image-3.5-preview 和 Vidu Q2。未调用生图、未验证单个图片模型的推理权限/余额，未把该密钥上传服务器。密钥文件已加入 `.gitignore`，证明文件不含密钥。

## 发布

运行版本 `20261015-reader-6ef8d4c`。候选环境与入口权限检查通过后发布；主配置原值保留，仅环境配置开启 `READER_TENCENT_TTS_ENABLED=1`。原运行目录、数据库和环境文件已备份。

## 真实运行结果

`production-proof.json`：生产代码和实际环境开关下，默认智菊与指定智斌均返回 HTTP 200 WAV，响应标明 Tencent 服务与对应音色。

`browser-network-male.json`：登录账号在原版阅读界面选择智斌后，三个分段请求均发往站内语音接口，实际响应音色为 501000；页面播放、暂停和继续操作通过。`settings-male.png`、`playing.png` 保存该流程画面。

浏览器完整验证已通过：全局设置与阅读内设置均提供腾讯 TTS 和四个音色；选中智斌后真实请求/响应对应 501000；播放、暂停、继续均通过。整页刷新后音色仍为 501000，最后在全局设置恢复默认智菊 501002。见 `browser-proof.json` 和 `global-settings.png`。
