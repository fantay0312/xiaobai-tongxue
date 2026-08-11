import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const landingPage = readSource('../src/pages/landing/index.tsx');
const landingStyles = readSource('../src/pages/landing/landing.module.css');
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
  workspaceStyles,
  /workspace\[data-motion='paused'\]\s+\.sceneFrame\s*\{[^}]*animation:\s*none[^}]*opacity:\s*1[^}]*transform:\s*none/s,
  '暂停回放必须让新场景直接落到入场动画的最终可见态',
);
assert.match(
  sceneStyles,
  /scene\[data-motion='paused'\]\s+\.sceneHeading[\s\S]*animation:\s*none\s*!important/,
  '暂停时一次性结构内容必须立即落到最终可见状态',
);
assert.match(reteachScene, /session\.teacherLine/);
assert.match(reteachScene, /DEMO\.transferExamples\s*:\s*DEMO\.tokenExamples/);
assert.match(reteachScene, /examples\.map/);
assert.match(reteachScene, /data-reteach-branch=\{journey\.branch\}/);
assert.match(
  reteachStyles,
  /scene\[data-motion='paused'\][\s\S]*animation:\s*none\s*!important/,
  '终幕在暂停时仍需完整可见',
);

console.log('landing motion contract: all assertions passed');
