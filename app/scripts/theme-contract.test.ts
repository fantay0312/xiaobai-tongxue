/**
 * 外观主题契约。
 * 前半段守"接线"(store / 持久化 / 设置面板 / 首屏落位),
 * 后半段守「日系动漫 · 赛璐珞」的反 AI-Slop 纪律 —— DESIGN.md 硬性禁令的可执行版本。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const themeStore = readSource('../src/store/themeStore.ts');
const animeTokens = readSource('../src/styles/theme-anime.css');
const techTokens = readSource('../src/styles/theme-tech.css');
const indexCss = readSource('../src/index.css');
const indexHtml = readSource('../index.html');
const settingsDialog = readSource('../src/components/shell/SettingsDialog.tsx');
const appShell = readSource('../src/components/shell/AppShell.tsx');
const appShellCss = readSource('../src/components/shell/AppShell.module.css');
const paperCss = readSource('../src/styles/paper.module.css');
const heroCss = readSource('../src/pages/landing/LandingHero.module.css');
const landingCss = readSource('../src/pages/landing/landing.module.css');
const finalCalloutCss = readSource('../src/pages/landing/FinalCallout.module.css');
const techBarfield = readSource('../src/components/shell/TechBarfield.tsx');
const classroomCss = readSource('../src/pages/classroom/classroom.module.css');
const workspaceScenesCss = readSource('../src/pages/landing/WorkspaceScenes.module.css');

/* ── 接线 ── */

assert.match(themeStore, /export const UI_THEMES = \['paper', 'anime', 'tech'\]/);
assert.match(themeStore, /THEME_STORAGE_KEY = 'xiaobai-ui-theme-v1'/);
assert.match(themeStore, /root\.dataset\.theme = theme/);
assert.match(themeStore, /tone: state\.tone/);
assert.match(themeStore, /musicOn: state\.musicOn/);
assert.match(themeStore, /soundUrl\(/);

assert.match(indexCss, /@import '\.\/styles\/theme-anime\.css'/);
assert.match(indexCss, /@import '\.\/styles\/theme-tech\.css'/);
assert.match(indexHtml, /xiaobai-ui-theme-v1/);
assert.match(indexHtml, /data-theme="paper"/);
assert.match(indexHtml, /theme === 'tech'/);

assert.match(animeTokens, /html\[data-theme='anime'\]/);
assert.match(animeTokens, /--terra-ink:/);
assert.match(animeTokens, /--paper:/);
assert.match(animeTokens, /data-tone='night'/);

assert.match(techTokens, /html\[data-theme='tech'\]/);
assert.match(techTokens, /--terra-ink:/);
assert.match(techTokens, /--paper:/);
assert.match(techTokens, /Fusion Pixel 12px Proportional/);
assert.match(techTokens, /--font-serif:\s*'Fusion Pixel 12px Proportional'/);
assert.match(techTokens, /--font-typewriter:\s*'Fusion Pixel 12px Proportional'/);

assert.match(settingsDialog, /id: 'look'/);
assert.match(settingsDialog, /日系动漫/);
assert.match(settingsDialog, /科技 · 霓虹/);
assert.match(settingsDialog, /setTheme\(option\.id\)/);
assert.match(settingsDialog, /setTone\(option\)/);
assert.match(settingsDialog, /setMusicOn\(!musicOn\)/);
assert.match(appShell, /AtmosphereToggles/);
assert.match(appShell, /AmbiencePlayer/);
assert.match(appShell, /TechBarfield/);
assert.match(appShell, /SettingsDialog open=\{settingsOpen\}/);
assert.match(appShell, /headerHidden/);
assert.match(appShell, /onFocusCapture/);
assert.match(appShellCss, /:global\(html\[data-theme='anime'\]\) \.headerInner/);
assert.match(appShellCss, /:global\(html\[data-theme='tech'\]\) \.headerInner/);
assert.match(appShellCss, /\.headerHidden/);
assert.match(appShellCss, /prefers-reduced-transparency/);
assert.match(techBarfield, /prefers-reduced-motion|useReducedMotion/);
assert.match(techBarfield, /requestAnimationFrame/);

/* ── 讲解舱不受外观影响 ── */

assert.doesNotMatch(
  animeTokens,
  /--board:/,
  '讲解舱黑板令牌不得被外观主题覆盖(夜自习是场景叙事,不是暗色模式)',
);
assert.doesNotMatch(animeTokens, /--chalk:/, '粉笔色同上,不得被外观主题覆盖');
assert.doesNotMatch(techTokens, /--board:/, '科技主题也不得覆盖讲解舱黑板令牌');
assert.doesNotMatch(techTokens, /--chalk:/, '科技主题粉笔色同上,不得被外观主题覆盖');

/* ── 反 AI-Slop:色相 ──
   hue 265-290 是 AI 生成图的紫蓝指纹,也是 DESIGN.md 第一条禁令。整段禁用。 */

const hues = [...animeTokens.matchAll(/oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)/g)]
  .map((match) => Number(match[1]));
assert.ok(hues.length > 40, '色值抽取失败,正则与 oklch 写法脱节');
const slopHues = hues.filter((hue) => hue >= 265 && hue <= 290);
assert.deepEqual(
  slopHues,
  [],
  `禁用色相区(265-290 紫蓝)出现 ${slopHues.length} 处:${slopHues.join(', ')}`,
);

/* 线稿墨必须是暖褐(hue 60-90),不许滑回蓝灰 —— 这是取自小白立绘描线色的锚 */
const inkHue = /--ink:\s*oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)/.exec(animeTokens);
assert.ok(inkHue, '--ink 未按 oklch 三元组书写');
assert.ok(
  Number(inkHue[1]) >= 55 && Number(inkHue[1]) <= 95,
  `日景板线稿墨须为暖褐(hue 55-95),现为 ${inkHue[1]}`,
);

/* ── 反 AI-Slop:工艺 ──
   玻璃拟态 / 胶囊 / 高斯色团 一律不得出现在任何 anime 覆盖块里 */

const animeOverrideFiles: [string, string][] = [
  ['theme-anime.css', animeTokens],
  ['AppShell.module.css', appShellCss],
  ['paper.module.css', paperCss],
  ['LandingHero.module.css', heroCss],
  ['landing.module.css', landingCss],
  ['FinalCallout.module.css', finalCalloutCss],
];

/** 抽出文件里所有 anime 选择器块的声明体(不含注释) */
function animeBlocks(css: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/\[data-theme=['"]anime['"]\][^{]*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .join('\n');
}

/** 取出某个属性在块里出现过的所有值(负向前瞻会回溯误判,必须取值再比) */
function declaredValues(blocks: string, property: string): string[] {
  const pattern = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, 'g');
  return [...blocks.matchAll(pattern)].map((match) => match[1].trim());
}

for (const [name, css] of animeOverrideFiles) {
  const blocks = animeBlocks(css);

  const glass = declaredValues(blocks, 'backdrop-filter').filter((value) => value !== 'none');
  assert.deepEqual(glass, [], `${name}:动漫主题禁玻璃拟态,backdrop-filter 只许写 none(现有 ${glass.join(' / ')})`);

  const blurred = declaredValues(blocks, 'filter').filter((value) => value.includes('blur('));
  assert.deepEqual(blurred, [], `${name}:赛璐珞上的东西都有边,禁 filter: blur(现有 ${blurred.join(' / ')})`);

  assert.doesNotMatch(
    blocks,
    /border-radius[^;]*999px/,
    `${name}:动漫主题禁 999px 胶囊(模板脸)`,
  );
}

/* 網点(点阵纹)整个不用:铺开像方格纸,只落一处又像凭空冒出的形状。
   本主题的质感靠平色面 + 硬边落影,不靠贴纹理。 */
for (const [name, css] of animeOverrideFiles) {
  assert.doesNotMatch(
    animeBlocks(css),
    /--screentone|repeating-(radial|linear)-gradient/,
    `${name}:动漫态不铺点阵纹,质感交给平色面与硬边落影`,
  );
}

/* ── 反 AI-Slop:字体四声部不许塌 ── */

assert.doesNotMatch(
  animeTokens,
  /--font-serif:\s*var\(--font-body\)/,
  '题头衬线不得塌成正文无衬线(四声部塌成一声部 = 模板站)',
);
assert.doesNotMatch(
  animeTokens,
  /--font-typewriter:\s*var\(--font-body\)/,
  '打字机小签不得塌成正文无衬线',
);
assert.match(animeTokens, /--font-serif:\s*'Cormorant Garamond'/);
assert.match(animeTokens, /--font-typewriter:\s*'Courier Prime'/);

const track = /--track-label:\s*([\d.]+)em/.exec(animeTokens);
assert.ok(track, '--track-label 未定义');
assert.ok(
  Number(track[1]) >= 0.1,
  `打字机小签的字距不得压到 ${track[1]}em(<0.1em 就失去小签制式)`,
);

/* 导航小签与圆点标记是全站骨架,动漫态只许换色不许拆制式 */
const appShellAnime = animeBlocks(appShellCss);
assert.doesNotMatch(
  appShellAnime,
  /font-family:\s*var\(--font-body\)/,
  'AppShell:导航打字机小签不得被改成正文字体',
);
assert.doesNotMatch(
  appShellAnime,
  /\btext-transform:\s*none/,
  'AppShell:导航小签的大写制式不得取消',
);

/* ── 票据工艺保留:删工艺 = 退化成模板站 ── */

const paperAnime = animeBlocks(paperCss);
assert.doesNotMatch(
  paperAnime,
  /transform:\s*none/,
  'paper.module.css:斜贴票卡是全站招牌构图,动漫态不得拉平',
);
assert.doesNotMatch(
  paperAnime,
  /display:\s*none/,
  'paper.module.css:挂孔/撕票线等工艺件不得在动漫态被隐藏',
);

/** 抽出文件里所有 tech 选择器块的声明体(不含注释) */
function techBlocks(css: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/\[data-theme=['"]tech['"]\][^{]*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .join('\n');
}

const classroomTech = techBlocks(classroomCss);
// 2026-08-30 黑板重做后木框是独立的 .frame 层(.slate 板面 / .stream 对话流各司其职),科技覆盖落在框上
assert.match(
  classroomCss,
  /:global\(html\[data-theme='tech'\]\) \.frame/,
  '科技主题须给讲解舱木框换仪器屏框(方案 B:框改语义,板心冻结)',
);
assert.match(classroomTech, /border-image/, '讲解舱科技框须用石墨金属圈,不得只改投影');
assert.match(classroomTech, /var\(--terra\)/, '讲解舱科技框须接电青,不得另造色');
assert.doesNotMatch(
  classroomTech,
  /repeating-linear-gradient/,
  '讲解舱科技框不得再用扫描线条纹(条码感)',
);
assert.doesNotMatch(classroomTech, /--board:/, '讲解舱科技覆盖不得改写 --board');
assert.doesNotMatch(classroomTech, /--chalk:/, '讲解舱科技覆盖不得改写 --chalk');

const workspaceTech = techBlocks(workspaceScenesCss);
assert.match(
  workspaceScenesCss,
  /:global\(html\[data-theme='tech'\]\) \.boardScene/,
  '落地讲解/再讲演示幕须加科技仪器屏框,避免整幕跳进另一套色温',
);
assert.match(workspaceTech, /border-image/, '演示幕科技框须用石墨金属圈');
assert.match(workspaceTech, /var\(--terra\)/, '演示幕科技框须接电青');
assert.doesNotMatch(
  workspaceTech,
  /repeating-linear-gradient/,
  '演示幕科技框不得再用扫描线条纹',
);
assert.doesNotMatch(workspaceTech, /--board:/, '演示幕科技覆盖不得改写 --board');
assert.doesNotMatch(workspaceTech, /--chalk:/, '演示幕科技覆盖不得改写 --chalk');

const paperTech = techBlocks(paperCss);
assert.doesNotMatch(
  paperTech,
  /transform:\s*none/,
  'paper.module.css:斜贴票卡是全站招牌构图,科技态不得拉平',
);
assert.doesNotMatch(
  paperTech,
  /display:\s*none/,
  'paper.module.css:挂孔/撕票线等工艺件不得在科技态被隐藏',
);

assert.doesNotMatch(
  techTokens,
  /--font-serif:\s*var\(--font-body\)/,
  '科技主题题头不得塌成正文无衬线',
);
assert.doesNotMatch(
  techTokens,
  /--font-typewriter:\s*var\(--font-body\)/,
  '科技主题打字机小签不得塌成正文无衬线',
);

console.log('外观主题契约:接线 + 反 AI-Slop 纪律 全部通过 ✓');
