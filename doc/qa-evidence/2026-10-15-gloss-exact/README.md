# 原版 Gloss 集成验收

- 两套同尺寸对照截图：左原版，右实际构建。
- `pg-native-proof.json`：真实 PostgreSQL 事务验收，全部数据回滚。
- `voice-bilingual-proof.jsonl`：服务器本地神经语音实际合成。
- `natural-voice.wav`：中文试听样本。
- 本地交互和服务器状态详见根目录 `design-qa.md`。封面请求仍因既有上游余额不足（402）而未成功，不以本地测试数据代替。

运行版本：`20261015-reader-decaf04`。`deployment-proof.json` 为发布、备份、配置保持与权限验证；`online-api-proof.json` 为真实服务端模型及媒体调用，明确标记非登录账号页面测试。封面 402，账号页面流程等重新登录。
