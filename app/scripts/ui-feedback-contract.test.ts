import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOPICS } from '../src/data';
import { nextStep } from '../src/engine/journey';
import { profileAvatarMimeForFile } from '../src/lib/profileAvatar';

const read = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const home = read('../src/pages/home/index.tsx');
const bookshelf = read('../src/pages/home/Bookshelf.tsx');
const classroom = read('../src/pages/classroom/index.tsx');
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

assert.match(
  bookshelf,
  /const openTopic = \(topic: Topic\) => \{[\s\S]*?navigate\(`\/prep\/\$\{topic\.topicId\}`\);[\s\S]*?\};/,
  '从书架打开新课、旧课或待复习课程时都必须先回到对应备课页',
);
assert.doesNotMatch(bookshelf, /function hasProgress/, '书架不得再按历史进度自动跳过备课');
assert.match(
  classroom,
  /const quit = \(\) => \{[\s\S]*?abandonSession\(\);[\s\S]*?navigate\(`\/prep\/\$\{topicId\}`\);[\s\S]*?\};/,
  '讲解舱暂离后必须回到当前知识点的备课页',
);

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
assert.match(letter, />[\s\n]*收下[\s\n]*</, '拜师帖收帖主按钮必须是「收下」');
assert.match(letter, /offerThemeHint:\s*true/, '收下必须触发主题气泡而不是直接放行引路');
assert.match(letter, /THEME_HINT_EVENT/, '收下后必须先广播主题气泡');
assert.match(shell, /开始前可以选一个好看的主题呀，点我选择！/, '设置钮气泡文案必须与产品口径一致');
assert.match(shell, /THEME_HINT_EVENT/, '外壳必须收听主题气泡广播');
assert.match(shell, /markThemeHintDone/, '点过主题气泡后必须落盘不再弹');
assert.match(read('../src/components/tour/tourState.ts'), /xiaobai-theme-hint-v1/, '主题气泡痕迹必须与引路分钥落盘');
assert.match(read('../src/components/shell/AppShell.module.css'), /\.themeHint[\s\S]*?background:\s*var\(--paper-warm\)/, '主题气泡必须跟令牌走色');
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
assert.match(growthStyles, /\.evidenceDock\s*\{[\s\S]*?left:\s*clamp/, '选中后的证据浮卡必须落在星海左上');
assert.match(growthStyles, /\.evidenceDock\s*\{[\s\S]*?width:\s*min\(18\.5rem/, '证据浮卡必须缩小并落在星空区内');
assert.match(growthStyles, /data-corner='right'/, '点选左半场星时浮卡必须能挂到右上角');
assert.match(growthStyles, /\.evidenceDock \.collapse > div::-webkit-scrollbar/, '证据卡必须隐藏右侧滚动条');
assert.match(growth, /className=\{s\.evidenceMore\}/, '证据卡必须有底部下翻指引');
assert.match(growthStyles, /\.evidenceMore[\s\S]*?linear-gradient\(\s*to top/, '底部必须是可见的渐变阴影横条');
assert.match(growthStyles, /\.evidenceMoreChevron[\s\S]*?border-top:\s*7px solid var\(--ink\)/, '下翻指引必须是月白小三角');
assert.match(growthStyles, /\.evidenceClose[\s\S]*?opacity:\s*0/, '叉号默认必须隐藏');
assert.match(growthStyles, /\.evidenceCloseOn[\s\S]*?opacity:\s*1/, '滑动或靠近右上角时叉号必须浮现');
assert.match(growth, /showEvidenceClose/, '叉号必须由右上角靠近或滑动唤起');
assert.match(growthStyles, /\.evidenceDock \.h3[\s\S]*?font-size:\s*var\(--fs-tiny\)/, '掌握度证据链标题必须缩小');
assert.match(growthStyles, /\.evidenceDock\s*\{[\s\S]*?pointer-events:\s*none/, '星海空态浮卡不得拦截星体点击');
assert.match(growthStyles, /\.evidenceDockOpen\s*\{[\s\S]*?pointer-events:\s*auto/, '打开的证据浮卡必须恢复交互');
assert.match(growthStyles, /\.evidenceDock\s*\{[\s\S]*?backdrop-filter:\s*blur/, '证据浮卡必须用磨砂分层压住底下星名');
assert.doesNotMatch(growth, /点一颗星，展开证据链/, '未选星不得常驻空态浮卡');
assert.match(growth, /s\.evidenceClose/, '星海证据浮卡必须可直接收起');
assert.match(growthStyles, /\.evidenceClose\s*\{[\s\S]*?border-radius:\s*0/, '关闭叉号不得再套圆框');
assert.match(growthStyles, /\.evidenceClose\s*\{[\s\S]*?background:\s*transparent/, '关闭叉号必须裸露');
assert.match(growthStyles, /\.evidenceDock\s*\{[\s\S]*?background:\s*color-mix/, '证据浮卡背景必须半透明');
assert.match(seaList, /data-star-id=\{node\.topic\.topicId\}/, '名录视图必须保留关闭证据后的焦点返还锚点');
assert.match(seaStyles, /\.node\[data-selected='true'\]::before[\s\S]*?opacity:\s*1/, '选中星宿必须有明确环形反馈');
assert.match(seaStyles, /\.node\[data-selected='true'\]::after[\s\S]*?opacity:\s*1/, '选中星宿必须带准星十字刻度');
assert.match(seaStyles, /\.node\[data-selected='true'\] \.nodeCopy[\s\S]*?background:\s*none/, '选中题签不得再铺填充底');
assert.match(seaStyles, /\.node\[data-selected='true'\] \.nodeCopy b[\s\S]*?color:\s*var\(--sky-moon\)/, '选中题签必须保持月白');

console.log('ui feedback contract: all assertions passed');
