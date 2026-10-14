/**
 * 设置 —— 左侧分区目录 + 右侧滚动内容。
 * 「外观」是皮肤与个性化的陈列台（store/skinStore），改动即时生效，只保存在本机浏览器。
 * 「模型」里的自定义线路是一套完整的接口配置：协议、地址、密钥、勾选模型、测试（lib/providers）。
 * 「小白与记忆」里可以用文字写角色卡（store/personaCard），并对着固定一句讲解试听。
 * 评估与状态机永远本地规则运行，模型只负责理解与台词。
 */
import {
  useCallback, useEffect, useId, useRef, useState,
  type ChangeEvent, type ComponentProps, type CSSProperties, type FormEvent, type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { Tabs as RTabs } from 'radix-ui';
import {
  Brain, Check, ChevronsUpDown, CircleCheck, CircleX, Cpu, Download, Eye, EyeOff, ImagePlus, Info, Mic, Palette,
  Pipette, Play, Plus, RefreshCw, RotateCcw, Route, Search, ShieldCheck, Star, Trash2, type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { DEFAULT_SKIN, SKINS, useSkinStore, type SkinPrefs } from '../../store/skinStore';
import { useModelPrefs } from '../../store/modelPrefs';
import { studyData } from '../../store/studyData';
import { PERSONA_CARD_MAX, PERSONA_CARD_TEMPLATES, personaCard, usePersonaCard } from '../../store/personaCard';
import { ModelUnavailableError, loadModelCatalog, streamModel, type ModelCatalog } from '../../lib/modelGateway';
import { LLM_PROTOCOLS, listModels, testConnection, type ProviderModel } from '../../lib/providers';
import { llmCall } from '../../engine';
import { relDay } from '../../lib/relDay';
import type { LlmProtocol, LlmSettings, Persona } from '../../types';
import { isTourDone, resetTours, type TourKey } from '../tour/tourState';
import { XiaobaiFace } from '../xiaobai/XiaobaiAvatar';
import {
  Badge, Button, Dialog, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuTrigger, ModelPicker,
  Segmented, Switch, Textarea, ThinkingDots, cx, toast,
} from '../ui';
import { useSheetKeyboardInset } from './ProfileSheetKeyboard';
import s from './SettingsDialog.module.css';
import { ReaderMediaSettings } from './ReaderMediaSettings';

/* ───────────────────────── 分区目录 ───────────────────────── */

type SectionId = 'look' | 'model' | 'voice' | 'xiaobai' | 'data' | 'about';

const SECTIONS: { id: SectionId; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'look', label: '外观', hint: '皮肤、强调色、字体与壁纸，改动立即生效，只保存在这台设备。', icon: Palette },
  { id: 'model', label: '模型', hint: '小白与小砚走哪条线路、用哪些模型。', icon: Cpu },
  { id: 'voice', label: '语音', hint: '讲课时把口述转成文字。', icon: Mic },
  { id: 'xiaobai', label: '小白与记忆', hint: '小白的性格、说话方式，以及他记住了什么。', icon: Brain },
  { id: 'data', label: '数据与隐私', hint: '导出或清空你的学习记录。', icon: ShieldCheck },
  { id: 'about', label: '关于', hint: '产品信息与新手引路。', icon: Info },
];

/* ───────────────────────── 外观：选项表 ───────────────────────── */

const ACCENTS: { value: string; name: string }[] = [
  { value: '#3b72e6', name: '钴蓝' },
  { value: '#6d5ce8', name: '堇紫' },
  { value: '#cf4d77', name: '樱红' },
  { value: '#d9532b', name: '赭橙' },
  { value: '#b7791f', name: '琥珀' },
  { value: '#2f8562', name: '松绿' },
  { value: '#0e8fa0', name: '湖青' },
  { value: '#5b6577', name: '石墨' },
];

const RADIUS_OPTIONS: { value: SkinPrefs['radius']; label: string }[] = [
  { value: 'sharp', label: '锐利' },
  { value: 'default', label: '默认' },
  { value: 'round', label: '圆润' },
];

const DENSITY_OPTIONS: { value: SkinPrefs['density']; label: string }[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'comfortable', label: '舒适' },
];

const FONT_OPTIONS: { value: SkinPrefs['font']; label: string }[] = [
  { value: 'system', label: '系统' },
  { value: 'wenkai', label: '霞鹜文楷' },
  { value: 'serif', label: '衬线' },
  { value: 'mono', label: '等宽' },
];

const CHAT_OPTIONS: { value: SkinPrefs['chatStyle']; label: string }[] = [
  { value: 'document', label: '文档' },
  { value: 'bubble', label: '气泡' },
];

/* ───────────────────────── 外观：壁纸 ───────────────────────── */

/** data URL 长度上限（约 1.2MB），给 localStorage 里的其他数据留余量 */
const WALLPAPER_MAX_CHARS = 1_200_000;
const WALLPAPER_SOURCE_MAX_BYTES = 30 * 1024 * 1024;
/** 逐档收紧：先按 1920px / 0.82 出图，仍超限再降边长与质量 */
const WALLPAPER_STEPS: readonly (readonly [edge: number, quality: number])[] = [[1920, 0.82], [1600, 0.76], [1280, 0.7]];

function svgWallpaper(body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

type Blob3 = readonly [x: number, y: number, r: number, color: string, opacity: number];

/** 几团柔光叠在底色上的渐变壁纸；extra 可再叠一层图案 */
function meshWallpaper(base: string, blobs: readonly Blob3[], extra = ''): string {
  const defs = blobs.map(([x, y, r, color, opacity], index) => (
    `<radialGradient id="g${index}" gradientUnits="userSpaceOnUse" cx="${x}" cy="${y}" r="${r}">`
    + `<stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/>`
    + `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`
  )).join('');
  const layers = blobs.map((_, index) => `<rect width="1600" height="1000" fill="url(#g${index})"/>`).join('');
  return svgWallpaper(`<defs>${defs}</defs><rect width="1600" height="1000" fill="${base}"/>${layers}${extra}`);
}

/** 固定种子的星点，保证每次生成的壁纸完全一致（选中态靠字符串相等判断） */
function starField(count: number): string {
  let seed = 20261014;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  let out = '';
  for (let index = 0; index < count; index += 1) {
    const x = Math.round(next() * 1600);
    const y = Math.round(next() * 1000);
    const r = (0.6 + next() * 1.4).toFixed(1);
    const opacity = (0.25 + next() * 0.6).toFixed(2);
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" fill-opacity="${opacity}"/>`;
  }
  return out;
}

const WALLPAPERS: { id: string; name: string; url: string }[] = [
  {
    id: 'mist',
    name: '晨雾',
    url: meshWallpaper('#eef2fb', [[260, 180, 760, '#9db8ff', 0.85], [1340, 260, 660, '#f3b6d6', 0.7], [900, 980, 780, '#b9e6dc', 0.75]]),
  },
  {
    id: 'sunset',
    name: '暖阳',
    url: meshWallpaper('#fbf1e4', [[240, 880, 780, '#ffb37a', 0.8], [1320, 160, 720, '#ffd98a', 0.75], [820, 420, 520, '#f7a7a0', 0.45]]),
  },
  {
    id: 'pine',
    name: '松林',
    url: meshWallpaper('#eaf3ec', [[300, 240, 720, '#8fd0a8', 0.8], [1380, 840, 780, '#5aa98c', 0.6], [980, 120, 500, '#d6e9a8', 0.6]]),
  },
  {
    id: 'night',
    name: '夜航',
    url: meshWallpaper(
      '#0b1020',
      [[320, 220, 780, '#2b4aa8', 0.85], [1340, 800, 740, '#5a2f8f', 0.7], [900, 80, 440, '#1c8a9a', 0.45]],
      starField(90),
    ),
  },
  {
    id: 'grid',
    name: '方格纸',
    url: svgWallpaper(
      '<defs><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse">'
      + '<path d="M40 0H0V40" fill="none" stroke="#7b8494" stroke-opacity="0.3" stroke-width="1"/></pattern>'
      + '<pattern id="q" width="200" height="200" patternUnits="userSpaceOnUse">'
      + '<path d="M200 0H0V200" fill="none" stroke="#7b8494" stroke-opacity="0.38" stroke-width="1.5"/></pattern></defs>'
      + '<rect width="1600" height="1000" fill="#f6f7f9"/><rect width="1600" height="1000" fill="url(#p)"/>'
      + '<rect width="1600" height="1000" fill="url(#q)"/>',
    ),
  },
  {
    id: 'dots',
    name: '点阵',
    url: svgWallpaper(
      '<defs><pattern id="d" width="28" height="28" patternUnits="userSpaceOnUse">'
      + '<circle cx="14" cy="14" r="1.6" fill="#ffffff" fill-opacity="0.2"/></pattern>'
      + '<radialGradient id="v" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#27303d"/>'
      + '<stop offset="1" stop-color="#0d1015"/></radialGradient></defs>'
      + '<rect width="1600" height="1000" fill="url(#v)"/><rect width="1600" height="1000" fill="url(#d)"/>',
    ),
  },
];

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    image.src = url;
  });
}

type WallpaperResult = { ok: true; url: string } | { ok: false; message: string };

/** 把用户选的图片压成能放进 localStorage 的 JPEG data URL */
async function imageToWallpaper(file: File): Promise<WallpaperResult> {
  if (!file.type.startsWith('image/')) return { ok: false, message: '请选择一张图片（JPG、PNG 或 WebP）。' };
  if (file.size > WALLPAPER_SOURCE_MAX_BYTES) return { ok: false, message: '原图超过 30 MB，请先换一张小一些的。' };
  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch {
    return { ok: false, message: '这张图片读不出来，请换一张再试。' };
  }
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height) return { ok: false, message: '这张图片读不出来，请换一张再试。' };
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return { ok: false, message: '浏览器不支持图片处理，壁纸没有设置。' };
  for (const [edge, quality] of WALLPAPER_STEPS) {
    const scale = Math.min(1, edge / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    // JPEG 没有透明通道：先铺白底，透明 PNG 才不会变黑
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= WALLPAPER_MAX_CHARS) return { ok: true, url };
  }
  return { ok: false, message: '这张图片压缩后仍超过 1.2 MB，浏览器存不下。请换一张细节少一些或尺寸更小的图片。' };
}

/* ───────────────────────── 模型 / 语音 / 小白：选项表 ───────────────────────── */

type TestState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'ok'; detail: string }
  | { status: 'fail'; detail: string };

/* 线路只有两条。本地台词是线路连不上时的临时兜底，不是可选项 */
const LINE_MODES = [
  { id: 'proxy', short: '服务器', desc: '走服务器网关调用模型，密钥不出服务器，需要登录。' },
  { id: 'api', short: '自定义', desc: '浏览器用你自己的接口和密钥直连模型，可选协议、可勾选模型，密钥只存本机。' },
] as const;
type LineMode = (typeof LINE_MODES)[number]['id'];

const ASR_MODES = [
  { id: 'proxy', short: '服务器', desc: '走服务器网关转写，密钥不出服务器，需要登录。' },
  { id: 'api', short: '自定义', desc: '浏览器直连你自己的转写端点，密钥只存本机。' },
] as const;

const PERSONAS: { value: Persona; line: string }[] = [
  { value: '好奇型', line: '「哇，为什么会这样？然后呢然后呢？」' },
  { value: '严谨型', line: '「等等，这个说法有依据吗？边界在哪儿？」' },
  { value: '杠精型', line: '「我不信。你要是对的，这段代码怎么解释？」' },
];

/* 活泼程度五档（settings.temperature 0–1）：描述倾向，不许诺具体行为（台词仍由引擎定） */
const LIVELINESS = [
  { at: 0, name: '沉稳', line: '字斟句酌，一句只说一件事，几乎不发散。' },
  { at: 0.25, name: '稳当', line: '话不多，想清楚了再问，紧跟你的思路。' },
  { at: 0.5, name: '平和', line: '有问有答，偶尔打个比方。' },
  { at: 0.75, name: '活泼', line: '爱举例子也爱追问，语气更有起伏。' },
  { at: 1, name: '跳脱', line: '想到哪说到哪，时不时蹦出个新鲜联想。' },
] as const;
type LivelinessStop = (typeof LIVELINESS)[number];

const livelinessStop = (value: number): LivelinessStop =>
  LIVELINESS[Math.min(LIVELINESS.length - 1, Math.max(0, Math.round(value * (LIVELINESS.length - 1))))];

const TOUR_STOPS: { key: TourKey; name: string }[] = [
  { key: 'home', name: '学习终端' },
  { key: 'prep', name: '备课' },
  { key: 'teach', name: '讲给小白' },
];

/* ───────────────────────── 弹窗外壳 ───────────────────────── */

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [active, setActive] = useState<SectionId>('look');
  /* 窄屏目录横排：把朝向如实交给 Tabs，方向键才对得上（断点与 module.css 的 720 咬合） */
  const [narrow, setNarrow] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  useSheetKeyboardInset(paneRef, open);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)');
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0 });
    // 窄屏目录是一条横滑的胶囊：把选中的那一枚带到中间，后面的分区才露得出来
    const nav = navRef.current;
    const chip = nav?.querySelector<HTMLElement>('[data-state="active"]');
    if (nav && chip && nav.scrollWidth > nav.clientWidth) {
      const navBox = nav.getBoundingClientRect();
      const chipBox = chip.getBoundingClientRect();
      const left = nav.scrollLeft + chipBox.left - navBox.left - (navBox.width - chipBox.width) / 2;
      nav.scrollTo({ left, behavior: 'smooth' });
    }
  }, [active]);

  const section = SECTIONS.find((item) => item.id === active) ?? SECTIONS[0];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title="设置"
      size="xl"
      className={s.dialog}
    >
      <RTabs.Root
        className={s.layout}
        value={active}
        onValueChange={(value) => setActive(value as SectionId)}
        orientation={narrow ? 'horizontal' : 'vertical'}
      >
        <RTabs.List ref={navRef} className={s.nav} aria-label="设置分区">
          {SECTIONS.map(({ id, label, icon: IconComp }) => (
            <RTabs.Trigger key={id} value={id} className={s.navItem}>
              <IconComp size={17} strokeWidth={1.75} />
              <span>{label}</span>
            </RTabs.Trigger>
          ))}
        </RTabs.List>

        <div className={s.pane} ref={paneRef}>
          <header className={s.paneHead}>
            <h3>{section.label}</h3>
            <p>{section.hint}</p>
          </header>
          <RTabs.Content value="look" className={s.content}><LookSection /></RTabs.Content>
          <RTabs.Content value="model" className={s.content}><ModelSection /></RTabs.Content>
          <RTabs.Content value="voice" className={s.content}><VoiceSection /></RTabs.Content>
          <RTabs.Content value="xiaobai" className={s.content}><XiaobaiSection onClose={onClose} /></RTabs.Content>
          <RTabs.Content value="data" className={s.content}><DataSection /></RTabs.Content>
          <RTabs.Content value="about" className={s.content}><AboutSection onClose={onClose} /></RTabs.Content>
        </div>
      </RTabs.Root>
    </Dialog>
  );
}

/* ───────────────────────── 1 外观 ───────────────────────── */

const pickPrefs = (state: SkinPrefs): SkinPrefs => ({
  skin: state.skin,
  accent: state.accent,
  radius: state.radius,
  density: state.density,
  font: state.font,
  fontScale: state.fontScale,
  wallpaper: state.wallpaper,
  wallpaperDim: state.wallpaperDim,
  chatStyle: state.chatStyle,
  companion: state.companion,
});

const samePrefs = (a: SkinPrefs, b: SkinPrefs) =>
  (Object.keys(a) as (keyof SkinPrefs)[]).every((key) => a[key] === b[key]);

function LookSection() {
  const store = useSkinStore();
  const { update, reset } = store;
  const prefs = pickPrefs(store);
  const musicOn = useThemeStore((state) => state.musicOn);
  const setMusicOn = useThemeStore((state) => state.setMusicOn);
  const [wallBusy, setWallBusy] = useState(false);
  const [wallIssue, setWallIssue] = useState<string | null>(null);
  /* 恢复默认前的快照：给一次就地撤销的机会 */
  const [undo, setUndo] = useState<SkinPrefs | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const skinMeta = SKINS.find((item) => item.id === prefs.skin) ?? SKINS[0];
  const accent = prefs.accent?.toLowerCase() ?? null;
  const customAccent = accent !== null && !ACCENTS.some((item) => item.value === accent);
  const presetWallpaper = WALLPAPERS.find((item) => item.url === prefs.wallpaper);
  const customWallpaper = prefs.wallpaper !== null && !presetWallpaper;
  const isDefault = samePrefs(prefs, DEFAULT_SKIN);

  const change = (patch: Partial<SkinPrefs>) => {
    setUndo(null);
    update(patch);
  };

  const applyWallpaper = (url: string | null) => {
    const previous = prefs.wallpaper;
    setUndo(null);
    try {
      update({ wallpaper: url });
      setWallIssue(null);
    } catch {
      // 本地存储写不进：退回之前的壁纸，免得刷新后「凭空消失」
      try { update({ wallpaper: previous }); } catch { /* 仍写不进时保持内存态 */ }
      setWallIssue('浏览器的本地存储空间不够，壁纸没有保存。可以换一张更小的图片。');
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || wallBusy) return;
    setWallBusy(true);
    setWallIssue(null);
    const result = await imageToWallpaper(file);
    setWallBusy(false);
    if (result.ok) applyWallpaper(result.url);
    else setWallIssue(result.message);
  };

  const restoreDefault = () => {
    setUndo(prefs);
    setWallIssue(null);
    reset();
  };

  const undoRestore = () => {
    if (!undo) return;
    try { update(undo); } catch { setWallIssue('浏览器的本地存储空间不够，之前的壁纸没能恢复。'); }
    setUndo(null);
  };

  return (
    <div className={s.look}>
      <div className={s.lookMain}>
        <Group title="皮肤">
          <div className={s.skinGrid}>
            {SKINS.map((skin) => {
              const selected = skin.id === prefs.skin;
              return (
                <button
                  key={skin.id}
                  type="button"
                  className={s.skinCard}
                  aria-pressed={selected}
                  onClick={() => change({ skin: skin.id })}
                  style={{
                    '--sw-bg': skin.swatch[0],
                    '--sw-side': skin.swatch[1],
                    '--sw-accent': skin.swatch[2],
                    '--sw-ink': skin.dark ? 'white' : 'black',
                  } as CSSProperties}
                >
                  <span className={s.skinMock} aria-hidden="true">
                    <span className={s.mockSide}><span /><span /><span /><span /></span>
                    <span className={s.mockMain}>
                      <span className={s.mockUser} />
                      <span className={s.mockLine} />
                      <span className={s.mockLine} data-short="true" />
                      <span className={s.mockLink} />
                      <span className={s.mockComposer}><span /></span>
                    </span>
                  </span>
                  <span className={s.skinMeta}>
                    <strong>{skin.name}</strong>
                    <small>{skin.hint}</small>
                  </span>
                  {selected && <span className={s.skinCheck} aria-hidden="true"><Check size={12} strokeWidth={3} /></span>}
                </button>
              );
            })}
          </div>
        </Group>

        <Group title="颜色与形状">
          <Row label="强调色" desc="用在选中、链接和进度上">
            <div className={s.accents}>
              <button
                type="button"
                className={s.accentAuto}
                aria-pressed={accent === null}
                onClick={() => change({ accent: null })}
              >
                <i style={{ background: skinMeta.swatch[2] }} aria-hidden="true" />
                跟随皮肤
              </button>
              {ACCENTS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={s.accentDot}
                  aria-pressed={accent === item.value}
                  aria-label={`强调色：${item.name}`}
                  title={item.name}
                  style={{ '--c': item.value } as CSSProperties}
                  onClick={() => change({ accent: item.value })}
                />
              ))}
              <label
                className={s.accentCustom}
                data-on={customAccent || undefined}
                title="自定义颜色"
                style={customAccent && accent ? ({ '--c': accent } as CSSProperties) : undefined}
              >
                {!customAccent && <Pipette size={14} strokeWidth={1.75} aria-hidden="true" />}
                <input
                  type="color"
                  aria-label="自定义强调色"
                  value={accent ?? skinMeta.swatch[2]}
                  onChange={(event) => change({ accent: event.target.value })}
                />
              </label>
            </div>
          </Row>
          <Row label="圆角">
            <Segmented label="圆角" value={prefs.radius} onChange={(radius) => change({ radius })} options={RADIUS_OPTIONS} />
          </Row>
          <Row label="密度" desc="按钮与输入框的高矮">
            <Segmented label="密度" value={prefs.density} onChange={(density) => change({ density })} options={DENSITY_OPTIONS} />
          </Row>
        </Group>

        <Group title="文字与对话">
          <Row label="字体" desc="「终端」皮肤自带等宽字体">
            <Segmented label="字体" value={prefs.font} onChange={(font) => change({ font })} options={FONT_OPTIONS} />
          </Row>
          <Row label="字号">
            <Range
              label="字号"
              min={0.9}
              max={1.15}
              step={0.05}
              value={prefs.fontScale}
              valueText={`${Math.round(prefs.fontScale * 100)}%`}
              onChange={(fontScale) => change({ fontScale: Math.round(fontScale * 100) / 100 })}
            />
          </Row>
          <Row label="对话样式" desc={prefs.chatStyle === 'bubble' ? '一问一答分列左右，像聊天' : '回答铺满一栏，像读文档'}>
            <Segmented label="对话样式" value={prefs.chatStyle} onChange={(chatStyle) => change({ chatStyle })} options={CHAT_OPTIONS} />
          </Row>
        </Group>

        <Group title="壁纸">
          <div className={s.wallGrid}>
            <button type="button" className={s.wallTile} aria-pressed={prefs.wallpaper === null} onClick={() => applyWallpaper(null)}>
              <span className={s.wallThumb} data-kind="none" aria-hidden="true" />
              <span className={s.wallName}>不用壁纸</span>
            </button>
            <button type="button" className={s.wallTile} disabled={wallBusy} onClick={() => fileRef.current?.click()}>
              <span className={s.wallThumb} data-kind="upload" aria-hidden="true">
                <ImagePlus size={18} strokeWidth={1.75} />
              </span>
              <span className={s.wallName}>{wallBusy ? '正在处理…' : '上传图片'}</span>
            </button>
            {customWallpaper && prefs.wallpaper && (
              <button type="button" className={s.wallTile} aria-pressed="true">
                <span className={s.wallThumb} style={{ backgroundImage: cssUrl(prefs.wallpaper) }} aria-hidden="true" />
                <span className={s.wallName}>我的图片</span>
              </button>
            )}
            {WALLPAPERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={s.wallTile}
                aria-pressed={prefs.wallpaper === item.url}
                onClick={() => applyWallpaper(item.url)}
              >
                <span className={s.wallThumb} style={{ backgroundImage: cssUrl(item.url) }} aria-hidden="true" />
                <span className={s.wallName}>{item.name}</span>
              </button>
            ))}
          </div>
          <input
            ref={fileRef}
            className={s.srOnly}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => void onFile(event)}
          />
          {wallIssue && <p className={s.issue} role="alert">{wallIssue}</p>}
          <Row label="面板不透明度" desc={prefs.wallpaper ? '越高文字越清楚，越低壁纸越明显' : '选一张壁纸后可以调'}>
            <Range
              label="面板不透明度"
              min={0.3}
              max={0.95}
              step={0.05}
              value={prefs.wallpaperDim}
              valueText={`${Math.round(prefs.wallpaperDim * 100)}%`}
              disabled={!prefs.wallpaper}
              onChange={(wallpaperDim) => change({ wallpaperDim: Math.round(wallpaperDim * 100) / 100 })}
            />
          </Row>
          {prefs.wallpaper && (
            <Row label="移除壁纸" desc="回到皮肤自带的纯色背景">
              <Button variant="outline" size="sm" icon={<Trash2 size={14} strokeWidth={1.75} />} onClick={() => applyWallpaper(null)}>
                移除
              </Button>
            </Row>
          )}
        </Group>

        <Group title="陪伴">
          <Row label="常驻伙伴" desc="小白或小砚停在终端一角，随时可以叫它">
            <Switch label="常驻伙伴" checked={prefs.companion} onCheckedChange={(companion) => change({ companion })} />
          </Row>
          <Row label="背景音乐" desc="循环播放，随时可关">
            <Switch label="背景音乐" checked={musicOn} onCheckedChange={() => setMusicOn(!musicOn)} />
          </Row>
        </Group>

        <div className={s.resetBar}>
          {undo ? (
            <>
              <span role="status">已恢复默认外观。</span>
              <Button variant="soft" size="sm" onClick={undoRestore}>撤销</Button>
            </>
          ) : (
            <>
              <span>{isDefault ? '当前就是默认外观。' : '把皮肤、颜色、字体与壁纸一次还原。'}</span>
              <Button
                variant="outline"
                size="sm"
                icon={<RotateCcw size={14} strokeWidth={1.75} />}
                disabled={isDefault}
                onClick={restoreDefault}
              >
                恢复默认外观
              </Button>
            </>
          )}
        </div>
      </div>

      <aside className={s.lookAside} aria-label="外观预览">
        <LookPreview prefs={prefs} skinName={skinMeta.name} />
        <p className={s.asideNote}>
          {skinMeta.name}
          {accent ? ' · 自定义强调色' : ''}
          {prefs.wallpaper ? ` · ${presetWallpaper?.name ?? '我的图片'}` : ''}
        </p>
      </aside>
    </div>
  );
}

const cssUrl = (url: string) => `url("${url.replace(/"/g, '%22')}")`;

/** 实时预览：用当前令牌画一台缩小的终端，壁纸、对话样式与伙伴按偏好呈现 */
function LookPreview({ prefs, skinName }: { prefs: SkinPrefs; skinName: string }) {
  const dim = prefs.wallpaper ? `${Math.round(prefs.wallpaperDim * 100)}%` : '100%';
  return (
    <div
      className={s.preview}
      role="img"
      aria-label={`当前外观预览：${skinName}皮肤，${prefs.chatStyle === 'bubble' ? '气泡' : '文档'}对话`}
      data-chat={prefs.chatStyle}
      style={{
        '--dim': dim,
        ...(prefs.wallpaper ? { backgroundImage: cssUrl(prefs.wallpaper) } : {}),
      } as CSSProperties}
    >
      <div className={s.pvSide} aria-hidden="true">
        <span className={s.pvBrand}><i />小白同学</span>
        <span className={s.pvNav} data-active="true">学习终端</span>
        <span className={s.pvNav}>讲给小白</span>
        <span className={s.pvNav}>成长册</span>
        <span className={s.pvQuest}>
          今日课业
          <span className={s.pvBar}><i /></span>
        </span>
      </div>
      <div className={s.pvMain} aria-hidden="true">
        <div className={s.pvThread}>
          <p className={s.pvUser}>什么是时间复杂度？</p>
          <p className={s.pvBot}>
            看输入变大时，步骤数怎么涨。一层循环跑 n 次，就是 <code>O(n)</code>。
            <span className={s.pvLink}>讲给小白听</span>
          </p>
        </div>
        <div className={s.pvComposer}>
          <span>问小砚…</span>
          <i />
        </div>
        {prefs.companion && <span className={s.pvCompanion}>白</span>}
      </div>
    </div>
  );
}

/* ───────────────────────── 2 模型 ───────────────────────── */

const trimUrl = (value: string) => value.trim().replace(/\/+$/, '');

/** 已启用的模型：settings.models 加上默认模型（老存档只有 model 一项），去重保序 */
function enabledModels(settings: Pick<LlmSettings, 'model' | 'models'>): string[] {
  const list = (settings.models ?? []).map((id) => id.trim()).filter(Boolean);
  const model = settings.model.trim();
  return [...new Set(model && !list.includes(model) ? [model, ...list] : list)];
}

/** 取到的模型列表按连接记在内存里：在设置里换个分区再回来不必重取。键里不放完整密钥 */
const fetchedModelsCache = new Map<string, ProviderModel[]>();
const connectionKey = (protocol: LlmProtocol, baseUrl: string, apiKey: string) =>
  `${protocol}\n${trimUrl(baseUrl)}\n${apiKey.length}:${apiKey.slice(-4)}`;

function ModelSection() {
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const model = useModelPrefs((state) => state.model);
  const effort = useModelPrefs((state) => state.effort);
  const setModel = useModelPrefs((state) => state.setModel);
  const setEffort = useModelPrefs((state) => state.setEffort);
  const resetModelPrefs = useModelPrefs((state) => state.reset);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const testAbort = useRef<AbortController | null>(null);

  /* 旧存档里的 mock 不再是可选项：界面上按「服务器」显示，存储值由迁移任务改写 */
  const line: LineMode = settings.mode === 'api' ? 'api' : 'proxy';
  const protocol: LlmProtocol = settings.protocol ?? 'openai-chat';
  const enabled = enabledModels(settings);
  const apiReady = Boolean(trimUrl(settings.baseUrl) && settings.apiKey && settings.model.trim());
  /* 线路、协议、地址、密钥有无、勾选的模型，任何一项变了都重取一次目录 */
  const catalogKey = [line, protocol, trimUrl(settings.baseUrl), settings.apiKey ? 'key' : '', settings.model, enabled.join('|')].join('\n');

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    loadModelCatalog(controller.signal)
      .then((next) => { if (alive) setCatalog(next); })
      .catch(() => { if (alive) setCatalog({ available: false, models: [], defaultModel: null }); });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [catalogKey]);

  useEffect(() => () => testAbort.current?.abort(), []);

  const patch = (partial: Partial<LlmSettings>) => {
    testAbort.current?.abort();
    setSettings(partial);
    setTest({ status: 'idle' });
  };

  const runProxyTest = async () => {
    setTest({ status: 'busy' });
    const startedAt = performance.now();
    try {
      const reply = await llmCall(
        'xiaobai',
        { system: '你是连接测试,收到任何消息都只回复两个字:在的', user: 'ping' },
        { ...settings, mode: 'proxy', temperature: 0 },
      );
      const ms = Math.round(performance.now() - startedAt);
      setTest({ status: 'ok', detail: `连接成功 · ${ms}ms · ${reply.trim().slice(0, 24)}` });
    } catch (error) {
      setTest({ status: 'fail', detail: `连接失败：${error instanceof Error ? error.message : String(error)}` });
    }
  };

  const runApiTest = async () => {
    testAbort.current?.abort();
    const controller = new AbortController();
    testAbort.current = controller;
    setTest({ status: 'busy' });
    const result = await testConnection(
      { protocol, baseUrl: settings.baseUrl.trim(), apiKey: settings.apiKey, model: settings.model.trim() },
      controller.signal,
    ).catch((error: unknown) => ({
      ok: false,
      message: error instanceof Error && error.message ? error.message : '连接没有成功，请稍后再试',
      latencyMs: undefined,
    }));
    if (controller.signal.aborted) return;
    if (result.ok) {
      const latency = typeof result.latencyMs === 'number' ? ` · ${Math.round(result.latencyMs)}ms` : '';
      setTest({ status: 'ok', detail: `${result.message || '连接成功'}${latency}` });
    } else {
      setTest({ status: 'fail', detail: result.message || '连接没有成功' });
    }
  };

  const hasCatalog = Boolean(catalog?.available && catalog.models.length);

  return (
    <>
      <Group title="线路">
        <Row label="调用方式" desc="线路连不上时，课堂临时改用本地台词，课不会中断">
          <Segmented
            label="模型线路"
            value={line}
            onChange={(mode) => patch({ mode })}
            options={LINE_MODES.map((mode) => ({ value: mode.id, label: mode.short }))}
          />
        </Row>
        <ul className={s.legend}>
          {LINE_MODES.map((mode) => (
            <li key={mode.id} data-on={mode.id === line || undefined}>
              <strong>{mode.short}</strong>
              <span>{mode.desc}</span>
            </li>
          ))}
        </ul>
      </Group>
      <p className={s.foot}>课堂、学习终端、助理任务、AI 课堂、科研台都走这条线路。</p>

      {line === 'proxy' && (
        <Group title="连接">
          <Row label="测试连接" desc="向服务器网关发一句话，看它回不回">
            <ConnTest onTest={() => void runProxyTest()} test={test} />
          </Row>
        </Group>
      )}

      {line === 'api' && (
        <ProviderSetup
          settings={settings}
          protocol={protocol}
          enabled={enabled}
          patch={patch}
          test={test}
          testReady={apiReady}
          onTest={() => void runApiTest()}
        />
      )}

      <Group title="学习终端">
        <Row
          label="默认模型与思考强度"
          desc={hasCatalog
            ? '新对话、阅读问答、全文导读与阅读分类默认用它；可随时切换'
            : line === 'api' ? '填好接口并勾选模型后，这里就能选' : '这条线路现在取不到可选模型，登录后再看'}
        >
          <ModelPicker
            models={catalog?.models ?? []}
            model={model ?? catalog?.defaultModel ?? null}
            effort={effort}
            onModel={setModel}
            onEffort={setEffort}
            onReset={resetModelPrefs}
            side="bottom"
            align="end"
            emptyLabel="暂无可选模型"
          />
        </Row>
      </Group>

      <Group title="阅读语音与封面"><ReaderMediaSettings /></Group>
      <p className={s.foot}>讲解评估与课堂状态始终在本地按规则运行，模型只负责理解与台词。</p>
    </>
  );
}

/** 自定义线路：协议 → 接口地址 → 密钥 → 勾选模型 → 测试 */
function ProviderSetup({ settings, protocol, enabled, patch, test, testReady, onTest }: {
  settings: LlmSettings;
  protocol: LlmProtocol;
  /** 已勾选启用的模型 id */
  enabled: string[];
  patch: (partial: Partial<LlmSettings>) => void;
  test: TestState;
  testReady: boolean;
  onTest: () => void;
}) {
  const info = LLM_PROTOCOLS.find((item) => item.id === protocol) ?? LLM_PROTOCOLS[0];
  const base = trimUrl(settings.baseUrl);
  const key = connectionKey(protocol, settings.baseUrl, settings.apiKey);
  const [fetched, setFetched] = useState<ProviderModel[] | null>(() => fetchedModelsCache.get(key) ?? null);
  const [fetching, setFetching] = useState(false);
  const [fetchIssue, setFetchIssue] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const fetchAbort = useRef<AbortController | null>(null);
  const manualRef = useRef<HTMLInputElement>(null);

  /* 连接一变，旧列表就不作数了：换成这条连接缓存过的那份（没有就空着） */
  useEffect(() => {
    fetchAbort.current?.abort();
    setFetching(false);
    setFetchIssue(null);
    setFetched(fetchedModelsCache.get(key) ?? null);
  }, [key]);

  useEffect(() => () => fetchAbort.current?.abort(), []);

  /* 地址空着，或还停在别的协议的默认地址上：提示可以一键换成当前协议的默认地址 */
  const offerDefault = trimUrl(info.defaultBaseUrl) !== base
    && (!base || LLM_PROTOCOLS.some((item) => item.id !== protocol && trimUrl(item.defaultBaseUrl) === base));
  const canFetch = Boolean(base && settings.apiKey);

  const fetchList = async () => {
    fetchAbort.current?.abort();
    const controller = new AbortController();
    fetchAbort.current = controller;
    setFetching(true);
    setFetchIssue(null);
    try {
      const list = await listModels({ protocol, baseUrl: settings.baseUrl.trim(), apiKey: settings.apiKey }, controller.signal);
      if (controller.signal.aborted) return;
      const seen = new Set<string>();
      const clean = list.filter((item) => item.id && !seen.has(item.id) && seen.add(item.id));
      fetchedModelsCache.set(key, clean);
      setFetched(clean);
      if (!clean.length) setFetchIssue('这个接口没有返回任何模型，可以手动添加。');
    } catch (error) {
      if (controller.signal.aborted) return;
      setFetchIssue(error instanceof Error && error.message ? error.message : '模型列表没有取到，可以手动添加。');
    } finally {
      if (!controller.signal.aborted) setFetching(false);
    }
  };

  /** 写回勾选结果；默认模型不在其中时换成指定的后继，没有就取第一个 */
  const commit = (nextModels: string[], nextDefault = settings.model.trim()) => {
    const models = [...new Set(nextModels.map((id) => id.trim()).filter(Boolean))];
    patch({ models, model: models.includes(nextDefault) ? nextDefault : models[0] ?? '' });
  };

  const toggle = (id: string) => {
    if (!enabled.includes(id)) {
      commit([...enabled, id]);
      return;
    }
    const at = enabled.indexOf(id);
    const rest = enabled.filter((item) => item !== id);
    // 去掉的正好是默认模型：顺位取它后面那一个
    commit(rest, id === settings.model.trim() ? rest[at] ?? rest[0] ?? '' : undefined);
  };

  const addManual = (event: FormEvent) => {
    event.preventDefault();
    const id = manual.trim();
    if (!id) return;
    commit([...enabled, id]);
    setManual('');
  };

  const focusManual = () => {
    manualRef.current?.focus();
    manualRef.current?.scrollIntoView({ block: 'nearest' });
  };

  /* 手动添加、列表里没有的排在前面；取到的列表保持接口给的顺序，勾选时行不跳动 */
  const fetchedIds = new Set(fetched?.map((item) => item.id));
  const rows: ProviderModel[] = [
    ...enabled.filter((id) => !fetchedIds.has(id)).map((id) => ({ id })),
    ...(fetched ?? []),
  ];

  return (
    <Group title="自定义接口">
      <Row label="协议" desc={info.hint}>
        <Segmented
          className={s.protoSeg}
          label="接口协议"
          value={protocol}
          onChange={(next) => patch({ protocol: next })}
          options={LLM_PROTOCOLS.map((item) => ({ value: item.id, label: item.label, title: item.hint }))}
        />
        {/* 手机上四个协议名排不下一行分段，换成一枚下拉 */}
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className={s.protoSelect} aria-label={`接口协议：${info.label}`}>
              <span>{info.label}</span>
              <ChevronsUpDown size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            {LLM_PROTOCOLS.map((item) => (
              <MenuItem
                key={item.id}
                hint={item.hint}
                checked={item.id === protocol}
                onSelect={() => patch({ protocol: item.id })}
              >
                {item.label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </Row>

      <Row label="接口地址" desc={`接口的根地址，例如 ${info.defaultBaseUrl}`} wide>
        <Input
          size="sm"
          type="url"
          inputMode="url"
          value={settings.baseUrl}
          placeholder={info.defaultBaseUrl}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          aria-label="接口地址"
          onChange={(event) => patch({ baseUrl: event.target.value })}
        />
      </Row>
      {offerDefault && (
        <div className={s.offer}>
          <span>{info.label} 的默认地址是 <code>{info.defaultBaseUrl}</code></span>
          <Button variant="soft" size="sm" onClick={() => patch({ baseUrl: info.defaultBaseUrl })}>填入</Button>
        </div>
      )}

      <Row label="密钥" desc="只存在这个浏览器里，不上传" wide>
        <SecretInput
          label="密钥"
          value={settings.apiKey}
          placeholder="sk-…"
          autoComplete="off"
          onChange={(event) => patch({ apiKey: event.target.value })}
        />
        {settings.apiKey && (
          <Button className={s.rowFixed} variant="ghost" size="sm" onClick={() => patch({ apiKey: '' })}>清除</Button>
        )}
      </Row>

      <div className={s.models}>
        <div className={s.modelsHead}>
          <div className={s.rowCopy}>
            <span className={s.rowLabel}>模型</span>
            <span className={s.rowDesc}>
              {canFetch ? '勾选要用的模型，点星标定一个默认' : '填好接口地址和密钥后可以获取列表，也可以直接手动添加'}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            icon={<RefreshCw size={14} strokeWidth={1.75} />}
            loading={fetching}
            disabled={!canFetch}
            onClick={() => void fetchList()}
          >
            {fetching ? '正在获取…' : fetched ? '重新获取' : '获取模型列表'}
          </Button>
        </div>

        {fetchIssue && (
          <div className={s.fetchIssue} role="alert">
            <span>{fetchIssue}</span>
            <Button variant="outline" size="sm" onClick={focusManual}>手动添加</Button>
          </div>
        )}

        {rows.length > 0 && (
          <ModelChecklist
            rows={rows}
            selected={enabled}
            defaultId={settings.model.trim()}
            onToggle={toggle}
            onDefault={(id) => commit(enabled.includes(id) ? enabled : [...enabled, id], id)}
            onSelectMany={(ids) => commit([...enabled, ...ids])}
            onClear={() => commit([])}
          />
        )}

        <form className={s.modelAdd} onSubmit={addManual}>
          <Input
            ref={manualRef}
            size="sm"
            value={manual}
            placeholder="接口不提供列表时，在这里填模型名"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            aria-label="手动添加模型"
            onChange={(event) => setManual(event.target.value)}
          />
          <Button type="submit" variant="soft" size="sm" icon={<Plus size={14} strokeWidth={1.75} />} disabled={!manual.trim()}>
            添加模型
          </Button>
        </form>
      </div>

      <Row
        label="测试连接"
        desc={testReady ? `用默认模型 ${settings.model.trim()} 发一句很短的话` : '先填好接口地址和密钥，并选好默认模型'}
      >
        <ConnTest disabled={!testReady} onTest={onTest} test={test} />
      </Row>
    </Group>
  );
}

/** 清单超过这么多项才出现搜索框 */
const SEARCH_FROM = 8;

/** 模型勾选清单：可搜索，勾选即启用，星标是默认模型 */
function ModelChecklist({ rows, selected, defaultId, onToggle, onDefault, onSelectMany, onClear }: {
  rows: ProviderModel[];
  selected: string[];
  defaultId: string;
  onToggle: (id: string) => void;
  onDefault: (id: string) => void;
  onSelectMany: (ids: string[]) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((row) => row.id.toLowerCase().includes(needle) || row.label?.toLowerCase().includes(needle))
    : rows;
  const chosen = new Set(selected);
  const addable = filtered.filter((row) => !chosen.has(row.id));

  return (
    <div className={s.checklist}>
      <div className={s.checkBar}>
        {/* 只有几项时一眼看得完，搜索框反而碍事 */}
        {rows.length > SEARCH_FROM && (
          <Input
            size="sm"
            wrapClassName={s.checkSearch}
            leading={<Search size={15} strokeWidth={1.75} />}
            value={query}
            placeholder="搜索模型"
            spellCheck={false}
            autoCapitalize="none"
            aria-label="搜索模型"
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <span className={s.checkCount} role="status">
          已选 {selected.length} 个{needle ? ` · 匹配 ${filtered.length} 个` : ` · 共 ${rows.length} 个`}
        </span>
        <span className={s.checkActions}>
          <Button variant="ghost" size="sm" disabled={!addable.length} onClick={() => onSelectMany(addable.map((row) => row.id))}>
            {needle ? '全选筛选结果' : '全选'}
          </Button>
          <Button variant="ghost" size="sm" disabled={!selected.length} onClick={onClear}>清空</Button>
        </span>
      </div>
      <ul className={s.checkList} aria-label="可用模型">
        {filtered.map((row) => {
          const checked = chosen.has(row.id);
          const isDefault = checked && row.id === defaultId;
          return (
            <li key={row.id} className={s.checkRow} data-checked={checked || undefined}>
              <label className={s.checkLabel}>
                <input className={s.checkInput} type="checkbox" checked={checked} onChange={() => onToggle(row.id)} />
                <span className={s.checkBox} aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                <span className={s.checkText}>
                  <code>{row.id}</code>
                  {row.label && row.label !== row.id ? <small>{row.label}</small> : null}
                </span>
              </label>
              {isDefault && <Badge tone="accent">默认</Badge>}
              <button
                type="button"
                className={s.star}
                aria-pressed={isDefault}
                aria-label={isDefault ? `${row.id} 是默认模型` : `把 ${row.id} 设为默认模型`}
                title={isDefault ? '默认模型' : '设为默认'}
                onClick={() => onDefault(row.id)}
              >
                <Star size={16} strokeWidth={1.75} fill={isDefault ? 'currentColor' : 'none'} />
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && <li className={s.checkEmpty}>没有匹配「{query.trim()}」的模型</li>}
      </ul>
    </div>
  );
}

/* ───────────────────────── 3 语音 ───────────────────────── */

function VoiceSection() {
  const asr = useAppStore((state) => state.asrSettings);
  const setAsrSettings = useAppStore((state) => state.setAsrSettings);

  return (
    <>
      <Group title="线路">
        <Row label="转写方式" desc="讲课页输入框旁的麦克风会用到">
          <Segmented
            label="语音转写线路"
            value={asr.mode}
            onChange={(mode) => setAsrSettings({ mode })}
            options={ASR_MODES.map((mode) => ({ value: mode.id, label: mode.short }))}
          />
        </Row>
        <ul className={s.legend}>
          {ASR_MODES.map((mode) => (
            <li key={mode.id} data-on={mode.id === asr.mode || undefined}>
              <strong>{mode.short}</strong>
              <span>{mode.desc}</span>
            </li>
          ))}
        </ul>
      </Group>

      {asr.mode === 'api' && (
        <Group title="自定义转写端点">
          <Row label="Base URL" desc="任何 OpenAI 兼容转写端点（/audio/transcriptions）" wide>
            <Input
              size="sm"
              type="url"
              value={asr.baseUrl}
              placeholder="https://openrouter.ai/api/v1"
              spellCheck={false}
              aria-label="转写 Base URL"
              onChange={(event) => setAsrSettings({ baseUrl: event.target.value })}
            />
          </Row>
          <Row label="API Key" desc="只存本机浏览器，不上传，也不随学习存档同步" wide>
            <SecretInput
              label="转写 API Key"
              value={asr.apiKey}
              placeholder="sk-…"
              autoComplete="off"
              onChange={(event) => setAsrSettings({ apiKey: event.target.value })}
            />
          </Row>
          <Row label="模型" desc="端点上的转写模型名称" wide>
            <Input
              size="sm"
              type="text"
              value={asr.model}
              placeholder="如 qwen/qwen3-asr-flash-2026-02-10"
              spellCheck={false}
              aria-label="转写模型"
              onChange={(event) => setAsrSettings({ model: event.target.value })}
            />
          </Row>
        </Group>
      )}

      <p className={s.foot}>麦克风只在你按下时收音，把课堂口述转成文字填进输入框。</p>
    </>
  );
}

/* ───────────────────────── 4 小白与记忆 ───────────────────────── */

type CardTab = 'preset' | 'custom';
type SaveState = 'idle' | 'pending' | 'saved';
type VoiceState =
  | { status: 'idle' }
  | { status: 'busy'; text: string }
  | { status: 'done'; text: string }
  | { status: 'fail'; text: string };

const CARD_TABS: { value: CardTab; label: string }[] = [
  { value: 'preset', label: '预设' },
  { value: 'custom', label: '自定义角色卡' },
];

const ADDRESS_SUGGESTIONS = ['先生', '老师', '师父'];

/** 试听用的固定一句讲解：让不同角色卡对着同一句话开口，才比得出差别 */
const VOICE_TEACHER_LINE = '梯度下降就是每一步都朝着让误差降得最快的方向走一小步，一步一步走到谷底。';

function voicePrompt(voice: { cardText: string | null; persona: Persona; address: string; stop: LivelinessStop }): string {
  const personaLine = PERSONAS.find((item) => item.value === voice.persona)?.line ?? '';
  return [
    '你在扮演「小白」：一个正在听老师讲课的学生，不是老师。',
    '听完老师的一句讲解后，你只回一两句话：先用自己的话复述听到的意思，再问一个你还没弄明白的小问题。',
    '不讲解知识，不使用老师没说过的专业术语。',
    voice.cardText
      ? `你的角色设定：${voice.cardText}`
      : `你的性格是${voice.persona}，说话的感觉像这样：${personaLine}`,
    voice.address ? `你称呼老师为「${voice.address}」。` : '',
    `说话的活泼程度：${voice.stop.name}。${voice.stop.line}`,
    '只输出小白说的话，不加引号、括号和旁白，不超过 60 个字。',
  ].filter(Boolean).join('\n');
}

/** 试听没成时给一句对得上原因的话；认不出的错误码只说没生成出来 */
function voiceFailure(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'model-auth') return '线路没有接受密钥，到「模型」里检查一下再试。';
  if (code === 'model-busy') return '线路正忙，过一会儿再试。';
  if (code === 'model-network' || code === 'model-timeout') return '线路没连上，稍后再试。';
  return '这次没有生成出来，稍后再试。';
}

function XiaobaiSection({ onClose }: { onClose: () => void }) {
  const owner = useAuthStore((state) => state.user);
  // 换了账号就换一张卡：整块重建，草稿不串
  return <XiaobaiPanel key={owner ?? 'local'} owner={owner} onClose={onClose} />;
}

function XiaobaiPanel({ owner, onClose }: { owner: string | null; onClose: () => void }) {
  const persona = useAppStore((state) => state.global.persona);
  const setPersona = useAppStore((state) => state.setPersona);
  const temperature = useAppStore((state) => state.settings.temperature);
  const lineMode = useAppStore((state) => state.settings.mode);
  const setSettings = useAppStore((state) => state.setSettings);
  const memory = useAppStore((state) => state.memory);
  const setMemoryPaused = useAppStore((state) => state.setMemoryPaused);
  const resetMemory = useAppStore((state) => state.resetMemory);
  const card = usePersonaCard(owner);
  const navigate = useNavigate();

  const [tab, setTab] = useState<CardTab>(card.mode);
  const [text, setText] = useState(card.text);
  const [address, setAddress] = useState(card.addressTeacherAs);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [pendingTemplate, setPendingTemplate] = useState<{ name: string; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  /* 试听：null=还不知道这条线路有没有模型；false=没有，整块不出现 */
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [voice, setVoice] = useState<VoiceState>({ status: 'idle' });

  /* 草稿与页签放进 ref：防抖落盘和卸载时的补存都要读「此刻」的值，而不是闭包里的旧值 */
  const draft = useRef({ tab, text, address, dirty: false });
  const voiceAbort = useRef<AbortController | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const persist = useCallback(() => {
    const now = draft.current;
    if (!now.dirty) return false;
    now.dirty = false;
    // 正文为空时 store 会自动退回预设；页签停在哪一侧，就按哪一侧存
    personaCard.save(owner, { mode: now.tab, text: now.text, addressTeacherAs: now.address });
    return true;
  }, [owner]);

  useEffect(() => {
    if (!draft.current.dirty) return undefined;
    setSaveState('pending');
    const timer = window.setTimeout(() => { if (persist()) setSaveState('saved'); }, 500);
    return () => window.clearTimeout(timer);
  }, [text, address, persist]);

  /* 关窗或换分区时，还没落盘的草稿补存一次 */
  useEffect(() => () => { persist(); }, [persist]);

  useEffect(() => {
    let alive = true;
    setVoiceReady(null);
    loadModelCatalog()
      .then((catalog) => { if (alive) setVoiceReady(catalog.available); })
      .catch(() => { if (alive) setVoiceReady(false); });
    return () => { alive = false; };
  }, [lineMode]);

  useEffect(() => () => voiceAbort.current?.abort(), []);

  const editText = (next: string) => {
    const value = next.slice(0, PERSONA_CARD_MAX);
    draft.current.text = value;
    draft.current.dirty = true;
    setText(value);
  };

  const editAddress = (next: string) => {
    const value = next.slice(0, 6);
    draft.current.address = value;
    draft.current.dirty = true;
    setAddress(value);
  };

  const chooseTab = (next: CardTab) => {
    draft.current.tab = next;
    draft.current.dirty = false;
    setTab(next);
    personaCard.save(owner, { mode: next, text: draft.current.text, addressTeacherAs: draft.current.address });
    setSaveState('idle');
  };

  const applyTemplate = (template: { name: string; text: string }) => {
    if (text.trim() && text.trim() !== template.text.trim()) setPendingTemplate(template);
    else editText(template.text);
  };

  const level = Math.min(1, Math.max(0, temperature));
  const stop = livelinessStop(level);
  const cardActive = tab === 'custom' && text.trim().length > 0;
  const activeCount = memory.items.filter((item) => !item.muted).length;
  const profile = memory.profile;

  const runVoice = async () => {
    voiceAbort.current?.abort();
    const controller = new AbortController();
    voiceAbort.current = controller;
    setVoice({ status: 'busy', text: '' });
    try {
      const result = await streamModel({
        messages: [
          { role: 'system', content: voicePrompt({ cardText: cardActive ? text.trim() : null, persona, address: address.trim(), stop }) },
          { role: 'user', content: `老师说：${VOICE_TEACHER_LINE}` },
        ],
        temperature: level,
        effort: 'none',
        maxTokens: 400,
        signal: controller.signal,
        onText: (partial) => { if (!controller.signal.aborted) setVoice({ status: 'busy', text: partial }); },
      });
      if (controller.signal.aborted) return;
      const line = result.text.trim();
      setVoice(line ? { status: 'done', text: line } : { status: 'fail', text: '这次他没说出话来，再试一次。' });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ModelUnavailableError) {
        // 这条线路没有模型：收起整块，不留一个点了没反应的按钮
        setVoiceReady(false);
        setVoice({ status: 'idle' });
        return;
      }
      setVoice({ status: 'fail', text: voiceFailure(error) });
    }
  };

  return (
    <>
      <Group title="小白">
        <Row label="性格" desc={tab === 'custom' ? '用文字写一张角色卡，决定他怎么说话' : '从三种内置性格里选一种'}>
          <Segmented label="性格来源" value={tab} onChange={chooseTab} options={CARD_TABS} />
        </Row>

        {tab === 'preset' ? (
          <div className={s.presetBlock}>
            <Segmented
              block
              label="小白的性格"
              value={persona}
              onChange={setPersona}
              options={PERSONAS.map((item) => ({ value: item.value, label: item.value }))}
            />
            <ul className={s.legend}>
              {PERSONAS.map((item) => (
                <li key={item.value} data-on={item.value === persona || undefined}>
                  <strong>{item.value}</strong>
                  <span>{item.line}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className={s.card}>
            <div className={s.cardChips} role="group" aria-label="角色卡模板">
              <span className={s.cardChipsLabel}>从模板起稿</span>
              {PERSONA_CARD_TEMPLATES.map((template) => (
                <button key={template.name} type="button" className={s.chip} onClick={() => applyTemplate(template)}>
                  {template.name}
                </button>
              ))}
            </div>
            <Textarea
              ref={textRef}
              className={s.cardText}
              value={text}
              maxLength={PERSONA_CARD_MAX}
              rows={6}
              placeholder="写写他是个什么样的学生：性格、说话方式、口头禅、兴趣，还有他对老师的态度。想到什么写什么，像给角色写设定。"
              aria-label="角色卡"
              onChange={(event) => editText(event.target.value)}
            />
            <div className={s.cardMeta}>
              <span className={s.cardSaved} data-on={saveState === 'saved' || undefined} role="status">
                {saveState === 'saved' ? <><Check size={13} strokeWidth={2.5} />已保存</> : saveState === 'pending' ? '正在保存…' : ''}
              </span>
              <span className={s.cardCount} data-full={text.length >= PERSONA_CARD_MAX || undefined}>
                {text.length} / {PERSONA_CARD_MAX}
              </span>
            </div>
            {!text.trim() && <p className={s.cardHint}>卡片还是空的，小白暂时按预设的「{persona}」说话。</p>}

            <div className={s.cardAddress}>
              <div className={s.rowCopy}>
                <span className={s.rowLabel}>怎么称呼你</span>
                <span className={s.rowDesc}>可以不填，不填就用默认的称呼</span>
              </div>
              <div className={s.cardAddressControl}>
                <Input
                  size="sm"
                  wrapClassName={s.cardAddressInput}
                  value={address}
                  maxLength={6}
                  placeholder="先生"
                  aria-label="小白怎么称呼你"
                  onChange={(event) => editAddress(event.target.value)}
                />
                {ADDRESS_SUGGESTIONS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={s.chip}
                    aria-pressed={address.trim() === name}
                    onClick={() => editAddress(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <p className={s.cardNote}>角色卡只改变他说话的样子：他仍然只提问和复述，也仍然不会用你还没教过的词。</p>
          </div>
        )}

        <div className={s.lively}>
          <div className={s.livelyHead}>
            <span className={s.rowLabel}>说话活泼程度</span>
            <span className={s.livelyNow}>
              <strong>{stop.name}</strong>
              <small>{level.toFixed(2)}</small>
            </span>
          </div>
          <input
            className={cx(s.rangeInput, s.livelyRange)}
            style={{ '--fill': `${level * 100}%` } as CSSProperties}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={level}
            aria-label="说话活泼程度"
            aria-valuetext={`${stop.name}：${stop.line}`}
            onChange={(event) => setSettings({ temperature: Number(event.target.value) })}
          />
          <div className={s.livelyStops}>
            {LIVELINESS.map((item) => (
              <button
                key={item.name}
                type="button"
                className={s.livelyStop}
                aria-pressed={item.name === stop.name}
                onClick={() => setSettings({ temperature: item.at })}
              >
                {item.name}
              </button>
            ))}
          </div>
          <p className={s.livelyLine}>{stop.line}</p>
        </div>

        {voiceReady && (
          <div className={s.voice}>
            <XiaobaiFace mood={voice.status === 'busy' ? 'thinking' : voice.status === 'done' ? 'curious' : 'idle'} size={44} className={s.voiceFace} />
            <div className={s.voiceBody}>
              {voice.status === 'idle' ? (
                <p className={s.voiceHint}>对着同一句讲解，听听他现在会怎么开口。</p>
              ) : (
                <>
                  <p className={s.voiceTeacher}>你讲：{VOICE_TEACHER_LINE}</p>
                  <p className={s.voiceBubble} data-state={voice.status} role="status">
                    {voice.status === 'busy' && !voice.text ? <ThinkingDots label="小白正在想怎么说" /> : voice.text}
                  </p>
                </>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={<Play size={13} strokeWidth={2} />}
              loading={voice.status === 'busy'}
              onClick={() => void runVoice()}
            >
              {voice.status === 'busy' ? '正在说…' : voice.status === 'idle' ? '试听一句' : '再听一句'}
            </Button>
          </div>
        )}
      </Group>
      <p className={s.foot}>这里只影响小白说话的样子；讲解评估的判定标准不变。</p>

      <Group title="记忆">
        <Row label="记住我的讲法" desc="关掉后上课不再记新的，已经记住的照旧">
          <Switch label="记忆" checked={!memory.paused} onCheckedChange={(on) => setMemoryPaused(!on)} />
        </Row>
        <Row
          label="已记住"
          desc={profile
            ? `画像整理于 ${relDay(profile.updatedAt)} · 依据 ${profile.basis.sessionCount} 堂课`
            : '讲完一课后自动整理画像'}
        >
          <Badge tone={activeCount > 0 ? 'accent' : 'neutral'}>{activeCount > 0 ? `${activeCount} 条` : '还没有'}</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { onClose(); navigate('/growth#memory-ledger'); }}
          >
            去记忆匣整理
          </Button>
        </Row>
        <Row label="清空记忆" desc="删除全部记忆条目与画像，学习记录不受影响">
          <Button
            variant="danger"
            size="sm"
            disabled={memory.items.length === 0 && !profile}
            onClick={() => setConfirming(true)}
          >
            清空
          </Button>
        </Row>
      </Group>
      <p className={s.foot}>只记你的讲法与习惯，不记用户名、邮箱与手机号。</p>

      <ConfirmDialog
        open={pendingTemplate !== null}
        title={`换成「${pendingTemplate?.name ?? ''}」？`}
        body="现在写的角色卡会被这张模板替换，原来的文字不会保留。"
        confirmLabel="替换"
        tone="solid"
        onCancel={() => setPendingTemplate(null)}
        onConfirm={() => {
          if (pendingTemplate) editText(pendingTemplate.text);
          setPendingTemplate(null);
          window.requestAnimationFrame(() => textRef.current?.focus());
        }}
      />
      <ConfirmDialog
        open={confirming}
        title="清空全部记忆？"
        body="小白记住的讲法、习惯和学习画像会全部删除，无法恢复。讲课记录与成绩不受影响。"
        confirmLabel="清空记忆"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          resetMemory();
          setConfirming(false);
          toast.success('记忆已清空');
        }}
      />
    </>
  );
}

/* ───────────────────────── 5 数据与隐私 ───────────────────────── */

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type DataConfirm = 'keys' | 'all' | null;

function DataSection() {
  const user = useAuthStore((state) => state.user);
  const authed = useAuthStore((state) => state.status === 'authed');
  const eventCount = useAppStore((state) => state.events.length);
  const reportCount = useAppStore((state) => state.reports.length);
  const memoryCount = useAppStore((state) => state.memory.items.length);
  const hasLlmKey = useAppStore((state) => Boolean(state.settings.apiKey));
  const hasAsrKey = useAppStore((state) => Boolean(state.asrSettings.apiKey));
  const setSettings = useAppStore((state) => state.setSettings);
  const setAsrSettings = useAppStore((state) => state.setAsrSettings);
  const resetAll = useAppStore((state) => state.resetAll);
  const [confirm, setConfirm] = useState<DataConfirm>(null);

  const exportData = () => {
    const { global, events, reports, topicStates, memory } = useAppStore.getState();
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      downloadJson(`xiaobai-learning-${stamp}.json`, {
        app: '小白同学',
        exportedAt: new Date().toISOString(),
        learning: { global, events, reports, topicStates },
        memory: { items: memory.items, profile: memory.profile, paused: memory.paused },
        workbench: studyData.get(user),
      });
      toast.success('学习记录已导出');
    } catch {
      toast.error('导出没有完成，请稍后再试');
    }
  };

  const hasRecords = eventCount > 0 || reportCount > 0 || memoryCount > 0;

  return (
    <>
      <Group title="导出">
        <Row
          label="导出学习记录"
          desc={`${reportCount} 份课后报告 · ${eventCount} 条学习事件 · ${memoryCount} 条记忆，连同工作台内容打包成一个 JSON 文件，不含密钥`}
        >
          <Button variant="outline" size="sm" icon={<Download size={14} strokeWidth={1.75} />} onClick={exportData}>
            导出 JSON
          </Button>
        </Row>
      </Group>

      <Group title="保存在这台设备的内容">
        <Row label="外观与模型偏好" desc="皮肤、壁纸、默认模型只存在这个浏览器，换设备需要重新设置" />
        <Row label="本机密钥" desc={hasLlmKey || hasAsrKey ? '自定义线路的 API Key 保存在这个浏览器里' : '这个浏览器里没有保存 API Key'}>
          <Button variant="outline" size="sm" disabled={!hasLlmKey && !hasAsrKey} onClick={() => setConfirm('keys')}>
            清除密钥
          </Button>
        </Row>
      </Group>

      <Group title="清空">
        <Row
          label="清空学习记录"
          desc={authed
            ? '讲课记录、成绩、小白的成长与记忆全部清空；账号里的学习存档也会一并清空'
            : '讲课记录、成绩、小白的成长与记忆全部清空'}
        >
          <Button variant="danger" size="sm" disabled={!hasRecords} onClick={() => setConfirm('all')}>
            清空
          </Button>
        </Row>
      </Group>
      <p className={s.foot}>清空不会动外观设置、新手引路痕迹和工作台里的笔记。</p>

      <ConfirmDialog
        open={confirm === 'keys'}
        title="清除本机密钥？"
        body="保存在这个浏览器里的模型与语音 API Key 会被删除。之后用自定义线路需要重新填写。"
        confirmLabel="清除密钥"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setSettings({ apiKey: '' });
          setAsrSettings({ apiKey: '' });
          setConfirm(null);
          toast.success('本机密钥已清除');
        }}
      />
      <ConfirmDialog
        open={confirm === 'all'}
        title="清空全部学习记录？"
        body={authed
          ? '讲课记录、成绩、小白的成长与记忆会全部清空，账号里的学习存档也会一并清空，无法恢复。建议先导出一份。'
          : '讲课记录、成绩、小白的成长与记忆会全部清空，无法恢复。建议先导出一份。'}
        confirmLabel="清空学习记录"
        requireText="清空"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          resetAll();
          setConfirm(null);
          toast.success('学习记录已清空');
        }}
      />
    </>
  );
}

/* ───────────────────────── 6 关于 ───────────────────────── */

function AboutSection({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className={s.about}>
        <span className={s.aboutMark} aria-hidden="true">白</span>
        <div>
          <strong>小白同学</strong>
          <p>先跟小砚学明白，再把小白教会。讲得出来，才算真的会。</p>
        </div>
        <Badge tone="outline">界面 v3 · 2026.10</Badge>
      </div>

      <Group title="新手引路">
        {/* 引路痕迹是 localStorage 快照：弹窗开着时引路无从推进，渲染时读一次即够新 */}
        {TOUR_STOPS.map((stop) => {
          const done = isTourDone(stop.key);
          return (
            <Row key={stop.key} label={stop.name}>
              <Badge tone={done ? 'ok' : 'neutral'} dot={done}>{done ? '已走过' : '未走过'}</Badge>
            </Row>
          );
        })}
        {/* 清痕后立即关窗：当前页若有引路会随即上前，也避免弹窗与引路抢 Esc */}
        <Row label="重新引路" desc="只清引路痕迹，不动学习记录">
          <Button
            variant="outline"
            size="sm"
            icon={<Route size={14} strokeWidth={1.75} />}
            onClick={() => { resetTours(); onClose(); }}
          >
            重新引路
          </Button>
        </Row>
      </Group>
    </>
  );
}

/* ───────────────────────── 共用小件 ───────────────────────── */

/** 一组设置：小标题 + 若干行，行与行之间只用细线分隔 */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={s.group}>
      <h4 className={s.groupTitle}>{title}</h4>
      <div className={s.rows}>{children}</div>
    </section>
  );
}

/** 设置行：左侧标签与一行说明，右侧控件；wide 用于输入框这类需要更宽的控件 */
function Row({ label, desc, wide, children }: { label: string; desc?: ReactNode; wide?: boolean; children?: ReactNode }) {
  return (
    <div className={cx(s.row, wide && s.rowWide)}>
      <div className={s.rowCopy}>
        <span className={s.rowLabel}>{label}</span>
        {desc ? <span className={s.rowDesc}>{desc}</span> : null}
      </div>
      {children ? <div className={s.rowControl}>{children}</div> : null}
    </div>
  );
}

function Range({ label, value, min, max, step, valueText, ariaValueText, disabled, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  valueText: string;
  ariaValueText?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const fill = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  return (
    <span className={s.range} data-disabled={disabled || undefined}>
      <input
        className={s.rangeInput}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={ariaValueText ?? valueText}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className={s.rangeValue}>{valueText}</output>
    </span>
  );
}

function SecretInput({ label, ...input }: { label: string } & Omit<ComponentProps<typeof Input>, 'type' | 'size' | 'trailing'>) {
  const [revealed, setRevealed] = useState(false);
  return (
    <Input
      size="sm"
      type={revealed ? 'text' : 'password'}
      aria-label={label}
      spellCheck={false}
      trailing={(
        <IconButton
          label={revealed ? `隐藏 ${label}` : `显示 ${label}`}
          size="sm"
          tip={false}
          aria-pressed={revealed}
          className={s.reveal}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
        </IconButton>
      )}
      {...input}
    />
  );
}

/** 连接测试：按钮 + 一行结果 */
function ConnTest({ disabled = false, onTest, test }: { disabled?: boolean; onTest: () => void; test: TestState }) {
  return (
    <span className={s.test}>
      {(test.status === 'ok' || test.status === 'fail') && (
        <span className={s.testResult} data-ok={test.status === 'ok' || undefined} role="status">
          {test.status === 'ok'
            ? <CircleCheck size={15} strokeWidth={1.75} />
            : <CircleX size={15} strokeWidth={1.75} />}
          <span>{test.detail}</span>
        </span>
      )}
      <Button variant="outline" size="sm" loading={test.status === 'busy'} disabled={disabled} onClick={onTest}>
        {test.status === 'busy' ? '测试中…' : '测试连接'}
      </Button>
    </span>
  );
}

/** 二次确认；requireText 存在时必须照输一遍才放行 */
function ConfirmDialog({ open, title, body, confirmLabel, requireText, tone = 'danger', onConfirm, onCancel }: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  requireText?: string;
  /** danger=删除类；solid=只是替换、覆盖这类可以重来的操作 */
  tone?: 'danger' | 'solid';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const inputId = useId();

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const blocked = requireText ? typed.trim() !== requireText : false;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) onCancel(); }}
      title={title}
      size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button variant={tone} disabled={blocked} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      <p className={s.confirmBody}>{body}</p>
      {requireText && (
        <Field label={`输入「${requireText}」确认`} htmlFor={inputId} className={s.confirmField}>
          <Input
            id={inputId}
            size="sm"
            value={typed}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
      )}
    </Dialog>
  );
}
