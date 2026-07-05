# 小白同学 —— 费曼反转式学习智能体

学生扮演老师,AI 扮演"困惑但会追问的学生"。通过梯度追问、误区注入和讲解质量评估,
精确定位理解盲区,驱动「备课—讲解—评估—补学—再讲」学习闭环。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
```

## LLM 配置(真实 API / 本地演示双模式)

复制 `.env.example` 为 `.env.local`,填入 OpenAI 兼容端点凭据(默认 DeepSeek):

```bash
VITE_LLM_BASE_URL=https://api.deepseek.com
VITE_LLM_API_KEY=sk-xxxx
VITE_LLM_MODEL=deepseek-chat
```

- **有 key**:应用默认以 **API 模式**启动 —— 评估引擎做 LLM 语义判定
  (自由表述也能命中要点/判定误区纠正),小白台词由 LLM 实时生成;
- **无 key**:自动退回**演示模式**(内置规则引擎 + 台词模板,断网可跑);
- 运行中可在「设置抽屉」随时切换两种模式、更换端点并**测试连接**;
- API 任何一跳失败都会静默降级到规则/模板,课堂不会中断。

架构纪律:导演状态机永远是纯代码,LLM 只负责「理解讲解」和「生成台词」;
所有小白台词过泄漏检测出口守门(未解锁术语禁止说出口)。

> 注意:`VITE_*` 变量会打进前端产物,`dist/` 部署到公网前请确认密钥的暴露范围可接受
> (竞赛演示场景默认可接受;正式运营应改为服务端代理)。

## 脚本

```bash
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建
npm run lint       # oxlint
npm run simulate   # mock 全链路仿真回归(评估→导演→渲染→泄漏,全断言)
npm run livetest   # 真实 API 全链路实测(需 .env.local;语义评估/误区判定/救援/围栏/泄漏)
```

改动 `src/data`(知识点/误区库)或 `src/engine` 后,必须重跑 `npm run simulate`;
涉及 API 链路的改动加跑 `npm run livetest`。
