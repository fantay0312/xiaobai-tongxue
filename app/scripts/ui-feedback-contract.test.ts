import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOPICS } from '../src/data';
import { nextStep } from '../src/engine/journey';
import { profileAvatarMimeForFile } from '../src/lib/profileAvatar';

const read = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const home = read('../src/pages/home/index.tsx');
const homeStyles = read('../src/pages/home/home.module.css');
const app = read('../src/App.tsx');
const shell = read('../src/components/shell/AppShell.tsx');
const trail = read('../src/components/story/StoryTrail.tsx');
const trailStyles = read('../src/components/story/storyTrail.module.css');
const letter = read('../src/components/story/MentorLetter.tsx');
const letterStyles = read('../src/components/story/story.module.css');
const tokens = read('../src/styles/tokens.css');
const profile = read('../src/components/shell/ProfileDialog.tsx');
const credentialFlow = read('../src/components/shell/ProfileCredentialFlow.tsx');
const emailChange = read('../src/components/shell/ProfileEmailChange.tsx');
const phoneChange = read('../src/components/shell/ProfilePhoneChange.tsx');
const passwordChange = read('../src/components/shell/ProfilePasswordChange.tsx');
const authStore = read('../src/store/authStore.ts');
const avatarHelper = read('../src/lib/profileAvatar.ts');
const avatarStyles = read('../src/components/shell/ProfileAvatar.module.css');
const teacher = read('../src/pages/teacher/index.tsx');
const growth = read('../src/pages/growth/index.tsx');
const growthStyles = read('../src/pages/growth/growth.module.css');
const seaStyles = read('../src/pages/growth/KnowledgeSeaField.module.css');
const seaList = read('../src/pages/growth/KnowledgeSeaList.tsx');
const achievement = read('../src/pages/growth/AchievementWall.tsx');
const achievementStyles = read('../src/pages/growth/AchievementWall.module.css');

const firstStep = nextStep({ events: [], reports: [], topicStates: {}, topics: TOPICS });
assert.equal(firstStep.to, '/study#shelf', '首次旅程必须先让用户到书架选课');
assert.equal(firstStep.cta, '去书架选课', '首次行动文案必须明示选课');

assert.match(home, /MOTTO_LINES[\s\S]*?Array\.from\(line\)/, '精神锚点必须按 Unicode 字符逐字落墨');
assert.match(home, /className=\{styles\.srOnly\}/, '逐字视觉层必须保留读屏全文');
assert.ok(
  home.indexOf('<blockquote className={styles.dreamQuote}') < home.indexOf('<XiaobaiAvatar'),
  '小白气泡必须位于头像上方',
);
assert.match(homeStyles, /\.dreamQuote::before[\s\S]*?bottom:\s*-0\.42rem[\s\S]*?rotate\(45deg\)/, '气泡尾必须向下指向头像');
assert.match(homeStyles, /prefers-reduced-motion:\s*reduce[\s\S]*?\.mottoChar[\s\S]*?animation:\s*none/, '逐字动效必须尊重减少动画');

assert.match(trail, /setTimeout\(\(\) => setCollapsed\(true\), 5000\)/, '篇章栏必须在 5 秒后收起');
assert.match(trail, /data-collapsed=\{collapsed \|\| undefined\}/, '篇章栏必须暴露折叠态');
assert.match(trailStyles, /grid-template-rows:\s*0fr/, '篇章栏收起后必须释放布局高度');
assert.match(trailStyles, /justify-content:\s*center/, '篇章栏初始必须居中');

assert.match(letter, /const \[closing, setClosing\]/, '拜师帖必须有关闭过渡态');
assert.match(letterStyles, /transform-origin:\s*50% 100%/, '拜师帖必须从底边展开');
assert.match(letterStyles, /@keyframes letter-rise[\s\S]*?translate3d\(0, 5rem, 0\)/, '展帖必须从下方升起');
assert.match(letterStyles, /@keyframes letter-sink/, '关帖必须有对应的下沉过渡');

assert.match(shell, /const NAV_GROUPS:[\s\S]*?study[\s\S]*?growth[\s\S]*?teacher/, '三个主导航必须提供分区快跳');
assert.match(shell, /<NavLink[\s\S]*?to=\{group\.path\}/, '主导航文字必须进入对应页面');
assert.match(shell, /aria-label=\{`\$\{group\.label\}章节快跳`\}/, '章节菜单必须由独立按钮打开');
assert.match(shell, /aria-expanded=\{expanded\}/, '分区导航必须暴露 disclosure 状态');
assert.match(shell, /event\.key !== 'Escape'/, '分区导航必须支持 Escape 关闭');
assert.match(shell, /focus\(\{ preventScroll: true \}\)/, '章节菜单关闭后必须把键盘焦点还给触发按钮');
assert.match(app, /new MutationObserver/, '跨路由锚点必须等待懒加载内容挂载');
assert.match(app, /setTimeout\(\(\) => observer\.disconnect\(\), 10000\)/, '冷启动锚点等待期不得短于 10 秒');
assert.match(app, /function decodeAnchorId[\s\S]*?try[\s\S]*?decodeURIComponent[\s\S]*?catch/, '畸形外部锚点不得让应用崩溃');
assert.match(app, /scrollIntoView\([\s\S]*?reducedMotion \? 'auto' : 'smooth'/, '锚点导航必须尊重减少动画');

for (const id of ['teacher-overview', 'blind-spots', 'topic-progress', 'misconceptions', 'recent-sessions']) {
  assert.match(teacher, new RegExp(`id=["']${id}["']`), `教师看板缺少 #${id} 快跳锚点`);
}

assert.match(tokens, /--ink-on-seal:/, '印面首字必须使用专用高亮令牌');
assert.match(avatarStyles, /\.avatar[\s\S]*?color:\s*var\(--ink-on-seal\)/, '共享头像首字不得发灰');
assert.match(shell, /<ProfileAvatar[\s\S]*?size="nav"/, '顶栏必须使用共享头像组件');
assert.match(profile, /<ProfileAvatar[\s\S]*?size="rail"/, '个人中心侧栏必须使用共享头像组件');
assert.match(profile, /securityFlow === 'phone'[\s\S]*?<ProfilePhoneChange/, '更换手机号必须进入独立安全流程');
assert.match(profile, /securityFlow === 'email'[\s\S]*?<ProfileEmailChange/, '更换邮箱必须进入独立安全流程');
assert.match(profile, /securityFlow === 'password'[\s\S]*?<ProfilePasswordChange/, '修改密码必须进入独立安全流程');
assert.doesNotMatch(profile, /EditorOpen|aria-expanded=\{(?:phone|email|password)EditorOpen\}/, '安全凭证不得继续在列表底部展开');
assert.match(credentialFlow, /step:\s*1\s*\|\s*2/, '安全流程必须只有身份验证与设置新凭证两步');
assert.match(credentialFlow, /设置新手机号[\s\S]*?设置新邮箱[\s\S]*?设置新密码/, '第二步必须按凭证类型显示新值设置界面');
assert.match(credentialFlow, /第一步<\/small><strong>验证当前身份/, '第一步必须明确为身份验证');
assert.match(credentialFlow, /verifyAccountPassword\(currentPassword, action\)/, '第一步必须调用服务端密码验证');
for (const [source, label] of [
  [emailChange, '邮箱'],
  [phoneChange, '手机号'],
  [passwordChange, '密码'],
] as const) {
  assert.match(source, /if \(!verificationToken\)[\s\S]*?<ProfileIdentityVerification/, `${label}流程必须先渲染身份验证页`);
  assert.ok(
    source.indexOf('if (!verificationToken)') < source.indexOf('step={2}'),
    `${label}的新凭证界面不得先于身份验证通过出现`,
  );
}
assert.match(authStore, /\/account\/verify-password[\s\S]*?verificationToken/, '前端必须通过短时验证授权衔接第二步');
assert.equal(profileAvatarMimeForFile({ name: 'portrait.JPG', type: '' }), 'image/jpeg', '缺失 MIME 时必须按白名单扩展名识别 JPG');
assert.equal(profileAvatarMimeForFile({ name: 'portrait.jpg', type: 'image/jpg' }), 'image/jpeg', '必须兼容 image/jpg 别名');
assert.equal(profileAvatarMimeForFile({ name: 'portrait.jpg', type: 'application/octet-stream' }), null, '非空的未知 MIME 不得按扩展名放行');
assert.match(avatarHelper, /startsWith\('data:image\/webp'\)/, '头像生成必须拒绝 Canvas 的非 WebP 回退');

assert.doesNotMatch(achievement, /印面预览/, '印章册不得保留独立印面预览区');
assert.doesNotMatch(achievement, /scrollIntoView/, '印章条件卡不得把页面卷到底部');
assert.match(achievement, /achievement-detail-\$\{id\}/, '每枚印章必须指向唯一条件卡');
assert.match(achievement, /onPointerEnter[\s\S]*?onFocus[\s\S]*?onClick/, '印章条件卡必须支持悬停、焦点与点击');
assert.match(achievementStyles, /\.detailTemporary\s*\{\s*pointer-events:\s*auto/, '悬停条件卡必须允许指针移入阅读');
assert.match(achievement, /role="progressbar"/, '未解锁条件必须暴露语义进度');
assert.match(achievementStyles, /\.detailPopover[\s\S]*?position:\s*absolute/, '印章条件卡必须贴近印章浮起');

assert.match(growthStyles, /\.observatory\s*\{[\s\S]*?display:\s*block/, '星海观测台必须让星图占满全宽');
assert.match(growthStyles, /\.evidenceDock\s*\{[\s\S]*?--paper:\s*var\(--star-sky-deep\)[\s\S]*?position:\s*absolute/, '证据链必须成为星海内的同色浮卡');
assert.match(growthStyles, /\.evidenceDock\s*\{[\s\S]*?pointer-events:\s*none/, '星海空态浮卡不得拦截星体点击');
assert.match(growthStyles, /\.evidenceDockOpen\s*\{[\s\S]*?pointer-events:\s*auto/, '打开的证据浮卡必须恢复交互');
assert.match(growth, /className=\{s\.evidenceClose\}/, '星海证据浮卡必须可直接收起');
assert.match(seaList, /data-star-id=\{node\.topic\.topicId\}/, '名录视图必须保留关闭证据后的焦点返还锚点');
assert.match(seaStyles, /\.node\[data-selected='true'\]::before[\s\S]*?opacity:\s*1/, '选中星宿必须有明确环形反馈');
assert.match(seaStyles, /\.node\[data-selected='true'\] \.nodeCopy[\s\S]*?background:/, '选中星宿的题签必须提升可读性');

console.log('ui feedback contract: all assertions passed');
