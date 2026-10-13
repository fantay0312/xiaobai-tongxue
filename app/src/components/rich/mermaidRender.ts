/**
 * mermaid 按需加载与渲染。库本体只在页面上真的出现图表时才下载，不进主包。
 * 配色取自当前皮肤的语义令牌；令牌解析失败时退回 mermaid 自带的明/暗主题。
 */

type Rgb = [number, number, number];

interface DiagramTheme {
  /** 主题签名：同一份源码在不同皮肤下各缓存一份 */
  key: string;
  config: Record<string, unknown>;
}

let canvas: HTMLCanvasElement | null = null;

/** 借画布把任意 CSS 颜色（含 color-mix、半透明）解析成不透明 RGB。 */
function resolveColor(color: string, base: Rgb): Rgb {
  if (!color) return base;
  canvas ??= document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return base;
  ctx.fillStyle = `rgb(${base.join(',')})`;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

const hex = (rgb: Rgb) => `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
const mix = (a: Rgb, b: Rgb, amount: number): Rgb =>
  [0, 1, 2].map((i) => Math.round(a[i] * amount + b[i] * (1 - amount))) as Rgb;

function readTheme(scope: Element | null): DiagramTheme {
  const style = getComputedStyle(scope ?? document.documentElement);
  const dark = style.colorScheme.includes('dark');
  const fontFamily = style.getPropertyValue('--ui-font').trim() || style.fontFamily;
  try {
    const token = (name: string, base: Rgb) => resolveColor(style.getPropertyValue(name).trim(), base);
    const fallbackSurface: Rgb = dark ? [31, 33, 37] : [255, 255, 255];
    const fallbackText: Rgb = dark ? [236, 236, 239] : [27, 29, 33];
    const surface = token('--surface', fallbackSurface);
    const inset = token('--inset', surface);
    const text = token('--text', fallbackText);
    const muted = token('--text-3', mix(text, surface, 0.55));
    const accent = token('--accent', text);
    const line = token('--border-2', mix(text, surface, 0.2));
    const variables = {
      darkMode: dark,
      fontFamily,
      fontSize: '14px',
      background: hex(inset),
      primaryColor: hex(surface),
      primaryTextColor: hex(text),
      primaryBorderColor: hex(mix(text, surface, 0.32)),
      secondaryColor: hex(mix(accent, surface, 0.16)),
      secondaryTextColor: hex(text),
      secondaryBorderColor: hex(mix(accent, surface, 0.45)),
      tertiaryColor: hex(mix(text, inset, 0.04)),
      tertiaryTextColor: hex(text),
      tertiaryBorderColor: hex(line),
      lineColor: hex(muted),
      textColor: hex(text),
      mainBkg: hex(surface),
      nodeBorder: hex(mix(text, surface, 0.32)),
      clusterBkg: hex(mix(text, inset, 0.04)),
      clusterBorder: hex(line),
      edgeLabelBackground: hex(inset),
      titleColor: hex(text),
      noteBkgColor: hex(mix(accent, surface, 0.12)),
      noteTextColor: hex(text),
      noteBorderColor: hex(mix(accent, surface, 0.4)),
      actorBkg: hex(surface),
      actorBorder: hex(mix(text, surface, 0.32)),
      actorTextColor: hex(text),
      signalColor: hex(muted),
      signalTextColor: hex(text),
      labelBoxBkgColor: hex(surface),
      labelBoxBorderColor: hex(line),
      labelTextColor: hex(text),
      loopTextColor: hex(text),
      activationBkgColor: hex(mix(accent, surface, 0.16)),
      activationBorderColor: hex(mix(accent, surface, 0.5)),
    };
    return { key: JSON.stringify(variables), config: { theme: 'base', themeVariables: variables, fontFamily } };
  } catch {
    const theme = dark ? 'dark' : 'neutral';
    return { key: theme, config: { theme, fontFamily } };
  }
}

const CACHE_LIMIT = 40;
const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;

/**
 * 渲染一张图，返回 SVG 字符串；语法有误时 reject，由调用方退回代码块。
 * initialize 是全局的，这里把任务排成一队，保证“设主题 + 渲染”不被别的图打断。
 */
export function renderMermaid(code: string, scope: Element | null): Promise<string> {
  const theme = readTheme(scope);
  const key = `${theme.key}\u0000${code}`;
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const job = queue.then(async () => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      ...theme.config,
    });
    const valid = await mermaid.parse(code, { suppressErrors: true });
    if (!valid) throw new Error('图表语法有误');
    sequence += 1;
    const id = `xb-mermaid-${sequence}`;
    try {
      const { svg } = await mermaid.render(id, code);
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, svg);
      return svg;
    } finally {
      // 失败时 mermaid 可能把临时节点留在 body 上
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = job.catch(() => undefined);
  return job;
}
