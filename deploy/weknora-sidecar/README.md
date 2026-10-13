# WeKnora sidecar

此编排只启动小白自定义课程所需的 WeKnora 核心：`app + docreader + ParadeDB + Redis`。不启动 WeKnora 前端、Chat、Wiki、Neo4j、Langfuse 或其它可选服务；宿主机只在回环地址暴露 `8180`，公网不能直接访问。用户原文件的主存由小白 BFF 写入既有私有 COS；sidecar 的 local volume 只保存 WeKnora 自己的解析副本与索引，不作为用户文件主存。

## 首次部署

1. 复制 `.env.example` 为服务器专属 `.env`，用随机值替换所有占位项，权限设为 `0600`。
2. 首次把 `DISABLE_REGISTRATION=false`，运行 `docker compose up -d`，确认四个服务健康。
3. 通过 `POST /api/v1/auth/register` 创建仅供小白集成使用的 Owner；随后用租户模型接口 `POST /api/v1/models` 创建两条 `source=remote` 模型，再通过 `PUT /api/v1/initialization/config/:kbId` 绑定到一个空模板知识库：
   - DeepSeek 对话模型（用于 WeKnora 初始化要求与可选摘要）；
   - OpenRouter `baai/bge-m3` embedding，维度 `1024`；
   - 一把能力仅含 `manage_kbs`、`ingest`、`retrieve` 且 KB allow-list 为空的空间 API Key。
   当前已验收镜像不能用旧的 `POST /initialization/initialize/:kbId` 创建共享模型：该路径会把模型错误写入 tenant 0，后台 worker 随后报 `model not found`。升级镜像后要先重跑真实入库再决定是否恢复旧路径。
4. 把 `.env` 的 `DISABLE_REGISTRATION` 恢复为 `true` 并重启 app。
5. 在 `/etc/xiaobai/xiaobai.env` 配置 `WK_BASE_URL=http://127.0.0.1:8180/api/v1`、上一步 API Key、初始化产生的 embedding/chat model ID 与 `WK_MAX_FILE_MB=80`。

所有真实密钥只保存在服务器的 root 专属环境文件或 WeKnora 加密数据库中，不进入本仓库。

## 版本与许可

生产已于 2026-10-13 从 v0.7.2 升级到官方当日最新正式版 [v0.8.2](https://github.com/Tencent/WeKnora/releases/tag/v0.8.2)（2026-09-24 发布，源码 `3e8b0bfc80b845b2d4b2ed683994748741450a97`），完成备份恢复演练、既有资料读取、7.9 MB PDF 入库和网站完整发布验收，见[验收记录](../../doc/qa-evidence/2026-10-13-large-pdf/README.md)。`app` 与 `docreader` 必须使用同一版本；生产 `.env` 使用验收过的不可变镜像摘要，不能使用浮动 `latest`。数据库与 Redis 沿用原持久化版本，不随应用升级跨大版本迁移。

本生产环境为 linux/amd64，官方分平台摘要、原始配置摘要及规范化内容指纹记录在 `image-lock.json`。拉取或离线导入后运行 `node verify-images.mjs <app镜像> <docreader镜像>`，核对文件层、运行配置、架构和源码提交。Docker/containerd 离线导入可能重建清单，因此本机 image ID 可以不同；只有上述内容核对通过后，才可把该服务器实际导入的不可变 image ID 写入生产 `.env`。本次实际安装 ID 记录在验收证据中，不得只信任可移动的版本 tag。

升级前保存 `.env`、`compose.yml`、`config.yaml`、数据库逻辑备份、解析文件与 Redis 队列；先在隔离数据库恢复备份并启动新版，通过 API Key、既有分块读取和文档解析检查，再暂停生产写入完成最终备份并切换。回滚必须恢复匹配旧镜像的数据库、文件与队列，不能仅退回旧镜像。保持 `SYSTEM_AES_KEY`、JWT 和 gRPC 密钥原值，避免已保存模型凭据失效。沙箱默认关闭，sidecar 不挂载 Docker socket。

运行镜像来自 Tencent/WeKnora；主项目为 MIT License，镜像内第三方组件仍分别遵循其原许可证。此前对接基线为 `main@84a35993d29c1d6f39ec7ef0b2455adf025d20c7`，实际旧生产镜像为 v0.7.2；升级验收以实际镜像标签、摘要及真实入库结果为准。
