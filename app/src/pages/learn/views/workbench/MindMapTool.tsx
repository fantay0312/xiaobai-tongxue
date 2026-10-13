import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import {
  ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns2, CornerDownRight, Download, FileImage, FileText, ListTree, Maximize,
  MessageCircleQuestion, Network, Plus, Trash2, ZoomIn, ZoomOut,
} from 'lucide-react';
import { Button, IconButton, Kbd, Menu, MenuContent, MenuItem, MenuTrigger, Segmented, Shimmer, toast } from '../../../../components/ui';
import { useSkinStore } from '../../../../store/skinStore';
import { mindNode, newId, studyData, useStudyData, type MindMap, type MindNode } from '../../../../store/studyData';
import { DetailHead, ICON_SM, OriginBadge, ToolFrame, type ToolProps } from './shared';
import { download, safeName, useAutosave, useNarrow } from './util';
import s from './workbench.module.css';
import m from './mindmap.module.css';

type View = 'both' | 'map' | 'outline';
type MarkmapInstance = import('markmap-view').Markmap;
type PureNode = NonNullable<Parameters<MarkmapInstance['setData']>[0]>;
interface Engine { Markmap: typeof import('markmap-view').Markmap; render: (text: string) => string }

/* ── 树的工具 ── */
/** 外部写入的节点可能缺 id 或 children，先补齐 */
function sanitize(raw: MindNode | undefined, depth = 0): MindNode {
  const node = (raw ?? {}) as Partial<MindNode>;
  return {
    id: typeof node.id === 'string' && node.id ? node.id : newId(),
    text: typeof node.text === 'string' ? node.text : '',
    ...(typeof node.note === 'string' && node.note ? { note: node.note } : {}),
    children: depth < 12 && Array.isArray(node.children) ? node.children.map((child) => sanitize(child, depth + 1)) : [],
  };
}
function locate(node: MindNode, id: string, parent: MindNode | null = null, index = 0): { node: MindNode; parent: MindNode | null; index: number } | null {
  if (node.id === id) return { node, parent, index };
  for (let i = 0; i < node.children.length; i += 1) {
    const hit = locate(node.children[i], id, node, i);
    if (hit) return hit;
  }
  return null;
}
interface Row { node: MindNode; depth: number }
function flatten(node: MindNode, folded: Set<string>, depth = 0, out: Row[] = []): Row[] {
  out.push({ node, depth });
  if (!folded.has(node.id)) for (const child of node.children) flatten(child, folded, depth + 1, out);
  return out;
}
const countNodes = (node: MindNode): number => 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);

function toMarkdown(root: MindNode): string {
  const lines = [`# ${root.text || '未命名'}`, ''];
  const walk = (node: MindNode, depth: number) => {
    lines.push(`${'  '.repeat(depth)}- ${node.text || '未命名'}${node.note ? `：${node.note}` : ''}`);
    node.children.forEach((child) => walk(child, depth + 1));
  };
  root.children.forEach((child) => walk(child, 0));
  return `${lines.join('\n')}\n`;
}

/* ── markmap：按需加载，全站只建一次 ──
   站点 CSP 不允许运行时从 CDN 取脚本、样式或图片。这里用不带插件的构建并显式传空插件表，
   只借它的 markdown-it 把节点文字渲染成行内 HTML；不调用 loadJS / loadCSS / getUsedAssets，也不用 markmap-toolbar。 */
let enginePromise: Promise<Engine> | null = null;
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
/** 节点文字里的图片语法只留说明文字，避免生成指向外站的 <img> */
const plainText = (text: string) => text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ');
function loadEngine(): Promise<Engine> {
  enginePromise ??= Promise.all([import('markmap-lib/no-plugins'), import('markmap-view')]).then(([lib, view]) => {
    const transformer = new lib.Transformer([]);
    return { Markmap: view.Markmap, render: (text: string) => transformer.md.renderInline(escapeHtml(plainText(text))) };
  });
  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
}
function toPure(node: MindNode, render: Engine['render'], folded: Set<string>): PureNode {
  const html = render(node.text || '未命名');
  return {
    content: node.note ? `<span title="${escapeHtml(node.note)}">${html}</span>` : html,
    children: node.children.map((child) => toPure(child, render, folded)),
    payload: { nid: node.id, ...(folded.has(node.id) && node.children.length ? { fold: 1 } : {}) },
  } as PureNode;
}
/** 分支配色取当前皮肤的令牌实际值（SVG 属性里不能写 var()） */
function branchColors(element: Element) {
  const css = getComputedStyle(element);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const accent = token('--accent', 'currentColor');
  const ok = token('--ok', accent);
  const warn = token('--warn', accent);
  const bad = token('--bad', accent);
  return {
    root: token('--text-3', accent),
    list: [accent, ok, warn, bad, `color-mix(in oklab, ${accent} 55%, ${bad})`, `color-mix(in oklab, ${ok} 55%, ${accent})`, `color-mix(in oklab, ${warn} 55%, ${bad})`],
  };
}

interface CanvasHandle { svg: () => string | null }

function MapCanvas({ root, folded, onToggleFold, onFoldAll, onExpandAll, ref }: {
  root: MindNode;
  folded: Set<string>;
  onToggleFold: (id: string) => void;
  onFoldAll: () => void;
  onExpandAll: () => void;
  ref?: Ref<CanvasHandle>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<MarkmapInstance | null>(null);
  const renderRef = useRef<Engine['render'] | null>(null);
  const toggleRef = useRef(onToggleFold);
  const shape = useRef('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const skinKey = useSkinStore((state) => `${state.skin}|${state.accent ?? ''}`);

  useEffect(() => { toggleRef.current = onToggleFold; });

  useEffect(() => {
    let alive = true;
    let instance: MarkmapInstance | null = null;
    loadEngine().then((engine) => {
      if (!alive || !svgRef.current) return;
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      instance = engine.Markmap.create(svgRef.current, {
        autoFit: false,
        duration: calm ? 0 : 320,
        fitRatio: 0.9,
        maxInitialScale: 1.2,
        initialExpandLevel: -1,
        // 拖动平移，⌘/Ctrl + 滚轮缩放；普通滚轮留给页面滚动
        zoom: true,
        pan: false,
        scrollForPan: true,
        spacingHorizontal: 56,
        spacingVertical: 8,
        paddingX: 10,
        maxWidth: 260,
        lineWidth: (node) => Math.max(1.25, 2.75 - (node.state?.depth ?? 0) * 0.5),
      });
      // d3-zoom 默认从 svg 的 width/height 属性读视口，百分比尺寸在未渲染时读不出来会抛错；改为读实际盒子
      instance.zoom.extent(() => {
        const box = svgRef.current?.getBoundingClientRect();
        return [[0, 0], [box?.width ?? 0, box?.height ?? 0]];
      });
      // 折叠状态以大纲为准：点导图节点的圆点时改大纲的折叠，再由数据驱动重绘
      instance.handleClick = (_event, node) => {
        const id = (node.payload as { nid?: unknown } | undefined)?.nid;
        if (typeof id === 'string') toggleRef.current(id);
      };
      mmRef.current = instance;
      renderRef.current = engine.render;
      setStatus('ready');
    }).catch(() => { if (alive) setStatus('failed'); });
    return () => {
      alive = false;
      instance?.destroy();
      mmRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mm = mmRef.current;
    const render = renderRef.current;
    const svg = svgRef.current;
    if (status !== 'ready' || !mm || !render || !svg) return;
    const first = shape.current === '';
    const timer = setTimeout(() => {
      const colors = branchColors(svg);
      const branches = new Map<string, number>();
      mm.setOptions({
        color: (node) => {
          const key = node.state?.path?.split('.')[1];
          if (!key) return colors.root;
          if (!branches.has(key)) branches.set(key, branches.size);
          return colors.list[(branches.get(key) ?? 0) % colors.list.length];
        },
      });
      // 结构（节点数、折叠）变了才重新适应画布；只改文字时保持用户当前的缩放
      const nextShape = `${countNodes(root)}:${[...folded].sort().join(',')}`;
      const refit = nextShape !== shape.current;
      shape.current = nextShape;
      void mm.setData(toPure(root, render, folded)).then(() => { if (refit) void mm.fit(); });
    }, first ? 0 : 140);
    return () => clearTimeout(timer);
  }, [status, root, folded, skinKey]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { void mmRef.current?.fit(); }, 160);
    });
    observer.observe(wrap);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, []);

  useImperativeHandle(ref, () => ({
    svg: () => {
      const mm = mmRef.current;
      const svg = svgRef.current;
      if (!mm || !svg) return null;
      const { x1, y1, x2, y2 } = mm.state.rect;
      const pad = 28;
      const width = Math.max(120, Math.ceil(x2 - x1 + pad * 2));
      const height = Math.max(80, Math.ceil(y2 - y1 + pad * 2));
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('class', 'markmap');
      clone.setAttribute('viewBox', `${x1 - pad} ${y1 - pad} ${width} ${height}`);
      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));
      clone.querySelector('g')?.removeAttribute('transform');
      const paper = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      paper.setAttribute('x', String(x1 - pad));
      paper.setAttribute('y', String(y1 - pad));
      paper.setAttribute('width', String(width));
      paper.setAttribute('height', String(height));
      paper.setAttribute('fill', '#fff');
      clone.insertBefore(paper, clone.querySelector('g'));
      return new XMLSerializer().serializeToString(clone);
    },
  }), []);

  return (
    <div className={m.canvas} ref={wrapRef}>
      <svg ref={svgRef} className={m.svg} role="img" aria-label={`思维导图：${root.text}`} />
      {status === 'loading' && <div className={m.canvasNote}><Shimmer>正在准备画布…</Shimmer></div>}
      {status === 'failed' && <div className={m.canvasNote}>导图画布没有加载出来，可以先在大纲里编辑。</div>}
      {status === 'ready' && (
        <div className={m.zoom}>
          <IconButton label="收起到一级" size="sm" onClick={onFoldAll}><ChevronsDownUp {...ICON_SM} /></IconButton>
          <IconButton label="全部展开" size="sm" onClick={onExpandAll}><ChevronsUpDown {...ICON_SM} /></IconButton>
          <span className={m.zoomSep} aria-hidden="true" />
          <IconButton label="缩小" size="sm" onClick={() => void mmRef.current?.rescale(0.8)}><ZoomOut {...ICON_SM} /></IconButton>
          <IconButton label="放大" size="sm" onClick={() => void mmRef.current?.rescale(1.25)}><ZoomIn {...ICON_SM} /></IconButton>
          <IconButton label="适应画布" size="sm" onClick={() => void mmRef.current?.fit()}><Maximize {...ICON_SM} /></IconButton>
        </div>
      )}
    </div>
  );
}

export default function MindMapTool(props: ToolProps) {
  const { owner, onAsk } = props;
  const { mindmaps } = useStudyData(owner);
  const [view, setView] = useState<View>(() => (typeof window !== 'undefined' && window.innerWidth < 900 ? 'map' : 'both'));

  return (
    <ToolFrame
      tool="mindmap"
      view={props}
      empty={{
        title: '还没有思维导图',
        description: '把一课的结构理成一张图：中心主题、分支、要点。一边写大纲，一边就是图。',
        primary: 'generate',
        generateLabel: '从本课生成导图',
        createLabel: '从空白开始',
      }}
    >
      {(id) => {
        const map = mindmaps.find((item) => item.id === id);
        return map ? <MapEditor key={map.id} map={map} owner={owner} view={view} onView={setView} onAsk={onAsk} /> : null;
      }}
    </ToolFrame>
  );
}

function MapEditor({ map, owner, view: pickedView, onView, onAsk }: {
  map: MindMap;
  owner: string | null;
  view: View;
  onView: (view: View) => void;
  onAsk: (text: string) => void;
}) {
  // 手机上画布要占满宽度：大纲单独一个页签，不和导图并排
  const narrow = useNarrow();
  const view: View = narrow && pickedView === 'both' ? 'map' : pickedView;
  const [title, setTitle] = useState(map.title);
  const [root, setRoot] = useState(() => sanitize(map.root));
  const [dirty, setDirty] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [focus, setFocus] = useState<{ id: string; tick: number } | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const canvas = useRef<CanvasHandle>(null);
  const draft = useMemo(() => ({ title, root }), [title, root]);

  const save = useCallback((value: typeof draft) => {
    if (!studyData.get(owner).mindmaps.some((item) => item.id === map.id)) return;
    studyData.saveMindMap(owner, { id: map.id, ...value });
    setDirty(false);
  }, [owner, map.id]);
  useAutosave(draft, dirty, save);

  useEffect(() => {
    if (dirty) return;
    setTitle(map.title);
    setRoot(sanitize(map.root));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.updatedAt]);

  useEffect(() => {
    if (!focus) return;
    const input = inputs.current.get(focus.id);
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }, [focus]);

  const rows = useMemo(() => flatten(root, folded), [root, folded]);
  const focusOn = (id: string | null | undefined) => { if (id) setFocus({ id, tick: Date.now() }); };

  /** 在副本上改树；fn 返回要聚焦的节点 id */
  const change = (fn: (draftRoot: MindNode) => string | null | void) => {
    const next = structuredClone(root);
    const target = fn(next);
    setRoot(next);
    setDirty(true);
    focusOn(target ?? null);
  };
  const unfold = (id: string) => setFolded((current) => {
    if (!current.has(id)) return current;
    const next = new Set(current);
    next.delete(id);
    return next;
  });
  const toggleFold = useCallback((id: string) => setFolded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);

  const rename = (id: string, text: string) => change((tree) => { const hit = locate(tree, id); if (hit) hit.node.text = text; });
  const addSibling = (id: string) => change((tree) => {
    const hit = locate(tree, id);
    if (!hit) return null;
    const node = mindNode('');
    if (hit.parent) hit.parent.children.splice(hit.index + 1, 0, node);
    else { hit.node.children.push(node); unfold(id); }
    return node.id;
  });
  const addChild = (id: string) => change((tree) => {
    const hit = locate(tree, id);
    if (!hit) return null;
    const node = mindNode('');
    hit.node.children.push(node);
    unfold(id);
    return node.id;
  });
  const removeNode = (id: string) => {
    const at = rows.findIndex((row) => row.node.id === id);
    change((tree) => {
      const hit = locate(tree, id);
      if (!hit?.parent) return null;
      hit.parent.children.splice(hit.index, 1);
      return rows[at - 1]?.node.id ?? tree.id;
    });
  };
  const indent = (id: string) => change((tree) => {
    const hit = locate(tree, id);
    if (!hit?.parent || hit.index === 0) return id;
    const previous = hit.parent.children[hit.index - 1];
    hit.parent.children.splice(hit.index, 1);
    previous.children.push(hit.node);
    unfold(previous.id);
    return id;
  });
  const outdent = (id: string) => change((tree) => {
    const hit = locate(tree, id);
    const up = hit?.parent ? locate(tree, hit.parent.id) : null;
    if (!hit?.parent || !up?.parent) return id;
    hit.parent.children.splice(hit.index, 1);
    up.parent.children.splice(up.index + 1, 0, hit.node);
    return id;
  });
  const move = (id: string, step: -1 | 1) => change((tree) => {
    const hit = locate(tree, id);
    const to = (hit?.index ?? 0) + step;
    if (!hit?.parent || to < 0 || to >= hit.parent.children.length) return id;
    hit.parent.children.splice(hit.index, 1);
    hit.parent.children.splice(to, 0, hit.node);
    return id;
  });

  const onKey = (event: KeyboardEvent<HTMLInputElement>, row: Row, index: number) => {
    const id = row.node.id;
    const mod = event.metaKey || event.ctrlKey;
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); if (mod) addChild(id); else addSibling(id); }
    else if (event.key === 'Tab') { event.preventDefault(); if (event.shiftKey) outdent(id); else indent(id); }
    else if (event.key === 'Backspace' && !row.node.text && !row.node.children.length && row.depth > 0) { event.preventDefault(); removeNode(id); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (event.altKey) move(id, -1); else focusOn(rows[index - 1]?.node.id); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); if (event.altKey) move(id, 1); else focusOn(rows[index + 1]?.node.id); }
  };

  const foldAll = useCallback(() => setFolded(new Set(root.children.filter((child) => child.children.length).map((child) => child.id))), [root]);
  const expandAll = useCallback(() => setFolded(new Set()), []);

  const exportSvg = () => {
    const svg = canvas.current?.svg();
    if (!svg) { toast('切到「导图」或「并排」视图后再导出图片'); return; }
    download(`${safeName(title)}.svg`, svg, 'image/svg+xml');
  };

  return (
    <div className={`${s.card} ${m.editor}`}>
      <DetailHead title={title} onTitle={(value) => { setTitle(value); setDirty(true); }} badges={<OriginBadge origin={map.origin} />}>
        <Segmented
          size="sm"
          label="视图"
          value={view}
          onChange={onView}
          options={[
            ...(narrow ? [] : [{ value: 'both' as const, label: '并排', icon: <Columns2 {...ICON_SM} /> }]),
            { value: 'map' as const, label: '导图', icon: <Network {...ICON_SM} /> },
            { value: 'outline' as const, label: '大纲', icon: <ListTree {...ICON_SM} /> },
          ]}
        />
        <IconButton
          label="问小砚"
          size="sm"
          onClick={() => onAsk(`请看看我这张思维导图《${title || root.text}》的结构：有没有放错位置或漏掉的要点？\n\n${toMarkdown(root).slice(0, 1800)}`)}
        >
          <MessageCircleQuestion {...ICON_SM} />
        </IconButton>
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="导出" size="sm" tip={false}><Download {...ICON_SM} /></IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={<FileImage {...ICON_SM} />} onSelect={exportSvg}>导出 SVG 图片</MenuItem>
            <MenuItem icon={<FileText {...ICON_SM} />} onSelect={() => download(`${safeName(title)}.md`, toMarkdown(root), 'text/markdown')}>导出 Markdown 大纲</MenuItem>
          </MenuContent>
        </Menu>
      </DetailHead>

      <div className={m.body} data-view={view}>
        {view !== 'map' && (
          <div className={m.outline}>
            <div className={m.rows} role="tree" aria-label="大纲">
              {rows.map((row, index) => {
                const { node, depth } = row;
                const hasChildren = node.children.length > 0;
                return (
                  <div key={node.id} className={m.row} data-root={depth === 0} style={{ paddingLeft: 6 + depth * 18 }} role="treeitem" aria-level={depth + 1} aria-expanded={hasChildren ? !folded.has(node.id) : undefined}>
                    {hasChildren && depth > 0 ? (
                      <button type="button" className={m.fold} data-open={!folded.has(node.id)} aria-label={folded.has(node.id) ? '展开' : '收起'} onClick={() => toggleFold(node.id)}>
                        <ChevronRight size={14} strokeWidth={2} />
                      </button>
                    ) : <span className={m.dot} aria-hidden="true" />}
                    <input
                      ref={(element) => { if (element) inputs.current.set(node.id, element); else inputs.current.delete(node.id); }}
                      className={m.rowInput}
                      value={node.text}
                      placeholder={depth === 0 ? '中心主题' : '写一个要点'}
                      aria-label={depth === 0 ? '中心主题' : `第 ${depth} 级节点`}
                      onChange={(event) => rename(node.id, event.target.value)}
                      onKeyDown={(event) => onKey(event, row, index)}
                    />
                    <span className={m.rowActions}>
                      <IconButton label="添加子节点" size="sm" tip={false} onClick={() => addChild(node.id)}><CornerDownRight size={14} strokeWidth={1.75} /></IconButton>
                      {depth > 0 && <IconButton label="删除节点" size="sm" tip={false} onClick={() => removeNode(node.id)}><Trash2 size={14} strokeWidth={1.75} /></IconButton>}
                    </span>
                  </div>
                );
              })}
            </div>
            <Button variant="ghost" size="sm" icon={<Plus {...ICON_SM} />} className={m.addBranch} onClick={() => addChild(root.id)}>添加分支</Button>
            <p className={m.keys}>
              <span><Kbd>Enter</Kbd>同级</span>
              <span><Kbd>Tab</Kbd>缩进</span>
              <span><Kbd>⇧Tab</Kbd>提升</span>
              <span><Kbd>⌥↑↓</Kbd>移动</span>
            </p>
          </div>
        )}
        {view !== 'outline' && (
          <MapCanvas ref={canvas} root={root} folded={folded} onToggleFold={toggleFold} onFoldAll={foldAll} onExpandAll={expandAll} />
        )}
      </div>
      <div className={m.foot}>
        <span>{countNodes(root)} 个节点</span>
        <span className={s.saved}>{dirty ? '正在保存…' : '已保存'}</span>
        <span className={m.footHint} data-for="mouse">拖动平移，按住 ⌘ 或 Ctrl 滚动缩放，点圆点收起分支</span>
        <span className={m.footHint} data-for="touch">单指拖动，双指缩放，点圆点收起分支</span>
      </div>
    </div>
  );
}
