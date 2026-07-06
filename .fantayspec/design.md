# 设计 · 备课增强 + 游戏化叙事 + 成长册/教师看板真实数据重构(2026-07-06 深夜轮)

## 需求
1. 备课大模型部分:自测题多几道且多方位、知识面拓深、配示意图
2. 全项目补故事感/引导/游戏化
3. 成长册深度重构;4. 教师看板深度重构;5. 全部真实数据(清除教师页 CLASS_BARS/SAMPLE_STUDENTS)

## 架构决策
- **自测题**:复用 `PredictionQuizItem`,零 types.ts 改动。每个 LLM topic 文件导出 `{name}SelfTest: SelfTestItem[]`(7 题,dimension 覆盖 概念/推演/边界/应用/辨析 ≥4 维),聚合器 `src/data/selfTest.ts`(已写,demoScript 同款模式)。备课页摸底快测变两波:判断题(误区 probe,不动)→ 多维选择题;correctCount/total 合并计入 completePrep;答错的 mcRef 并入材料自动展开。
- **示意图**:`src/components/diagrams/` 手绘 SVG 组件 + 注册表 `TOPIC_FIGURES: Record<topicId, TopicFigure[]>`;`TopicFigure = { id, title, caption, Svg: ComponentType<{className?}> }`。备课页材料包新增「一张图看懂」折叠区。
- **拓深**:六个 LLM topic 的 microLecture.body 追加 `**再深一锹(选读)**` 段(300-450字,限定语纪律);examples 可 +1。**禁改** checklist/misconceptions/quizBank/probeLine/keywords/demo/references。
- **游戏化**:`src/engine/achievements.ts`(纯函数 events/reports/global/topicStates/topics → 印章成就 + 师道等级,不进 engine barrel,Node 安全)+ `src/engine/journey.ts`(nextStep 引导)。`components/story/` 拜师帖(首访,events.length===0)+ 旅程带(书斋页)。课堂 /teach 一律不碰(防作弊红线)。
- **成长册**:卷首(小白+师徒+师道等级)/印章墙/教学编年史(events×reports 按 sessionId 并轨的日志体)/盲区图谱(KnowledgeMap 保留)/金句画廊/演示重置保留。全真实、空态优雅。
- **教师看板**:删光假数据,重构为「本机真实事件流」教务档案:总览带/真实盲区榜/按知识点学情表/误区台账(事件流统计)/近期会话(复用 review/Radar)/泄漏率卡保留。

## 红线(自 simulate/审计深读)
- simulate 咬合:demo label 记号(被带偏/卡壳/偏题)、M1→M3→M2 注入序、c2/c3 阶梯、probeLine 逐字回显、quizBank 分数门(≥80/<80)——**这些字段一律不动**;新导出/新模块安全
- engine 新模块不进 src/engine/index.ts barrel(simulate 会在 Node 侧加载 barrel)
- CSS:朱砂只做误区/警示;小字号用 *-ink 变体;rise keyframes 每模块自带;hover 有 transform 的元素 fill-mode 用 backwards;Collapse 0fr + spacer 纪律;reduced-motion 全局杀开关已存在
- Md 冻结件不支持 ##;groundTruth/lookupCard 永不进备课页;新增内容不得与既有事实核修回退(strawberry 早期/BPE 自底向上合并/参数不存原文+高频片段例外/四处限定语)

## 分工(并行,文件不相交)
A1 内容: tokenization/gradientDescent/attention · A2 内容: pretrainFinetune/rlhf/scalingLaws
B 示意图: components/diagrams/* · C 备课集成: pages/prep/*
D 游戏化: engine/achievements+journey, components/story/*, pages/home/*
E 成长册: pages/growth/* · F 教师看板: pages/teacher/*
聚合器 selfTest.ts 由主线程已写。验证:tsc build + simulate + oxlint + 事实对抗核查 + 浏览器烟测。
