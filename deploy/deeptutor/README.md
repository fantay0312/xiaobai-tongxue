# DeepTutor 核心循环适配

本目录把真实 DeepTutor 的核心调度循环接入小白学习终端，作为可选的“深入答疑”能力。现有 `/api/chat`、资料库、账号、课程和课堂评分保留。不是嵌入整套 DeepTutor 产品，也不启动它的网页、全局记忆、插件、代码执行或第二套知识库。

## 上游与实际复用范围

- [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor/tree/6cf793bd868ba5ecbe64722936d4be8fab5a01df)，版本 `1.6.14`，固定提交 `6cf793bd868ba5ecbe64722936d4be8fab5a01df`，Apache-2.0。
- 实际调用 `deeptutor.runtime.agentic.loop.run_agentic_loop`、`LabelProtocol`、`StreamBus`。原版的标签流解析、协议修复与迭代预算参与每个请求；没有复制提示词后冒充框架调用。
- 本项目的 `StudyHost` 定义 PLAN / CHECK / FINISH 三阶段：简短讲解提纲、核对已提供材料、给出解释和自检问题。它是本项目适配协议，不是声称上游自带这三个固定阶段。
- 不调用上游全功能 `AgenticChatPipeline`。该入口会准备工作区、工具、记忆和其他 provider；仅隐藏工具按钮不足以形成执行边界。本适配器不建立任何工具注册表，不提供工具 schema。
- `.runtime/source` 保留原始上游代码和许可证；`bootstrap.py` 拒绝覆盖不同提交或已修改的源码。内部核心 API 不是跨版本兼容承诺，升级须重新跑测试。

## 安装与验证

在本目录执行：

```sh
mise run setup
mise run check
mise run test
```

Python / uv 版本由 `mise.toml` 固定，依赖由 `requirements.lock` 固定。只安装当前调度循环所需的导入依赖，未安装上游完整网页、向量数据库或解析器集合；本目录不是完整 DeepTutor 的通用安装方式。安装目录 `.runtime/` 已排除版本控制。

`check` 实际导入框架并返回版本；`test` 使用只监听本机的测试模型，经真实 OpenAI SDK 流接口和 DeepTutor 循环验证三轮完成、隐藏思考不输出、未知工具协议被拒绝及四次调用上限。测试不使用任何真实密钥或外部模型。

## 服务端启用

安装完成后，对既有 Node 网关设置 `DEEPTUTOR_ENABLED=1`。它复用网关已有的服务端助教模型、端点和密钥；密钥经私有 stdin 传给短生命周期 Python 子进程，不传浏览器、不放命令行、不写日志。未启用或检查失败时，“深入答疑”不可选；不静默改用普通回答并标称 DeepTutor。

- `GET /api/study/status`：经过原有 `chat` 登录与商业能力门禁，只返回可用性和版本。
- `POST /api/study/chat`：同一门禁；客户端只能提交问题、有限历史、笔记与可见课程材料。客户端不能选择模型、端点、工具或 system prompt。
- 自选课先在服务端确认当前账号拥有已发布课题，再从原有 WeKnora 获取该课题的片段；仅白名单投影后的材料进入框架。资料检索暂不可用时如实注明本轮只用已发布讲义。
- 内置课资料由构建阶段生成的 `server/study-catalog.json` 解析，未知课题拒绝，客户端正文不能覆盖目录。自选课仍从服务端已发布记录读取。补充文本明确属于用户输入，只按所选内容使用，不作为系统指令。
- 每个深入请求先从现有聊天配额保守预留 4 次调用；SDK 关闭自动重试，实际创建调用最多 4 次，每次最多 2200 输出 token。全局最多 2 个深入请求，每账号最多 1 个。总等待约 115 秒；取消、断开或超时会终止子进程并释放占用。
- 调用带 `reasoning_effort: none`。线上助教模型是推理模型，思考与正文共用输出上限；2026-10-14 实测不设时前两轮思考占满 2200 token、正文为空，四次调用用完仍到不了 FINISH，设为 `none` 后三轮约 6–10 秒完成。上游不接受该参数（HTTP 400）时，本次请求余下的调用自动去掉它，重发同样计入四次上限。
- 进度：runner 每完成一轮向 stdout 写一行 `{"progress": "PLAN" | "CHECK" | "FINISH"}`（只有标签，没有正文），最后一行是结果。请求带 `Accept: text/event-stream` 时，`POST /api/study/chat` 以事件流返回：`stage`（`{id,label,status}`，依次为读取所选资料、拟定讲解提纲、核对资料依据、组织解释与自检题）、`done`（与一次性响应相同的内容）或 `error`；不带时仍是一次性 JSON。
- 勾选资料时，展示用来源最多 5 条、每条 550 字；给模型的正文更完整（讲义至多 3000 字，其余每项 1500 字，资料库文件另带一段全文抽样，合计不超过 8000 字）。课程原始资料与资料库文件都按问题检索片段，两类来源交替占位。
- 原有聊天配额是网关进程内计数，本适配器继续共用它；没有借此宣称实现跨网关分布式配额。

## OpenMAIC 思路的落点

学习终端“带我学”借鉴 [OpenMAIC 固定提交](https://github.com/THU-MAIC/OpenMAIC/tree/ec176e84d450023e49a7e220d1b6974f5eb0bfce) 中类型化场景、暂停恢复和角色分工的思路。它是本项目的原创场景实现，未导入 OpenMAIC 运行时或生成式 HTML。

本项目场景是 explain / example / quiz / reflect；上游原始场景类型为 slide / quiz / interactive / pbl，二者不是同一套类型。学习步骤、跳过、回答和解释按账号与课题留在本机，材料版本变化会重置对应进度。完成阅读步骤不改变正式掌握度；“教小白”继续进入原有课堂。

## 生产服务器上的运行时

服务器没有 uv / mise，系统 Python 3.13 也没有 `ensurepip`，安装方式与本地不同：

```sh
install -d -o root -g xiaobai -m 750 /opt/xiaobai/deploy/deeptutor/.runtime
# 从本机同步固定提交的上游源码（不含 .git、__pycache__），再放 runner.py 与 requirements.lock
python3 -m venv --without-pip /opt/xiaobai/deploy/deeptutor/.runtime/venv
# 从镜像下载 pip 的 wheel 并校验 sha256，仅用于引导，不装进 venv
.runtime/venv/bin/python pip.whl/pip install --no-cache-dir --only-binary=:all: \
  -i https://mirrors.cloud.tencent.com/pypi/simple -r requirements.lock
chown -hR root:xiaobai /opt/xiaobai/deploy && chmod -R u+rwX,g+rX,g-w,o-rwx /opt/xiaobai/deploy
```

2026-10-14 已按此装在 `/opt/xiaobai/deploy/deeptutor`（网关按 `<server 目录>/../deploy/deeptutor` 解析）。以服务账号 `xiaobai` 运行 `runner.py --check` 通过；用线上助教模型跑通真实请求（三轮，约 6–10 秒），并在与 `xiaobai.service` 相同的沙箱属性下经 `deeptutor-provider.mjs` 跑通。发布新网关代码并给服务设置 `DEEPTUTOR_ENABLED=1` 之后入口才可用；`runner.py` 须与 `server/deeptutor-provider.mjs` 同步更新，发布时不要删除 `.runtime/`。线上资料检索与页面入口仍需在发布后验收。
