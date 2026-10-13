/**
 * 文本框里的位置与改写：浮动的 AI 条、斜杠菜单要知道光标在屏幕上的哪里；
 * 接受 AI 的改写时要走浏览器自己的编辑通道，这样 ⌘Z 还能撤销。
 */

const COPIED = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'lineHeight', 'letterSpacing', 'wordSpacing',
  'textTransform', 'textIndent', 'textAlign', 'tabSize', 'wordBreak', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
] as const;

/** 造一个和文本框排版完全一样、看不见的镜像，用完即删 */
function mirrorOf(area: HTMLTextAreaElement): { box: HTMLDivElement; done: () => void } {
  const style = getComputedStyle(area);
  const box = document.createElement('div');
  for (const name of COPIED) box.style[name] = style[name];
  const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  Object.assign(box.style, {
    position: 'fixed',
    top: '0',
    left: '-9999px',
    visibility: 'hidden',
    pointerEvents: 'none',
    boxSizing: 'content-box',
    // clientWidth 不含滚动条，换行位置才和文本框一致
    width: `${Math.max(0, area.clientWidth - pad)}px`,
    height: 'auto',
    border: '0',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    overflow: 'hidden',
  });
  document.body.appendChild(box);
  return { box, done: () => box.remove() };
}

export interface CaretRect { left: number; top: number; bottom: number; height: number }

/** 文本框里第 index 个字符前的光标，在视口里的位置 */
export function caretRect(area: HTMLTextAreaElement, index: number): CaretRect {
  const { box, done } = mirrorOf(area);
  const at = Math.max(0, Math.min(index, area.value.length));
  box.textContent = area.value.slice(0, at);
  const mark = document.createElement('span');
  // 零宽字符占位：行末、空行也能量到
  mark.textContent = '​';
  box.appendChild(mark);
  box.appendChild(document.createTextNode(area.value.slice(at) || ' '));
  const outer = area.getBoundingClientRect();
  const origin = box.getBoundingClientRect();
  const rect = mark.getBoundingClientRect();
  const border = { top: area.clientTop, left: area.clientLeft };
  const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || rect.height || 24;
  const top = outer.top + border.top + (rect.top - origin.top) - area.scrollTop;
  const left = outer.left + border.left + (rect.left - origin.left) - area.scrollLeft;
  done();
  return { left, top, bottom: top + lineHeight, height: lineHeight };
}

export interface LocalRect { left: number; top: number; width: number; height: number }

/** 一段选区在文本框内容坐标里的若干个矩形（不含滚动偏移），用来在文本框下面垫一层高亮 */
export function rangeRects(area: HTMLTextAreaElement, from: number, to: number): LocalRect[] {
  if (to <= from) return [];
  const { box, done } = mirrorOf(area);
  const text = document.createTextNode(area.value || ' ');
  box.appendChild(text);
  const range = document.createRange();
  range.setStart(text, Math.max(0, Math.min(from, text.length)));
  range.setEnd(text, Math.max(0, Math.min(to, text.length)));
  const origin = box.getBoundingClientRect();
  const rects = [...range.getClientRects()]
    .filter((rect) => rect.width > 0.5)
    .slice(0, 80)
    .map((rect) => ({ left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height }));
  done();
  return rects;
}

/**
 * 把文本框里 [from, to) 换成 text，光标落在新文字之后。
 * 优先用 insertText：它进浏览器的撤销栈，也会触发 input 事件让受控组件跟上；不支持时退回直接改值。
 */
export function replaceInArea(area: HTMLTextAreaElement, from: number, to: number, text: string): void {
  if (from === to && !text) return;
  area.focus({ preventScroll: true });
  area.setSelectionRange(from, to);
  let done = false;
  try {
    done = text ? document.execCommand('insertText', false, text) : document.execCommand('delete', false);
  } catch {
    done = false;
  }
  if (done) return;
  const next = area.value.slice(0, from) + text + area.value.slice(to);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(area, next); else area.value = next;
  area.setSelectionRange(from + text.length, from + text.length);
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 光标所在的那一行 */
export function lineAt(value: string, index: number): { start: number; end: number; text: string } {
  const start = value.lastIndexOf('\n', index - 1) + 1;
  const next = value.indexOf('\n', index);
  const end = next < 0 ? value.length : next;
  return { start, end, text: value.slice(start, end) };
}
