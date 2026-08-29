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

实现按 Tencent/WeKnora `main@84a35993d29c1d6f39ec7ef0b2455adf025d20c7`（2026-08-29）API 契约核对。运行镜像来自 Tencent/WeKnora；主项目为 MIT License，镜像内第三方组件仍分别遵循其原许可证。首次拉取后把四个 `*_IMAGE` 值改成实际 RepoDigest 再启动；升级前必须重新跑 BFF 客户端契约测试与真实上传 smoke test。
