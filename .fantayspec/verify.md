# verify (2026-07-05)
- npm run build ✓ (chunk 1.28MB 警告,演示无碍)
- npm run simulate ✓ 全部断言(两知识点:正确路径7轮出师/被带偏/卡壳R1-R4/偏题/学习力节奏)
- 浏览器走查 ✓ 全页面+全闭环;遗留:traces 不持久化(复盘逐轮判语仅当次会话);api 模式未实测

# verify (2026-07-06 真实 API 接入)
- npm run build ✓ / npm run lint ✓(仅 2 条既有 fast-refresh 警告)
- npm run simulate ✓ 全部断言(mock 保稳路径无回归)
- npm run livetest ✓ ×3(DeepSeek 真实调用:语义命中 c1/c2、M1 注入→语义判定纠正、R1 救援、偏题围栏、全程零泄漏;单轮均值 3.9-4.4s)
- HIGH-1 定点回归 ✓:规则假 adopted("不一样"含"一样")被 LLM 语义判定覆盖为 corrected
- 对抗审查(13 agents):10 项发现 → 8 项确认 → 7 项独立缺陷全部修复,2 项驳回
- 未做:浏览器点击走查(Chrome 扩展未连接;已用 headless 验证 env 注入进 dev/dist + DeepSeek CORS 放行)
