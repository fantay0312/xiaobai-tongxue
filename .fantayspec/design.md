# 设计:小白「升级 + 进化」双轨成长(2026-07-13)

> 需求原话:升级 = 正常讲课攒经验;进化 = 需要完成**不同的课程**(培养多学科思维与兴趣,但广度要求**不能过量**)。

## 概念模型

小白的成长拆成两条轨,全部从既有事件流**纯派生**,不新增事件类型:

| 轨道 | 机制 | 驱动 | 展示词汇 |
|:---|:---|:---|:---|
| **升级(连续)** | 学识经验值 → 学识等级(第 N 级) | 课堂内小白"真听懂了"的事件 | 「学识」「第 N 级」 |
| **进化(里程碑)** | 五阶形象跃迁(嫩芽→灯泡→眼镜→问号→学士帽) | 出师深度 + **跨课程广度** | 沿用「升期」「修行阶」「期名」 |

设计要点:
- `learningLevel` 是行为承重的(director.ts 难度旋钮:≥3 跳 L1/L2、≥3 问迁移、=5 提前迁移)。进化改造它**是有意的主题咬合**:见过多学科的小白才问迁移题。
- 广度要求刻意轻量(**不过量**):每一阶最多只要求"多涉猎一门课、该课出师 1 讲即可",绝不要求第二门课深耕。
- 经验轨道无行为耦合,纯正反馈:哪怕一堂没出师的课,命中要点/纠错/金句也有进账。

## 进化条件(修行阶跃迁)

| 阶 | 期名(沿用) | 条件(出师=topic_mastered 事件数,同 topicsMastered 口径不去重;课程=出师过的讲所属 course 去重) |
|:--|:--|:--|
| 1 嫩芽期 | 初始 | — |
| 2 开窍期 | 出师 ≥1 | 深度即可 |
| 3 求索期 | 出师 ≥2 **且 课程 ≥2** | 第一次广度门槛:换门课讲 1 讲即达 |
| 4 问难期 | 出师 ≥4 且 课程 ≥2 | 广度不加码(不过量) |
| 5 出师期 | 出师 ≥6 **且 课程 ≥3** | 三门课各尝过一口 |

- 课程要求上限用 `min(规则值, 开放(非 locked)主题的去重课程数)` 兜底(万一将来只剩一门课不至于永远卡死),下限 1。
- 与 DREAM_GOAL=5(讲给小小白听)叙事独立,互不影响。
- 旧档案迁移(persist v4)与 sync 拉档消毒时按新规则从事件流重算 → 深耕单课程的旧档会**降阶**,属新规则下的诚实重算,接受。

## 学识经验(XP)规则

只计小白在场且"学到了"的事件(prep/remedy 是先生自修,小白不在场,不计——与师道履历分口径刻意区分):

| 事件 | 学识 | 语义 |
|:--|--:|:--|
| checklist_hit | +3 | 听懂一个要点 |
| misconception_corrected | +8 | 解开一个执念 |
| golden_analogy_saved | +6 | 记住一个好比方 |
| stuck_rescued | +2 | 卡壳被拉回来也是成长 |
| review_passed | +10 | 忘了又想起,记得更牢 |
| xiaobai_quiz_scored | +⌊score/10⌋ | 考出来的都是学识(0-10) |
| topic_mastered | +25 | 出师大礼 |
| 其余(含 adopted) | 0 | 被带偏不扣分(成长语言纪律) |

等级阶梯:第 n→n+1 级需 `15 + 10·(n-1)` 点(15/25/35/45…),即累计门槛 t(n)=15(n-1)+5(n-1)(n-2)。一堂优质出师课 ≈70 点 → 首课即可到第 3 级(早期强正反馈);38 讲全出师 ≈ 第 23 级上下。不设硬顶。

## 引擎 API(新文件 `app/src/engine/evolution.ts`)

纯函数、Node 安全(不碰 window/localStorage/import.meta)、**不进 engine/index barrel**(同 achievements/honors/story 约定,页面按路径直接 import)。payload 数值一律过 num() 收口(同 achievements.ts)。

```ts
export const XP_RULES: Partial<Record<LearnEventType, number>>;
export interface XiaobaiWisdom { xp: number; level: number; intoLevel: number; forNext: number; }
export function deriveWisdom(events: LearnEvent[]): XiaobaiWisdom;

export interface EvolutionStatus {
  stage: XiaobaiGlobal['learningLevel'];   // 1-5
  masteries: number;                        // topic_mastered 事件数
  coursesTouched: string[];                 // 出师涉猎过的课程名,按首次出师序
  next: null | {                            // stage=5 时 null
    stage: 2|3|4|5;
    needMasteries: number; haveMasteries: number;
    needCourses: number;  haveCourses: number;
    breadthBlocked: boolean;                // 深度已够、只差"换门课"
    suggestedCourses: string[];             // 尚未出师过的课程名(书架序)
  };
}
export function deriveEvolution(events: LearnEvent[], topics: Topic[]): EvolutionStatus;
```

- 未知 topicId 的出师事件(旧档):计深度、不计广度。
- STAGE_RULES 常量导出,growth 页据此渲染条件铭文,不得手写复制数字。

## 接线点

1. **`engine/honors.ts`**:`pupilLevel()` 改为 `deriveEvolution(slice, input.topics).stage`(升期语义 = 进化);`SessionHonors` 增量新增 `xpGained / xpLevelBefore / xpLevelAfter / xpLevelUp`(用 deriveWisdom 对前后切片)。既有字段名与语义不动(pupilLevelBefore/After、levelUp = 进化与否)。旧课回看的升期显示随新规则漂移,可接受(仍是确定性纯派生;印章 id 契约不动)。
2. **`store/appStore.ts`**:
   - endSession 出师分支:`learningLevel` 不再用 `min(5, 1+mastered)`,改 `deriveEvolution(get().events, TOPICS).stage`(appendEvents 之后取新鲜 events)。topicsMastered/bestRecord 逻辑不动。
   - persist `version: 3 → 4`,migrate 补 v4 分支:从 `state.events` 重算 learningLevel(events 缺失时保持原值)。
3. **`store/sync.ts`**:sanitize 末尾用消毒后的 events 重算 `global.learningLevel`(远端旧规则档 → 拉档即校准;topicsMastered 不动)。
4. **`scripts/simulate.ts`**:文件末尾新增「成长双轨」断言节,**按路径直接 import evolution.ts**(Node 安全,注释说明为何绕过 barrel 惯例):合成事件流断言 XP 加权/等级门槛数学、五档进化门(1出师→2;2出师单课→仍2 且 breadthBlocked;2出师双课→3;4/2→4;6/3→5)、honors 切片的 xpGained/进化检测。合成事件的 topicId 从真实 TOPICS 按 course 动态取(不硬编码 id)。
5. **UI(三处,全走令牌与既有制式,读 app/DESIGN.md 与 .impeccable.md)**:
   - **成长册卷首**(`pages/growth/index.tsx` + growth.module.css):
     - 修行阶五方牌:每方牌下加一行条件铭文(从 STAGE_RULES 渲染,如「出师二讲·涉猎两门」);当前阶下一方牌展示实时进度(出师 x/y · 课程 x/y)。
     - 画像/五方牌区新增「学识」经验条:学识第 N 级 + 细进度条(role=progressbar,intoLevel/forNext)+「距下一级还差 M 点」。
     - `next.breadthBlocked` 时出一行化形指引(册页物称呼纪律用「先生」):「小白想去别的书架看看——先生哪天换一门《X》讲给他听?」X 取 suggestedCourses[0]。
   - **HonorRoll**(下课钤印):进账行加「学识 +N」;xpLevelUp 时加小签「学识晋级·第 N 级」;升期签(进化)沿用现有渲染。
   - **JourneyRibbon**:rankSub 行尾并入一小段「小白学识第 N 级」(纯文本,不加条,不挤叙事句)。
   - 动效纪律:入场 `global(rise)`;进度条宽度可过渡但不做位置过渡;新色一律 token/color-mix,预计无需新令牌(轨 --line、填充 --azure、衰减语义勿用)。
6. **不新增**:事件类型、XiaobaiGlobal 字段、3D 工作量(进化视觉 = 既有五阶配件)、课堂内任何提示(课堂纪律:金句小注是唯一现场机关)。

## 验证门

`npm run simulate`(含新断言节)+ `tsc -b` + `npm run build` + oxlint;浏览器过 growth/home/review 三页。
