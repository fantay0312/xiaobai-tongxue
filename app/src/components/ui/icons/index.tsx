/**
 * 小白同学自绘图标 —— 导航板块、工作台工具、费曼四站等产品自己的图标。
 * 取材老学堂的物件（砚台、翘头案、令牌、线装册、卷轴、油灯……），线条按现代界面的规格画：
 * 24×24 画板、1.6 描边、颜色取 currentColor；每枚带一处小块实色的「墨点」。
 * active 为选中态，多显一层淡墨；放在已标 aria-current / aria-selected / aria-pressed 的元素里时会自动进入选中态。
 */
export type { XbIconProps, XbIconType } from './base';

/* 一级板块 */
export { IconChat, IconWorkbench, IconTeach, IconClassroom, IconAgent, IconMemory, IconLibrary, IconGrowth } from './sections';

/* 工作台工具 */
export { IconNote, IconMindmap, IconQuiz, IconFlashcard, IconTodo, IconWriting } from './tools';

/* 费曼四站，以及思考与模型 */
export { IconPrep, IconLesson, IconExam, IconReview, IconSpark, IconModel } from './stations';

/* 课内学习方式与旅程 */
export { IconGuide, IconRead, IconJourney } from './study';
