import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const landingPage = readSource('../src/pages/landing/index.tsx');
const landingStyles = readSource('../src/pages/landing/landing.module.css');
const learningWorkspace = readSource('../src/pages/landing/LearningWorkspace.tsx');
const workspaceStyles = readSource('../src/pages/landing/LearningWorkspace.module.css');
const sceneStyles = readSource('../src/pages/landing/WorkspaceScenes.module.css');
const reteachScene = readSource('../src/pages/landing/WorkspaceReteachScene.tsx');
const reteachStyles = readSource('../src/pages/landing/WorkspaceReteachScene.module.css');

assert.match(landingPage, /querySelectorAll<HTMLElement>\('\[data-landing-reveal\]'\)/);
assert.match(landingPage, /threshold:\s*0\.01/);
assert.match(landingPage, /observer\.unobserve\(entry\.target\)/);
assert.match(
  landingPage,
  /reducedMotion\s*\|\|\s*!\('IntersectionObserver' in window\)/,
  '减少动态或浏览器不支持观察器时必须直接显示内容',
);
assert.match(
  landingStyles,
  /\[data-landing-reveal\]\s*\{[^}]*opacity:\s*1[^}]*transform:\s*none/s,
  '滚动显现必须渐进增强，默认内容不能隐藏',
);
assert.match(landingStyles, /\[data-reveal-state='pending'\]\s*\{[^}]*translate3d\(0, 8px, 0\)/s);
assert.match(landingStyles, /\[data-reveal-state='pending'\]\s*\{[^}]*transition:\s*none/s);
assert.match(landingStyles, /\[data-reveal-state='shown'\]\s*\{[^}]*transition:/s);
assert.match(landingStyles, /prefers-reduced-motion:\s*reduce[\s\S]*transition:\s*none/);

assert.match(
  learningWorkspace,
  /data-entrance-settled=\{entranceSettled\}/,
  '场景必须记住明确暂停后的最终态，继续时不能重播入场',
);
assert.match(learningWorkspace, /settledSceneKey === sceneKey/);
assert.match(learningWorkspace, /useLayoutEffect\(\(\) => \{[\s\S]*playback\.intent !== 'playing'/);
assert.doesNotMatch(
  learningWorkspace,
  /onAnimationEnd/,
  '外框先结束，不能用它提前截断仍在错峰入场的子结构',
);
assert.match(
  workspaceStyles,
  /workspace\[data-motion='paused'\]\s+\.sceneFrame\s*\{[^}]*animation-play-state:\s*paused/s,
  '离屏或页面隐藏时应保留尚未完成的入场进度',
);
assert.match(
  workspaceStyles,
  /sceneFrame\[data-entrance-settled='true'\]\s*\{[^}]*animation:\s*none[^}]*opacity:\s*1[^}]*transform:\s*none/s,
  '明确暂停后必须永久停在最终可见态',
);
assert.match(
  sceneStyles,
  /\[data-entrance-settled='true'\]\s+\.sceneHeading[\s\S]*animation:\s*none\s*!important/,
  '普通场景的一次性结构内容不能在继续时重播',
);
assert.match(reteachScene, /session\.teacherLine/);
assert.match(reteachScene, /DEMO\.transferExamples\s*:\s*DEMO\.tokenExamples/);
assert.match(reteachScene, /examples\.map/);
assert.match(reteachScene, /data-reteach-branch=\{journey\.branch\}/);
assert.match(
  reteachStyles,
  /\[data-entrance-settled='true'\][\s\S]*animation:\s*none\s*!important/,
  '终幕暂停后继续必须保持完整可见',
);

console.log('landing motion contract: all assertions passed');
