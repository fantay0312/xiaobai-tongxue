import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const themeStore = readSource('../src/store/themeStore.ts');
const animeTokens = readSource('../src/styles/theme-anime.css');
const indexCss = readSource('../src/index.css');
const indexHtml = readSource('../index.html');
const settingsDialog = readSource('../src/components/shell/SettingsDialog.tsx');
const appShell = readSource('../src/components/shell/AppShell.tsx');
const appShellCss = readSource('../src/components/shell/AppShell.module.css');

assert.match(themeStore, /export const UI_THEMES = \['paper', 'anime'\]/);
assert.match(themeStore, /THEME_STORAGE_KEY = 'xiaobai-ui-theme-v1'/);
assert.match(themeStore, /root\.dataset\.theme = theme/);
assert.match(themeStore, /tone: state\.tone/);
assert.match(themeStore, /musicOn: state\.musicOn/);
assert.match(themeStore, /soundUrl\(/);

assert.match(indexCss, /@import '\.\/styles\/theme-anime\.css'/);
assert.match(indexHtml, /xiaobai-ui-theme-v1/);
assert.match(indexHtml, /data-theme="paper"/);

assert.match(animeTokens, /html\[data-theme='anime'\]/);
assert.match(animeTokens, /--terra-ink:/);
assert.match(animeTokens, /--paper:/);
assert.match(animeTokens, /--radius-l:\s*24px/);
assert.match(animeTokens, /--font-serif:\s*var\(--font-body\)/);
assert.match(animeTokens, /data-tone='night'/);
assert.doesNotMatch(
  animeTokens,
  /--board:/,
  '讲解舱黑板令牌不得被动漫浅色主题覆盖',
);

assert.match(settingsDialog, /id: 'look'/);
assert.match(settingsDialog, /日系动漫/);
assert.match(settingsDialog, /setTheme\(option\.id\)/);
assert.match(settingsDialog, /setTone\(option\)/);
assert.match(settingsDialog, /setMusicOn\(!musicOn\)/);
assert.match(appShell, /AtmosphereToggles/);
assert.match(appShell, /AmbiencePlayer/);

assert.match(appShell, /SettingsDialog open=\{settingsOpen\}/);
assert.match(appShellCss, /:global\(html\[data-theme='anime'\]\) \.headerInner/);
assert.match(appShellCss, /:global\(html\[data-theme='anime'\]\) \.headerInner \{[\s\S]*border-radius:\s*999px/);
