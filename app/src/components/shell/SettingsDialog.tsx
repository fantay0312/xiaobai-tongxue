/**
 * 设置 —— 左侧分区目录 + 右侧滚动内容。
 * 「外观」是皮肤与个性化的陈列台（store/skinStore），改动即时生效，只保存在本机浏览器。
 * 其余分区沿用原有的线路、语音、小白台词、记忆与引路设置：store 调用与载荷不变。
 * 评估与状态机永远本地规则运行，模型只负责理解与台词。
 */
import {
  useEffect, useId, useRef, useState,
  type ChangeEvent, type ComponentProps, type CSSProperties, type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { Tabs as RTabs } from 'radix-ui';
import {
  Brain, Check, CircleCheck, CircleX, Cpu, Download, Eye, EyeOff, ImagePlus, Info, Mic, Palette,
  Pipette, RotateCcw, Route, ShieldCheck, Trash2, type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { DEFAULT_SKIN, SKINS, useSkinStore, type SkinPrefs } from '../../store/skinStore';
import { useModelPrefs } from '../../store/modelPrefs';
import { studyData } from '../../store/studyData';
import { loadModelCatalog, type ModelCatalog } from '../../lib/modelGateway';
import { llmCall } from '../../engine';
import { relDay } from '../../lib/relDay';
import type { Persona } from '../../types';
import { isTourDone, resetTours, type TourKey } from '../tour/tourState';
import {
  Badge, Button, Dialog, Field, IconButton, Input, ModelPicker, Segmented, Switch, cx, toast,
} from '../ui';
import { useSheetKeyboardInset } from './ProfileSheetKeyboard';
import s from './SettingsDialog.module.css';

/* ───────────────────────── 分区目录 ───────────────────────── */

type SectionId = 'look' | 'model' | 'voice' | 'xiaobai' | 'data' | 'about';

const SECTIONS: { id: SectionId; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'look', label: '外观', hint: '皮肤、强调色、字体与壁纸，改动立即生效，只保存在这台设备。', icon: Palette },
  { id: 'model', label: '模型', hint: '小白与小砚走哪条线路、默认用哪个模型。', icon: Cpu },
  { id: 'voice', label: '语音', hint: '讲课时把口述转成文字。', icon: Mic },
  { id: 'xiaobai', label: '小白与记忆', hint: '小白的性格、说话方式，以及它记住了什么。', icon: Brain },
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

const ENGINE_MODES = [
  { id: 'proxy', short: '服务器', desc: '走服务器网关调用模型，密钥不出服务器，需要登录。' },
  { id: 'mock', short: '演示', desc: '内置教学引擎，不联网也能完整跑通一堂课。' },
  { id: 'api', short: '自定义', desc: '浏览器直连你自己的 OpenAI 兼容端点，密钥只存本机。' },
] as const;

const ASR_MODES = [
  { id: 'proxy', short: '服务器', desc: '走服务器网关转写，密钥不出服务器，需要登录。' },
  { id: 'api', short: '自定义', desc: '浏览器直连你自己的转写端点，密钥只存本机。' },
] as const;

const PERSONAS: { value: Persona; line: string }[] = [
  { value: '好奇型', line: '「哇，为什么会这样？然后呢然后呢？」' },
  { value: '严谨型', line: '「等等，这个说法有依据吗？边界在哪儿？」' },
  { value: '杠精型', line: '「我不信。你要是对的，这段代码怎么解释？」' },
];

/* 温度档位的口吻注解：描述倾向，不许诺具体行为（台词仍由引擎定） */
const TEMPER_BANDS: { max: number; name: string; line: string }[] = [
  { max: 0.35, name: '沉稳', line: '字斟句酌，句句落在点上，很少发散。' },
  { max: 0.95, name: '平和', line: '偶尔打个比方，大体跟着你的思路走。' },
  { max: Infinity, name: '活泼', line: '爱举例子也爱追问，时不时蹦出个新鲜联想。' },
];

const temperBand = (value: number) =>
  TEMPER_BANDS.find((band) => value < band.max) ?? TEMPER_BANDS[TEMPER_BANDS.length - 1];

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
  const apiReady = Boolean(settings.baseUrl && settings.apiKey && settings.model);

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
  }, [settings.mode]);

  const runTest = async () => {
    setTest({ status: 'busy' });
    const startedAt = performance.now();
    try {
      const reply = await llmCall(
        'xiaobai',
        { system: '你是连接测试,收到任何消息都只回复两个字:在的', user: 'ping' },
        { ...settings, temperature: 0 },
      );
      const ms = Math.round(performance.now() - startedAt);
      setTest({ status: 'ok', detail: `连接成功 · ${ms}ms · ${reply.trim().slice(0, 24)}` });
    } catch (error) {
      setTest({ status: 'fail', detail: `连接失败：${error instanceof Error ? error.message : String(error)}` });
    }
  };

  const patch = (partial: Parameters<typeof setSettings>[0]) => {
    setSettings(partial);
    setTest({ status: 'idle' });
  };

  const hasCatalog = Boolean(catalog?.available && catalog.models.length);

  return (
    <>
      <Group title="线路">
        <Row label="调用方式" desc="线路失败时自动降级为演示，课程不中断">
          <Segmented
            label="模型线路"
            value={settings.mode}
            onChange={(mode) => patch({ mode })}
            options={ENGINE_MODES.map((mode) => ({ value: mode.id, label: mode.short }))}
          />
        </Row>
        <ul className={s.legend}>
          {ENGINE_MODES.map((mode) => (
            <li key={mode.id} data-on={mode.id === settings.mode || undefined}>
              <strong>{mode.short}</strong>
              <span>{mode.desc}</span>
            </li>
          ))}
        </ul>
      </Group>

      {settings.mode === 'proxy' && (
        <Group title="连接">
          <Row label="测试连接" desc="向服务器网关发一句话，看它回不回">
            <ConnTest onTest={() => void runTest()} test={test} />
          </Row>
        </Group>
      )}

      {settings.mode === 'api' && (
        <Group title="自定义端点">
          <Row label="Base URL" desc="任何 OpenAI 兼容端点（/chat/completions）" wide>
            <Input
              size="sm"
              type="url"
              value={settings.baseUrl}
              placeholder="https://api.deepseek.com/v1"
              spellCheck={false}
              aria-label="Base URL"
              onChange={(event) => patch({ baseUrl: event.target.value })}
            />
          </Row>
          <Row label="API Key" desc="只存本机浏览器，不上传" wide>
            <SecretInput
              label="API Key"
              value={settings.apiKey}
              placeholder="sk-…"
              autoComplete="off"
              onChange={(event) => patch({ apiKey: event.target.value })}
            />
          </Row>
          <Row label="模型" desc="端点上的模型名称" wide>
            <Input
              size="sm"
              type="text"
              value={settings.model}
              placeholder="如 deepseek-v4-flash"
              spellCheck={false}
              aria-label="模型"
              onChange={(event) => patch({ model: event.target.value })}
            />
          </Row>
          <Row label="测试连接" desc={apiReady ? '用上面的配置发一句话试试' : '先填好 Base URL、API Key 与模型'}>
            <ConnTest disabled={!apiReady} onTest={() => void runTest()} test={test} />
          </Row>
        </Group>
      )}

      <Group title="学习终端">
        <Row
          label="默认模型与思考强度"
          desc={hasCatalog
            ? '新对话默认用它；在输入框里可以随时换'
            : '当前线路没有可选模型，相关功能使用本地演示'}
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
          />
        </Row>
      </Group>

      <p className={s.foot}>讲解评估与课堂状态始终在本地按规则运行，模型只负责理解与台词。</p>
    </>
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

function XiaobaiSection({ onClose }: { onClose: () => void }) {
  const persona = useAppStore((state) => state.global.persona);
  const setPersona = useAppStore((state) => state.setPersona);
  const temperature = useAppStore((state) => state.settings.temperature);
  const setSettings = useAppStore((state) => state.setSettings);
  const memory = useAppStore((state) => state.memory);
  const setMemoryPaused = useAppStore((state) => state.setMemoryPaused);
  const resetMemory = useAppStore((state) => state.resetMemory);
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  const band = temperBand(temperature);
  const personaLine = PERSONAS.find((item) => item.value === persona)?.line ?? PERSONAS[0].line;
  const activeCount = memory.items.filter((item) => !item.muted).length;
  const profile = memory.profile;

  return (
    <>
      <Group title="小白">
        <Row label="性格" desc={personaLine}>
          <Segmented
            label="小白的性格"
            value={persona}
            onChange={setPersona}
            options={PERSONAS.map((item) => ({ value: item.value, label: item.value }))}
          />
        </Row>
        <Row label="说话活泼程度" desc={`${band.name} · ${band.line}`}>
          <Range
            label="小白台词温度"
            min={0}
            max={1.5}
            step={0.05}
            value={temperature}
            valueText={temperature.toFixed(2)}
            ariaValueText={`${temperature.toFixed(2)}，${band.name}`}
            onChange={(next) => setSettings({ temperature: next })}
          />
        </Row>
      </Group>
      <p className={s.foot}>只影响小白说话的活泼程度；讲解评估固定用 temperature 0，判定不受影响。</p>

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

/** 破坏性操作的二次确认；requireText 存在时必须照输一遍才放行 */
function ConfirmDialog({ open, title, body, confirmLabel, requireText, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  requireText?: string;
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
          <Button variant="danger" disabled={blocked} onClick={onConfirm}>{confirmLabel}</Button>
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
