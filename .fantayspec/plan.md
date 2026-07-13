# 计划:小白「升级+进化」双轨成长(2026-07-13)

方案与全部接线细节见同目录 `design.md`(本轮规格书,实现代理按它执行)。

## 执行序

1. **并行实现**(Workflow `xiaobai-level-evolution`,Opus 执行代理):
   - 代理 A(引擎+存储):新建 `engine/evolution.ts`;改 `engine/honors.ts`、`store/appStore.ts`(endSession 重算 + persist v4 migrate)、`store/sync.ts`(拉档消毒重算);`scripts/simulate.ts` 追加「成长双轨」断言节并跑绿。
   - 代理 B(UI):成长册卷首(五方牌条件铭文 + 学识经验条 + 化形指引)、HonorRoll(学识进账/晋级签)、JourneyRibbon(学识一小段)。
2. **三视角对抗审查**(引擎数学与事件溯源 / 设计法典与 React / 回归猎手),结构化 findings 回主线程。
3. **主线程收口**:按 findings 修复 → `npm run simulate` + `tsc -b` + `npm run build` + oxlint 全绿 → 浏览器过 growth/home/review(Chrome 扩展可用时)→ 更新 progress.md 与记忆。

## 风险与对策

- learningLevel 是导演难度旋钮 → 进化新规则会让"单课程深耕"档的课堂略变容易:设计上有意(多学科→更成熟的小白),已记录。
- 旧档降阶(迁移诚实重算)→ v4 migrate + sync sanitize 双闸,消费方(LEVEL_NAME 下标/mood)由回归猎手核对。
- 两代理同工作树并行 → 文件所有权互斥;构建门禁只在主线程收口时统一跑。
