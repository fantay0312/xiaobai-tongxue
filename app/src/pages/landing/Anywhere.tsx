/** 第七章「随」：手机上的终端、实时语音输入、八套皮肤与个性化、常驻伙伴。 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import {
  ArrowUp, AudioLines, BookOpen, Check, ChevronDown, ChevronRight, ImagePlus, Keyboard, LayoutPanelLeft, Menu as MenuIcon,
  MessageSquare, Mic, Minus, Move, Palette, PanelLeft, Plus, RotateCcw, Search, Settings, Smartphone, SquarePen, Type,
  UsersRound, Volume2, X,
} from 'lucide-react';
import { Button, Segmented } from '../../components/ui';
import { IconGrowth } from '../../components/ui/icons';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { XiaoyanPet } from '../../components/coach/XiaoyanPet';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SKINS, useSkinStore } from '../../store/skinStore';
import { TERMINAL_NAV } from '../learn/shell/views';
import { Caps, type Cap } from './Caps';
import { ChapterHead } from './ChapterHead';
import { sectionById } from './sections';
import { useInView } from './useInView';
import base from './landing.module.css';
import s from './anywhere.module.css';

/* ───────────── 手机上的终端：主界面 + 侧栏抽屉 ───────────── */

/** 与真实底栏一致：四个常用板块 + 更多（见 learn/shell/TerminalRail） */
const BAR_VIEWS = ['ask', 'workbench', 'feynman', 'classroom'];

function PhoneMain() {
  return (
    <div className={s.phone} role="img" aria-label="手机上的学习终端：顶栏、对话、停在输入框上沿的小白、输入框与底栏">
      <div className={s.screen}>
        <div className={s.pHead}>
          <span className={s.pIcon}><PanelLeft size={17} strokeWidth={1.75} /></span>
          <span className={s.pCrumb}><span>数据库系统</span><ChevronRight size={12} strokeWidth={2} /><strong>B+ 树索引</strong></span>
          <span className={s.pIcon}><BookOpen size={16} strokeWidth={1.75} /></span>
        </div>
        <div className={s.pFeed}>
          <p className={s.pAsk}>B+ 树为什么适合做范围查询？</p>
          <div className={s.pAnswer}>
            <p>叶子节点按键值顺序串成链表。</p>
            <p>先从根走到起点所在的叶子，再顺着链表往后读，不用每个值都从根查一遍。</p>
          </div>
          <p className={s.pAsk}>那 B 树为什么不行？</p>
          <div className={s.pAnswer}>
            <p>B 树的数据也放在中间节点里。</p>
            <p>范围查询得在树里上下来回走，读的页更多。</p>
          </div>
        </div>
        <div className={s.pBuddy}>
          <span className={s.pBuddyFace}><XiaobaiAvatar mood="curious" level={2} size={40} /></span>
          <span className={s.pBuddyLine}>等你学懂了，试着讲给我听吧。</span>
        </div>
        <div className={s.pComposer}>
          <span className={s.pPlaceholder}>向小砚提问，/ 用快捷指令</span>
          <span className={s.pTools}>
            <span className={s.pTool}><Plus size={15} strokeWidth={1.75} /></span>
            <span className={s.pPill}>问小砚<ChevronDown size={11} strokeWidth={2} /></span>
            <span className={s.pGrow} />
            <span className={s.pTool}><Mic size={15} strokeWidth={1.75} /></span>
            <span className={s.pSend}><ArrowUp size={15} strokeWidth={2.25} /></span>
          </span>
        </div>
        <div className={s.pBar}>
          {TERMINAL_NAV.filter((item) => BAR_VIEWS.includes(item.view)).map(({ view, label, icon: ItemIcon }) => (
            <span key={view} className={s.pBarItem} data-on={view === 'ask' || undefined}>
              <span className={s.pBarIcon}><ItemIcon size={17} active={view === 'ask'} /></span>
              {label}
            </span>
          ))}
          <span className={s.pBarItem}>
            <span className={s.pBarIcon}><MenuIcon size={17} strokeWidth={1.75} /></span>
            更多
          </span>
        </div>
      </div>
    </div>
  );
}

function PhoneDrawer() {
  return (
    <div className={s.phone} role="img" aria-label="手机上打开侧栏抽屉：新建对话、搜索、全部板块、课程项目与对话记录">
      <div className={s.screen}>
        <div className={s.dBehind}>
          <span className={s.pHead}><span className={s.pIcon}><PanelLeft size={17} strokeWidth={1.75} /></span></span>
          <i /><i /><i /><i />
        </div>
        <div className={s.dSheet}>
          <div className={s.dHead}>
            <strong>小白同学</strong>
            <span className={s.pIcon}><X size={16} strokeWidth={1.75} /></span>
          </div>
          <div className={s.dBody}>
            <span className={s.dNew}><SquarePen size={14} strokeWidth={1.75} />新建对话</span>
            <span className={s.dSearch}><Search size={13} strokeWidth={1.75} />搜索课程、对话、功能</span>
            <span className={s.dHeading}>功能</span>
            {TERMINAL_NAV.map(({ view, label, icon: ItemIcon }) => (
              <span key={view} className={s.dItem} data-on={view === 'ask' || undefined}>
                <ItemIcon size={15} strokeWidth={1.75} active={view === 'ask'} />
                {label}
              </span>
            ))}
            <span className={s.dHeading}>课程项目</span>
            <span className={s.dGroup}><ChevronDown size={12} strokeWidth={2} /><BookOpen size={14} strokeWidth={1.75} />数据库系统<small>2</small></span>
            <span className={s.dTopic} data-on>B+ 树索引</span>
            <span className={s.dTopic}>事务与并发控制</span>
            <span className={s.dHeading}>本课对话</span>
            <span className={s.dItem}><MessageSquare size={14} strokeWidth={1.75} />范围查询怎么做</span>
          </div>
          <div className={s.dFoot}>
            <span className={s.dAvatar}>林</span>
            <span className={s.pGrow} />
            <span className={s.pIcon}><IconGrowth size={16} /></span>
            <span className={s.pIcon}><Settings size={16} strokeWidth={1.75} /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneStage() {
  const [screen, setScreen] = useState<'main' | 'drawer'>('main');
  return (
    <div className={s.phoneBlock}>
      <Segmented
        label="手机界面"
        className={s.phoneSwitch}
        block
        value={screen}
        onChange={setScreen}
        options={[{ value: 'main', label: '主界面' }, { value: 'drawer', label: '打开抽屉' }]}
      />
      <div className={`${base.stage} ${s.phones}`} data-screen={screen}>
        <figure className={s.phoneFig} data-phone="main">
          <PhoneMain />
          <figcaption>主界面：板块在底栏</figcaption>
        </figure>
        <figure className={s.phoneFig} data-phone="drawer">
          <PhoneDrawer />
          <figcaption>点「更多」：侧栏从左边滑出</figcaption>
        </figure>
      </div>
    </div>
  );
}

/* ───────────── 实时语音输入：边说边出字 ───────────── */

/** 每句：识别中途的样子（可能有错字）与定稿 */
const SPOKEN: readonly (readonly [interim: string, final: string])[] = [
  ['我想确认一下，', '我想确认一下，'],
  ['B 加树的数据都放在叶子节点上，', 'B+ 树的数据都放在叶子节点上，'],
  ['所以范围查询顺着叶子往后读就行，对吗？', '所以范围查询顺着叶子往后读就行，对吗？'],
];

interface DictationFrame { committed: string; interim: string; listening: boolean }

const FRAMES: DictationFrame[] = (() => {
  const frames: DictationFrame[] = [{ committed: '', interim: '', listening: true }];
  let committed = '';
  for (const [heard, final] of SPOKEN) {
    const chars = Array.from(heard);
    for (let at = 2; at < chars.length; at += 2) frames.push({ committed, interim: chars.slice(0, at).join(''), listening: true });
    frames.push({ committed, interim: heard, listening: true });
    committed += final;
    frames.push({ committed, interim: '', listening: true });
  }
  frames.push({ committed, interim: '', listening: false });
  return frames;
})();

/** 减弱动效时的定格：两句已定稿、最后一句还在识别 */
const STILL: DictationFrame = { committed: SPOKEN[0][1] + SPOKEN[1][1], interim: SPOKEN[2][0], listening: true };

function useDictationDemo(active: boolean, reduced: boolean): DictationFrame {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reduced || !active) return undefined;
    const last = FRAMES.length - 1;
    const frame = FRAMES[index];
    const delay = index === last ? 3200 : index === 0 ? 900 : frame.interim ? 120 : 520;
    const timer = window.setTimeout(() => setIndex(index === last ? 0 : index + 1), delay);
    return () => window.clearTimeout(timer);
  }, [active, reduced, index]);
  return reduced ? STILL : FRAMES[index];
}

function VoiceDemo() {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>(0.4);
  const { committed, interim, listening } = useDictationDemo(inView, reduced);
  const empty = !committed && !interim;
  return (
    <div ref={ref} className={`${base.panel} ${s.voicePanel}`} data-reveal>
      <p className={s.srOnly}>示例：边说边出字，输入框里依次出现「{SPOKEN.map(([, final]) => final).join('')}」。</p>
      <div className={s.vBox} data-listening={listening || undefined} aria-hidden="true">
        <p className={s.vText}>
          {empty && <span className={s.vPlaceholder}>向小砚提问，/ 用快捷指令，@ 引用我的内容</span>}
          {committed}
          {interim && <span className={s.vInterim}>{interim}</span>}
          {listening && !empty && <i className={s.vCaret} />}
        </p>
        <div className={s.vTools}>
          <span className={s.vTool}><Plus size={17} strokeWidth={1.75} /></span>
          <span className={s.vPill}>问小砚<ChevronDown size={12} strokeWidth={2} /></span>
          <span className={s.vPill}><BookOpen size={13} strokeWidth={1.75} />3 份资料</span>
          <span className={s.pGrow} />
          <span className={s.vMic} data-on={listening || undefined}><Mic size={17} strokeWidth={1.75} /></span>
          <span className={s.vSend} data-ready={!listening || undefined}><ArrowUp size={17} strokeWidth={2.25} /></span>
        </div>
      </div>
      <p className={s.vFoot} aria-hidden="true">
        <span>回答基于所选资料，重要结论请核对原文</span>
        {listening ? <span className={s.vLive}>正在听写，再点一次麦克风结束</span> : <span>Enter 发送 · Shift + Enter 换行</span>}
      </p>
      <ul className={s.vLegend} aria-label="识别的两种状态">
        <li><span className={s.vSwatch} data-kind="final" />已定稿的句子</li>
        <li><span className={s.vSwatch} data-kind="interim" />正在说的这一句，可能还会改</li>
      </ul>
    </div>
  );
}

/* ───────────── 皮肤：点一下，整页换 ───────────── */

function SkinPicker() {
  const skin = useSkinStore((state) => state.skin);
  const update = useSkinStore((state) => state.update);
  const current = SKINS.find((item) => item.id === skin) ?? SKINS[0];

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const at = (SKINS.findIndex((item) => item.id === skin) + step + SKINS.length) % SKINS.length;
    update({ skin: SKINS[at].id });
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[at]?.focus();
  };

  return (
    <div className={s.skins}>
      <div className={s.blockText} data-reveal>
        <span className={s.blockIcon}><Palette size={18} strokeWidth={1.75} /></span>
        <h3>八套皮肤，点一下整页就换</h3>
        <p>这一页和学习终端用的是同一套皮肤。点任意一块色板，这一页立刻换上；在同一个浏览器里打开终端，也是这一套。</p>
        <p className={s.skinNow} aria-live="polite">
          <span>当前</span><strong>{current.name}</strong><span>{current.hint}</span>
        </p>
        {skin !== 'light' && (
          <Button variant="ghost" className={s.skinReset} icon={<RotateCcw size={15} strokeWidth={1.75} />} onClick={() => update({ skin: 'light' })}>
            换回素白
          </Button>
        )}
      </div>
      <div className={s.skinGrid} role="radiogroup" aria-label="选择皮肤" onKeyDown={onKey} data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}>
        {SKINS.map((item) => {
          const on = item.id === skin;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              aria-label={`${item.name}：${item.hint}`}
              className={s.skin}
              onClick={() => update({ skin: item.id })}
            >
              <span
                className={s.thumb}
                data-dark={item.dark || undefined}
                style={{ '--t-bg': item.swatch[0], '--t-side': item.swatch[1], '--t-accent': item.swatch[2] } as CSSProperties}
                aria-hidden="true"
              >
                <i className={s.thumbSide} />
                <i className={s.thumbLine} />
                <i className={s.thumbLine} />
                <i className={s.thumbAccent} />
                {on && <span className={s.thumbCheck}><Check size={13} strokeWidth={2.6} /></span>}
              </span>
              <span className={s.skinName}>{item.name}</span>
              <span className={s.skinHint}>{item.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────── 外观设置（静态复刻，选中项跟随你当前的偏好） ───────────── */

const SETTING_NAV = ['外观', '模型', '语音', '小白与记忆', '数据与隐私', '关于'];
const WALLPAPERS = ['晨雾', '暖阳', '松林', '夜航', '方格纸', '点阵'];

function Seg({ options, value }: { options: readonly (readonly [string, string])[]; value: string }) {
  return (
    <span className={s.sSeg}>
      {options.map(([id, label]) => <span key={id} data-on={id === value || undefined}>{label}</span>)}
    </span>
  );
}

function LookSettings() {
  const prefs = useSkinStore();
  return (
    <div
      className={`${base.panel} ${s.settings}`}
      role="img"
      aria-label="设置里的外观页：强调色、圆角、密度、字体、字号、对话样式、壁纸与常驻伙伴"
      data-reveal
    >
      <div className={s.sNav}>
        <span className={s.sNavTitle}>设置</span>
        {SETTING_NAV.map((label) => <span key={label} data-on={label === '外观' || undefined}>{label}</span>)}
      </div>
      <div className={s.sBody}>
        <span className={s.sGroup}>皮肤与字</span>
        <div className={s.sRow}>
          <span className={s.sLabel}>强调色<small>选中、链接和进度</small></span>
          <span className={s.sDots}>
            <span className={s.sFollow} data-on={!prefs.accent || undefined}>跟随皮肤</span>
            {SKINS.map((item) => <i key={item.id} style={{ background: item.swatch[2] }} />)}
            <span className={s.sPick}><Palette size={12} strokeWidth={1.75} /></span>
          </span>
        </div>
        <div className={s.sRow}>
          <span className={s.sLabel}>圆角</span>
          <Seg value={prefs.radius} options={[['sharp', '锐利'], ['default', '默认'], ['round', '圆润']]} />
        </div>
        <div className={s.sRow}>
          <span className={s.sLabel}>密度<small>按钮与输入框的高矮</small></span>
          <Seg value={prefs.density} options={[['compact', '紧凑'], ['comfortable', '舒适']]} />
        </div>
        <div className={s.sRow}>
          <span className={s.sLabel}>字体</span>
          <Seg value={prefs.font} options={[['system', '系统'], ['wenkai', '霞鹜文楷'], ['serif', '衬线'], ['mono', '等宽']]} />
        </div>
        <div className={s.sRow}>
          <span className={s.sLabel}>字号</span>
          <span className={s.sRange}>
            <span className={s.sTrack}><i style={{ '--at': `${((prefs.fontScale - 0.9) / 0.25) * 100}%` } as CSSProperties} /></span>
            <b>{Math.round(prefs.fontScale * 100)}%</b>
          </span>
        </div>
        <div className={s.sRow}>
          <span className={s.sLabel}>对话样式<small>{prefs.chatStyle === 'bubble' ? '一问一答分列左右' : '回答铺满一栏，像读文档'}</small></span>
          <Seg value={prefs.chatStyle} options={[['document', '文档'], ['bubble', '气泡']]} />
        </div>
        <span className={s.sGroup}>壁纸</span>
        <div className={s.walls}>
          <span className={s.wall}><i data-kind="none" />不用壁纸</span>
          <span className={s.wall}><i data-kind="upload"><ImagePlus size={14} strokeWidth={1.75} /></i>上传图片</span>
          {WALLPAPERS.map((name, index) => <span key={name} className={s.wall}><i data-kind={`w${index}`} />{name}</span>)}
        </div>
        <div className={s.sRow}>
          <span className={s.sLabel}>常驻伙伴<small>小白或小砚停在终端一角</small></span>
          <span className={s.sSwitch} data-on={prefs.companion || undefined}><i /></span>
        </div>
      </div>
    </div>
  );
}

/* ───────────── 常驻伙伴：可切换、可收起、可拖动 ───────────── */

type Actor = 'xiaoyan' | 'xiaobai';
const NUDGE: Record<string, readonly [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function CompanionDemo() {
  const [actor, setActor] = useState<Actor>('xiaobai');
  const [minimized, setMinimized] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const name = actor === 'xiaoyan' ? '小砚' : '小白';
  const line = actor === 'xiaoyan' ? '有不明白的，随时叫我。' : '等你学懂了，试着讲给我听吧。';

  /** 卡片在台面里能移动的范围（相对初始位置） */
  const bounds = () => {
    const stage = stageRef.current?.getBoundingClientRect();
    const card = cardRef.current?.getBoundingClientRect();
    if (!stage || !card) return null;
    const left = card.left - offset.x;
    const top = card.top - offset.y;
    return { minX: stage.left + 10 - left, maxX: stage.right - 10 - card.width - left, minY: stage.top + 10 - top, maxY: stage.bottom - 10 - card.height - top };
  };
  const place = (x: number, y: number) => {
    const b = bounds();
    if (b) setOffset({ x: clamp(x, b.minX, Math.max(b.minX, b.maxX)), y: clamp(y, b.minY, Math.max(b.minY, b.maxY)) });
  };

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const from = drag.current;
    if (from) place(from.ox + event.clientX - from.x, from.oy + event.clientY - from.y);
  };
  const up = () => { drag.current = null; setDragging(false); };
  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Home') { event.preventDefault(); setOffset({ x: 0, y: 0 }); return; }
    const delta = NUDGE[event.key];
    if (!delta) return;
    event.preventDefault();
    place(offset.x + delta[0], offset.y + delta[1]);
  };
  const moved = offset.x !== 0 || offset.y !== 0;

  return (
    <div ref={stageRef} className={s.buddyStage} data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}>
      <span className={s.buddySide} aria-hidden="true"><i /><i /><i /><i /></span>
      <span className={s.buddyComposer} aria-hidden="true">向{name}提问…<Mic size={14} strokeWidth={1.75} /></span>
      {minimized ? (
        <button type="button" className={s.restore} onClick={() => setMinimized(false)}>
          <UsersRound size={15} strokeWidth={1.75} />唤回{name}
        </button>
      ) : (
        <aside
          ref={cardRef}
          className={s.buddy}
          aria-label="常驻学习伙伴（示例）"
          data-dragging={dragging || undefined}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        >
          <div className={s.buddyBar}>
            <button
              type="button"
              className={s.buddyBtn}
              aria-label="拖动学习伙伴，可用方向键移动，Home 放回原位"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onKeyDown={key}
              data-handle
            >
              <Move size={15} strokeWidth={1.75} />
            </button>
            <span>学习伙伴</span>
            <button type="button" className={s.buddyBtn} aria-label="收起学习伙伴" onClick={() => setMinimized(true)}>
              <Minus size={15} strokeWidth={1.75} />
            </button>
          </div>
          <div className={s.buddyFigure}>
            {actor === 'xiaoyan'
              ? <XiaoyanPet state="idle" suppressReply className={s.pet} aria-label="和小砚打个招呼" />
              : <XiaobaiAvatar mood="curious" level={2} size={112} />}
          </div>
          <p className={s.buddyLine} aria-live="polite">{line}</p>
          <div className={s.buddySwitch} role="group" aria-label="选择学习伙伴">
            <button type="button" aria-pressed={actor === 'xiaoyan'} onClick={() => setActor('xiaoyan')}>小砚<small>助理</small></button>
            <button type="button" aria-pressed={actor === 'xiaobai'} onClick={() => setActor('xiaobai')}>小白<small>学生</small></button>
          </div>
        </aside>
      )}
      {moved && !minimized && (
        <button type="button" className={s.buddyReset} onClick={() => setOffset({ x: 0, y: 0 })}>放回原位</button>
      )}
    </div>
  );
}

/* ───────────── 本章能力清单 ───────────── */

const CAPS: Cap[] = [
  { icon: LayoutPanelLeft, title: '侧栏收进抽屉', text: '手机上点左上角或底栏「更多」，新建对话、搜索、全部板块、课程项目和对话记录从左边滑出。' },
  { icon: Smartphone, title: '常用板块在底栏', text: '对话、工作台、教小白、AI 课堂常驻底栏，其余板块在「更多」里。' },
  { icon: Keyboard, title: '键盘弹起不挡输入框', text: '软键盘弹出时，终端收到键盘上方，底栏先让开。' },
  { icon: Mic, title: '实时语音输入', text: '点输入框旁的麦克风开口说，字边说边出；再点一次结束，改好了再发。' },
  { icon: AudioLines, title: '识别线路自动兜底', text: '服务器开通了实时识别就用它，声音由浏览器直接送去识别；没开通时用浏览器自带的识别，都不可用就不显示麦克风。' },
  { icon: Mic, title: '讲课也能口述', text: '给小白上课时，讲桌上的麦克风把口述转成文字，落进输入框由你改定再发。' },
  { icon: Volume2, title: '朗读回答', text: '小砚的回答可以用浏览器语音读出来，再点一次停下。' },
  { icon: Palette, title: '八套皮肤', text: '素白、墨夜、暖纸、青瓷、晴蓝、樱粉、深海、终端，深色皮肤三套。' },
  { icon: Palette, title: '强调色', text: '跟随皮肤，或从八种预设里选，也能用取色器自定。' },
  { icon: Type, title: '圆角、密度、字体、字号', text: '圆角三档、密度两档；字体可选系统、霞鹜文楷、衬线、等宽；字号 90% 到 115%。' },
  { icon: ImagePlus, title: '壁纸', text: '六张内置壁纸，或上传自己的图片；面板不透明度可调，保证文字看得清。' },
  { icon: MessageSquare, title: '对话样式', text: '文档式让回答铺满一栏，气泡式一问一答分列左右。' },
  { icon: UsersRound, title: '常驻伙伴', text: '小砚或小白停在终端一角，可切换、收起、拖动；点它能开始学习、看拜师帖或去讲给小白听。' },
  { icon: RotateCcw, title: '一键恢复默认', text: '「恢复默认外观」把皮肤、颜色、字体与壁纸一次还原，还能就地撤销。' },
  { icon: Settings, title: '外观只存在本机', text: '外观偏好保存在这台设备的浏览器里，改动立即生效，不进学习存档。' },
];

export function Anywhere() {
  const meta = sectionById('anywhere');
  return (
    <section id={meta.id} className={base.chapter} aria-labelledby="anywhere-title">
      <div className={base.wrap}>
        <ChapterHead
          no={meta.no!}
          glyph={meta.glyph!}
          name={meta.label}
          titleId="anywhere-title"
          title="在手机上，也是同一个终端"
          lead="侧栏收进抽屉，板块挪到底栏，输入框始终够得着；想说就说，字会自己落进输入框。皮肤、字体、壁纸和常驻伙伴，按你的习惯来。"
        />

        <div className={base.chapterBody}>
          <div className={base.split}>
            <div className={base.sticky} data-reveal>
              <ul className={base.points}>
                <li><strong>侧栏收进抽屉</strong><span>点左上角或底栏的「更多」，课程项目、对话记录和全部板块从左边滑出来。</span></li>
                <li><strong>常用板块在底栏</strong><span>对话、工作台、教小白、AI 课堂一直在拇指下面。</span></li>
                <li><strong>键盘弹起，输入框跟上</strong><span>软键盘弹出时，终端收到键盘上方，底栏先让开。</span></li>
                <li><strong>伙伴停在输入框上沿</strong><span>手机上小白或小砚不挡内容，停在输入框上方。</span></li>
              </ul>
            </div>
            <div data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}>
              <PhoneStage />
            </div>
          </div>

          <div className={s.voice}>
            <div className={s.blockText} data-reveal>
              <span className={s.blockIcon}><Mic size={18} strokeWidth={1.75} /></span>
              <h3>说话，字就落进输入框</h3>
              <p>点输入框旁的麦克风开口说，说完再点一次。正在说的那句先浅色显示，说完一句就定下来；落进输入框的字可以改了再发。</p>
              <ul className={s.facts}>
                <li><strong>边说边出字</strong>服务器开通实时语音识别时，中文里夹着英文术语也能认；声音由浏览器直接送去识别，不经过本站服务器。</li>
                <li><strong>没开通也能用</strong>改用浏览器自带的语音识别；两样都用不了，麦克风按钮就不出现。</li>
                <li><strong>讲课时口述</strong>给小白上课的讲桌上也有麦克风，口述转成文字后由你改定再发。</li>
              </ul>
            </div>
            <VoiceDemo />
          </div>

          <SkinPicker />

          <div className={s.personal}>
            <div className={s.personalCol}>
              <div className={s.blockText} data-reveal>
                <h3>再细一点：颜色、字和壁纸</h3>
                <p>设置里的「外观」一页，改动立即生效，只保存在这台设备。下面的选中项就是你现在的偏好。</p>
              </div>
              <LookSettings />
            </div>
            <div className={s.personalCol}>
              <div className={s.blockText} data-reveal>
                <h3>常驻伙伴，陪在一角</h3>
                <p>小白或小砚停在终端一角。拖着它换个位置，不用时收起来，想找再唤回。试试拖一下、换个人。</p>
              </div>
              <CompanionDemo />
            </div>
          </div>
        </div>

        <Caps label="手机与个性化的全部能力" items={CAPS} />
      </div>
    </section>
  );
}
