/**
 * 课程导出：可编辑的 .pptx（pptxgenjs）与单文件交互式 .html。
 * HTML 课件里的公式预先转成 MathML、结构图预先转成 SVG，整个文件不依赖网络。
 */
import katex from 'katex';
import {
  AGENTS, INTERACTIVE_PALETTE, SCENE_LABELS, escapeHtml, estimateMinutes, optionLetter, plainText, prepareInteractiveDoc,
  type Lesson, type LessonScene,
} from '../../../../engine/lessonStudio';
import { saveBlob } from '../../../../lib/notebookMedia';
import { renderMermaid } from './figures';

const fileName = (lesson: Lesson, ext: string) => `${lesson.title.slice(0, 40) || '课程'}.${ext}`;

/** mermaid 源码里的节点文字，按出现顺序去重：PPT 里放不了图时用它概括 */
function diagramSummary(code: string): string {
  const labels = [...code.matchAll(/[[({]+"?([^"\])}|]{1,30})"?[\])}]+/g)].map((match) => match[1].trim()).filter(Boolean);
  return [...new Set(labels)].slice(0, 8).join(' → ');
}

const speakerNotes = (scene: LessonScene) => [
  scene.script ? `讲稿：${plainText(scene.script)}` : '',
  ...scene.interjections.map((item) => `${AGENTS[item.speaker].name}：${item.text}${item.reply ? `\n小砚：${item.reply}` : ''}`),
].filter(Boolean).join('\n\n');

// ───────────────────────── PPTX ─────────────────────────

export async function exportPptx(lesson: Lesson): Promise<void> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = lesson.title;
  pptx.company = '小白同学';
  const FONT = 'Microsoft YaHei';
  const INK = '16181C';
  const SUB = '4B5059';
  const MUTED = '7A808A';
  const ACCENT = '3B72E6';
  const WELL = 'F2F3F5';
  const W = 13.33;

  const cover = pptx.addSlide();
  cover.background = { color: 'FFFFFF' };
  cover.addShape('rect', { x: 0.8, y: 2.2, w: 0.9, h: 0.08, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 } });
  cover.addText(lesson.title, { x: 0.8, y: 2.45, w: W - 1.6, h: 1.3, fontSize: 40, bold: true, color: INK, fontFace: FONT, valign: 'top' });
  if (lesson.summary) cover.addText(lesson.summary, { x: 0.8, y: 3.75, w: W - 1.6, h: 0.8, fontSize: 18, color: SUB, fontFace: FONT, valign: 'top' });
  cover.addText(`${lesson.scenes.length} 幕 · 约 ${estimateMinutes(lesson)} 分钟 · 小白同学 AI 课堂`, { x: 0.8, y: 6.4, w: W - 1.6, h: 0.4, fontSize: 12, color: MUTED, fontFace: FONT });
  if (lesson.objectives.length) {
    const goals = pptx.addSlide();
    goals.addText('学习目标', { x: 0.8, y: 0.6, w: W - 1.6, h: 0.8, fontSize: 28, bold: true, color: INK, fontFace: FONT });
    goals.addText(lesson.objectives.map((text) => ({ text: plainText(text), options: { bullet: true, breakLine: true } })), {
      x: 0.8, y: 1.6, w: W - 1.6, h: 4.8, fontSize: 20, color: SUB, fontFace: FONT, valign: 'top', paraSpaceAfter: 12,
    });
  }

  lesson.scenes.forEach((scene, index) => {
    const head = (title: string) => {
      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };
      slide.addText(`${String(index + 1).padStart(2, '0')} · ${SCENE_LABELS[scene.type]}`, { x: 0.8, y: 0.45, w: 6, h: 0.35, fontSize: 12, bold: true, color: ACCENT, fontFace: FONT });
      slide.addText(plainText(title), { x: 0.8, y: 0.8, w: W - 1.6, h: 0.9, fontSize: 28, bold: true, color: INK, fontFace: FONT, valign: 'top' });
      return slide;
    };
    const bulletText = (items: string[]) => items.map((text) => ({ text: plainText(text), options: { bullet: true, breakLine: true } }));
    const body = { x: 0.8, y: 1.85, h: 4.9, fontSize: 20, color: SUB, fontFace: FONT, valign: 'top' as const, paraSpaceAfter: 12 };

    switch (scene.type) {
      case 'slide': {
        const slide = head(scene.title);
        const figure = scene.figure;
        const figureText = !figure ? '' : figure.kind === 'mermaid' ? diagramSummary(figure.content) : figure.content;
        slide.addText(bulletText(scene.bullets), { ...body, w: figureText ? 6.6 : W - 1.6 });
        if (figure && figureText) {
          slide.addText(figureText, {
            x: 7.7, y: 1.85, w: 4.85, h: 4.2, fontSize: figure.kind === 'code' ? 12 : 16, color: INK, valign: 'top', margin: 14,
            fontFace: figure.kind === 'mermaid' ? FONT : 'Consolas', fill: { color: WELL },
          });
          if (figure.caption) slide.addText(figure.caption, { x: 7.7, y: 6.1, w: 4.85, h: 0.35, fontSize: 11, color: MUTED, fontFace: FONT });
        }
        slide.addNotes(speakerNotes(scene));
        break;
      }
      case 'whiteboard': {
        const slide = head(scene.title);
        const rows = scene.strokes.flatMap((stroke) => {
          const text = stroke.kind === 'diagram' ? diagramSummary(stroke.content) : plainText(stroke.content);
          if (!text) return [];
          return [{
            text,
            options: {
              breakLine: true,
              ...(stroke.kind === 'highlight' ? { bold: true, color: ACCENT } : {}),
              ...(stroke.kind === 'formula' ? { fontFace: 'Cambria Math', color: INK } : {}),
            },
          }];
        });
        slide.addText(rows, { ...body, w: W - 1.6 });
        slide.addNotes(scene.strokes.map((stroke) => stroke.say).filter(Boolean).join('\n') + (scene.interjections.length ? `\n\n${speakerNotes({ ...scene, script: '' })}` : ''));
        break;
      }
      case 'quiz': {
        scene.questions.forEach((question, order) => {
          const slide = head(`${scene.title}（${order + 1}/${scene.questions.length}）`);
          slide.addText(plainText(question.stem), { x: 0.8, y: 1.85, w: W - 1.6, h: 1.5, fontSize: 20, color: INK, fontFace: FONT, valign: 'top' });
          slide.addText(question.options.map((option, i) => ({ text: `${optionLetter(i)}.  ${plainText(option)}`, options: { breakLine: true } })), {
            x: 0.8, y: 3.4, w: W - 1.6, h: 3.2, fontSize: 18, color: SUB, fontFace: FONT, valign: 'top', paraSpaceAfter: 10,
          });
          slide.addNotes(`答案：${question.answer.map(optionLetter).join('、')}\n解析：${plainText(question.explanation)}${order === 0 && scene.script ? `\n\n讲稿：${plainText(scene.script)}` : ''}`);
        });
        break;
      }
      case 'interactive': {
        const slide = head(scene.title);
        slide.addText([
          { text: plainText(scene.instructions), options: { breakLine: true } },
          { text: '这一幕是可操作的互动模拟，请在课堂里或导出的交互式 HTML 课件中打开。', options: { color: MUTED, fontSize: 14 } },
        ], { ...body, w: W - 1.6 });
        slide.addNotes(speakerNotes(scene));
        break;
      }
      case 'pbl': {
        const slide = head(scene.title);
        slide.addText(plainText(scene.brief), { x: 0.8, y: 1.85, w: 6.4, h: 2.4, fontSize: 16, color: SUB, fontFace: FONT, valign: 'top' });
        slide.addText(`交付物：${plainText(scene.deliverable)}`, { x: 0.8, y: 4.35, w: 6.4, h: 0.9, fontSize: 15, bold: true, color: INK, fontFace: FONT, valign: 'top' });
        if (scene.rubric.length) {
          slide.addText(scene.rubric.map((item) => ({ text: `${item.criterion}${item.levels ? `：${item.levels}` : ''}`, options: { bullet: true, breakLine: true } })), {
            x: 0.8, y: 5.3, w: 6.4, h: 1.7, fontSize: 11, color: MUTED, fontFace: FONT, valign: 'top',
          });
        }
        slide.addText(scene.milestones.map((item, i) => ({ text: `${i + 1}. ${item.title}${item.detail ? `\n${item.detail}` : ''}`, options: { breakLine: true } })), {
          x: 7.6, y: 1.85, w: 4.95, h: 5.1, fontSize: 14, color: INK, fontFace: FONT, valign: 'top', margin: 14, fill: { color: WELL }, paraSpaceAfter: 8,
        });
        slide.addNotes(speakerNotes(scene));
        break;
      }
    }
  });

  const blob = await pptx.write({ outputType: 'blob' });
  saveBlob(fileName(lesson, 'pptx'), blob as Blob);
}

// ───────────────────────── HTML ─────────────────────────

function mathHtml(tex: string, block: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: block, output: 'mathml', throwOnError: false, strict: 'ignore' });
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}

/** 行内 Markdown → HTML：代码、公式、加粗、斜体 */
function inlineHtml(text: string): string {
  const holds: string[] = [];
  const hold = (html: string) => `\u0000${holds.push(html) - 1}\u0000`;
  const withHolds = text
    .replace(/`([^`\n]+)`/g, (_, code: string) => hold(`<code>${escapeHtml(code)}</code>`))
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => hold(mathHtml(tex.trim(), true)))
    .replace(/\$([^$\n]+)\$/g, (_, tex: string) => hold(mathHtml(tex.trim(), false)));
  return escapeHtml(withHolds)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (_, index: string) => holds[Number(index)]);
}

/** 小段 Markdown → HTML：代码块、列表、引用、段落 */
function blockHtml(text: string): string {
  const out: string[] = [];
  const parts = text.split(/```[\w-]*\n([\s\S]*?)```/);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      out.push(`<pre><code>${escapeHtml(part.replace(/\n$/, ''))}</code></pre>`);
      return;
    }
    let list: string[] = [];
    const flush = () => {
      if (list.length) out.push(`<ul>${list.map((item) => `<li>${item}</li>`).join('')}</ul>`);
      list = [];
    };
    for (const raw of part.split('\n')) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      const item = line.match(/^(?:[-+*]|\d+[.)])\s+(.+)$/);
      if (item) { list.push(inlineHtml(item[1])); continue; }
      flush();
      const heading = line.match(/^#{1,4}\s+(.+)$/);
      const quote = line.match(/^>\s?(.*)$/);
      if (heading) out.push(`<h4>${inlineHtml(heading[1])}</h4>`);
      else if (quote) out.push(`<blockquote>${inlineHtml(quote[1])}</blockquote>`);
      else out.push(`<p>${inlineHtml(line)}</p>`);
    }
    flush();
  });
  return out.join('');
}

async function diagramHtml(code: string): Promise<string> {
  const svg = await renderMermaid(code, INTERACTIVE_PALETTE).catch(() => null);
  return svg ? `<div class="diagram">${svg}</div>` : `<pre><code>${escapeHtml(code)}</code></pre>`;
}

function talkHtml(scene: LessonScene): string {
  const lines = [
    scene.script ? `<p class="say"><b>小砚</b>${escapeHtml(plainText(scene.script))}</p>` : '',
    ...scene.interjections.map((item) => `<p class="say mate"><b>${AGENTS[item.speaker].name}</b>${escapeHtml(item.text)}</p>${item.reply ? `<p class="say"><b>小砚</b>${escapeHtml(item.reply)}</p>` : ''}`),
  ].filter(Boolean).join('');
  return lines ? `<details class="talk"><summary>课堂讲稿</summary>${lines}</details>` : '';
}

async function sceneHtml(scene: LessonScene): Promise<string> {
  switch (scene.type) {
    case 'slide': {
      const figure = scene.figure;
      const figureHtml = !figure ? '' : figure.kind === 'mermaid' ? await diagramHtml(figure.content)
        : figure.kind === 'formula' ? `<div class="formula">${mathHtml(figure.content, true)}</div>`
          : `<pre><code>${escapeHtml(figure.content)}</code></pre>`;
      return `<div class="cols${figure ? ' two' : ''}"><ul class="bullets">${scene.bullets.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</ul>${figure ? `<figure>${figureHtml}${figure.caption ? `<figcaption>${escapeHtml(figure.caption)}</figcaption>` : ''}</figure>` : ''}</div>${talkHtml(scene)}`;
    }
    case 'whiteboard': {
      const strokes = await Promise.all(scene.strokes.map(async (stroke) => {
        const content = stroke.kind === 'formula' ? `<div class="formula">${mathHtml(stroke.content, true)}</div>`
          : stroke.kind === 'diagram' ? await diagramHtml(stroke.content)
            : stroke.kind === 'highlight' ? `<p class="mark">${inlineHtml(stroke.content)}</p>`
              : `<p class="chalk">${inlineHtml(stroke.content)}</p>`;
        return `<div class="stroke">${content}${stroke.say ? `<small>${escapeHtml(stroke.say)}</small>` : ''}</div>`;
      }));
      return `<div class="board">${strokes.join('')}</div>${talkHtml({ ...scene, script: '' })}`;
    }
    case 'quiz':
      return scene.questions.map((question, order) => `<div class="question" data-type="${question.type}" data-answer="${question.answer.join(',')}">
<div class="stem"><span>${order + 1}</span><div>${blockHtml(question.stem)}</div></div>
<div class="options">${question.options.map((option, i) => `<button type="button" class="option" data-index="${i}"><i>${question.type === 'truefalse' ? '' : optionLetter(i)}</i><span>${inlineHtml(option)}</span></button>`).join('')}</div>
${question.type === 'multiple' ? '<button type="button" class="submit" disabled>提交</button>' : ''}
<div class="explain" hidden><b></b>${blockHtml(question.explanation)}</div></div>`).join('') + talkHtml(scene);
    case 'interactive':
      return `<p class="lead">${escapeHtml(scene.instructions)}</p><iframe class="sim" title="${escapeHtml(scene.title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapeHtml(prepareInteractiveDoc(scene.html))}"></iframe>${talkHtml(scene)}`;
    case 'pbl':
      return `<div class="cols two"><div>${blockHtml(scene.brief)}<p class="deliver"><b>交付物</b>${escapeHtml(scene.deliverable)}</p>${scene.rubric.length ? `<table><thead><tr><th>评价维度</th><th>标准</th></tr></thead><tbody>${scene.rubric.map((item) => `<tr><td>${escapeHtml(item.criterion)}</td><td>${escapeHtml(item.levels)}</td></tr>`).join('')}</tbody></table>` : ''}</div>
<ol class="miles">${scene.milestones.map((item) => `<li><label><input type="checkbox"><span><b>${escapeHtml(item.title)}</b>${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ''}</span></label></li>`).join('')}</ol></div>${talkHtml(scene)}`;
  }
}

const HTML_STYLE = `*{box-sizing:border-box}html,body{height:100%}body{margin:0;display:grid;grid-template-columns:260px 1fr;font:15px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:#f7f7f8;color:#1b1d21}
nav{display:flex;flex-direction:column;gap:2px;padding:20px 12px;overflow:auto;border-right:1px solid #e6e8ec}
nav h1{margin:0 8px 4px;font-size:17px;line-height:1.4}nav>p{margin:0 8px 14px;color:#7a808a;font-size:13px}
nav button{display:flex;gap:10px;align-items:baseline;width:100%;padding:8px 10px;border:0;border-radius:10px;background:none;color:#4b5059;font:inherit;font-size:14px;text-align:left;cursor:pointer;transition:background .15s}
nav button:hover{background:rgba(15,23,42,.05)}nav button[aria-current=true]{background:#e7eefc;color:#1b1d21;font-weight:600}
nav button i{flex:none;width:1.6em;color:#a6abb4;font-style:normal;font-size:12px;font-variant-numeric:tabular-nums}nav button small{margin-left:auto;flex:none;color:#a6abb4;font-size:12px;font-weight:400}
main{display:flex;flex-direction:column;min-width:0;height:100vh;padding:24px 32px 16px}
.scene{flex:1;min-height:0;overflow:auto;padding:28px 36px;border-radius:24px;background:#fff;box-shadow:0 0 0 1px rgba(15,23,42,.05),0 4px 14px rgba(15,23,42,.08)}
.scene[hidden]{display:none}.tag{color:#3b72e6;font-size:12px;font-weight:600;letter-spacing:.04em}.scene h2{margin:4px 0 20px;font-size:28px;line-height:1.3}
.cols.two{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:28px;align-items:start}
.bullets{margin:0;padding:0;list-style:none;display:grid;gap:14px;font-size:19px}.bullets li{padding-left:22px;position:relative}.bullets li:before{content:"";position:absolute;left:2px;top:.62em;width:7px;height:7px;border-radius:50%;background:#3b72e6}
figure{margin:0}figcaption{margin-top:8px;color:#7a808a;font-size:13px;text-align:center}
pre{margin:0 0 12px;padding:14px 16px;border-radius:12px;background:#f2f3f5;font:13px/1.7 ui-monospace,Menlo,Consolas,monospace;overflow:auto}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em}p code,li code{padding:1px 5px;border-radius:5px;background:#f2f3f5}
.formula{padding:14px;border-radius:12px;background:#f2f3f5;font-size:20px;text-align:center;overflow:auto}.diagram{overflow:auto;text-align:center}.diagram svg{max-width:100%;height:auto}
.board{display:grid;gap:16px;padding:24px;border-radius:16px;background:#f2f3f5 radial-gradient(rgba(15,23,42,.1) 1px,transparent 1px) 0 0/22px 22px}
.stroke p{margin:0}.stroke small{display:block;margin-top:4px;color:#7a808a;font-size:13px}.chalk{font:22px/1.5 "LXGW WenKai Screen","Kaiti SC",STKaiti,KaiTi,serif}.board .formula{background:none;text-align:left;padding:0}
.mark{display:inline-block;padding:4px 12px;border-radius:8px;background:#e7eefc;box-shadow:inset 0 -3px 0 #3b72e6;font:600 20px/1.5 "LXGW WenKai Screen","Kaiti SC",STKaiti,KaiTi,serif}
.question{margin-bottom:24px}.stem{display:flex;gap:12px;font-size:17px}.stem>span{flex:none;width:26px;height:26px;border-radius:50%;background:#f2f3f5;color:#4b5059;font-size:13px;font-weight:600;text-align:center;line-height:26px}.stem p{margin:0 0 8px}
.options{display:grid;gap:8px;margin:8px 0 0 38px}.option{display:flex;gap:12px;align-items:center;min-height:44px;padding:8px 14px;border:1px solid #d3d6dc;border-radius:12px;background:#fff;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .15s,border-color .15s}
.option:hover:not(:disabled){background:#f7f7f8}.option:focus-visible,.submit:focus-visible,nav button:focus-visible,.pager button:focus-visible{outline:0;box-shadow:0 0 0 3px rgba(59,114,230,.45)}
.option i{flex:none;width:24px;height:24px;border-radius:50%;background:#f2f3f5;font-style:normal;font-size:12px;font-weight:600;text-align:center;line-height:24px}.option i:empty{display:none}
.option.picked{border-color:#3b72e6;background:#e7eefc}.option.right{border-color:#1f9d6b;background:#e2f4ec}.option.wrong{border-color:#d5483f;background:#fbe9e7}.option:disabled{cursor:default}
.submit,.pager button{height:36px;padding:0 16px;border:0;border-radius:10px;background:#16181c;color:#fff;font:inherit;font-size:14px;cursor:pointer}.submit{margin:10px 0 0 38px}.submit:disabled,.pager button:disabled{opacity:.4;cursor:default}
.explain{margin:10px 0 0 38px;padding:12px 16px;border-radius:12px;background:#f2f3f5;font-size:14px}.explain b{display:block;margin-bottom:2px}.explain p{margin:0}.explain.ok b{color:#1f9d6b}.explain.no b{color:#d5483f}
.lead{margin:0 0 12px;color:#4b5059}.sim{width:100%;height:460px;border:1px solid #e6e8ec;border-radius:14px;background:#fff}
.deliver{padding:12px 16px;border-radius:12px;background:#f2f3f5}.deliver b{display:block;font-size:12px;color:#7a808a}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:8px 10px;border-bottom:1px solid #e6e8ec;text-align:left;vertical-align:top}th{color:#7a808a;font-size:12px;font-weight:600}
.miles{margin:0;padding:0;list-style:none;display:grid;gap:8px}.miles label{display:flex;gap:10px;padding:12px 14px;border-radius:12px;background:#f2f3f5;cursor:pointer}.miles input{margin-top:5px;accent-color:#3b72e6}.miles small{display:block;color:#7a808a;font-size:13px}
.talk{margin-top:24px;padding-top:14px;border-top:1px solid #e6e8ec;font-size:14px}.talk summary{color:#7a808a;font-size:13px;cursor:pointer}.say{margin:10px 0 0;color:#4b5059}.say b{margin-right:8px;color:#1b1d21}.say.mate{padding:8px 12px;border-radius:12px;background:#f2f3f5}
.pager{display:flex;gap:12px;align-items:center;justify-content:space-between;padding-top:14px;color:#7a808a;font-size:13px}.pager button.ghost{background:#fff;color:#1b1d21;box-shadow:inset 0 0 0 1px #d3d6dc}
kbd{padding:1px 6px;border-radius:5px;background:#fff;box-shadow:inset 0 0 0 1px #d3d6dc;font:12px ui-monospace,Menlo,monospace}
@media(max-width:820px){body{grid-template-columns:1fr}nav{flex-direction:row;padding:10px 12px;border-right:0;border-bottom:1px solid #e6e8ec}nav h1,nav>p,nav button small{display:none}nav button{width:auto;white-space:nowrap}main{height:auto;min-height:calc(100vh - 58px);padding:12px}.scene{padding:20px 16px}.scene h2{font-size:22px}.cols.two{grid-template-columns:1fr}.bullets{font-size:17px}.options,.submit,.explain{margin-left:0}}
@media print{body{display:block}nav,.pager{display:none}main{height:auto}.scene,.scene[hidden]{display:block;box-shadow:none;break-after:page}}`;

const HTML_SCRIPT = `(function(){
var scenes=[].slice.call(document.querySelectorAll('.scene')),tabs=[].slice.call(document.querySelectorAll('nav button')),at=0;
var prev=document.getElementById('prev'),next=document.getElementById('next'),pos=document.getElementById('pos');
function show(i){at=Math.max(0,Math.min(scenes.length-1,i));scenes.forEach(function(s,n){s.hidden=n!==at});tabs.forEach(function(t,n){t.setAttribute('aria-current',n===at)});
prev.disabled=at===0;next.disabled=at===scenes.length-1;pos.textContent=(at+1)+' / '+scenes.length;scenes[at].scrollTop=0;try{history.replaceState(null,'','#'+(at+1))}catch(e){}}
tabs.forEach(function(t,n){t.onclick=function(){show(n)}});prev.onclick=function(){show(at-1)};next.onclick=function(){show(at+1)};
document.addEventListener('keydown',function(e){if(/INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)&&e.key===' ')return;
if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){e.preventDefault();show(at+1)}if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();show(at-1)}if(e.key==='Home')show(0);if(e.key==='End')show(scenes.length-1)});
[].forEach.call(document.querySelectorAll('.question'),function(q){
var answer=q.dataset.answer.split(',').map(Number),multi=q.dataset.type==='multiple',options=[].slice.call(q.querySelectorAll('.option')),submit=q.querySelector('.submit'),explain=q.querySelector('.explain'),picked=[];
function grade(){var ok=picked.length===answer.length&&picked.every(function(i){return answer.indexOf(i)>=0});
options.forEach(function(o,i){o.disabled=true;o.classList.remove('picked');if(answer.indexOf(i)>=0)o.classList.add('right');else if(picked.indexOf(i)>=0)o.classList.add('wrong')});
if(submit)submit.hidden=true;explain.hidden=false;explain.classList.add(ok?'ok':'no');explain.querySelector('b').textContent=ok?'答对了':'再想想';}
options.forEach(function(o,i){o.onclick=function(){if(!multi){picked=[i];grade();return}var k=picked.indexOf(i);if(k>=0)picked.splice(k,1);else picked.push(i);o.classList.toggle('picked',k<0);submit.disabled=!picked.length}});
if(submit)submit.onclick=grade});
show(Math.max(0,(parseInt(location.hash.slice(1),10)||1)-1));
})();`;

export async function buildLessonHtml(lesson: Lesson): Promise<string> {
  const sections = await Promise.all(lesson.scenes.map(async (scene, index) => `<section class="scene" id="s${index + 1}" hidden>
<div class="tag">${String(index + 1).padStart(2, '0')} · ${SCENE_LABELS[scene.type]}</div><h2>${escapeHtml(scene.title)}</h2>
${await sceneHtml(scene)}
</section>`));
  const nav = lesson.scenes.map((scene, index) => `<button type="button"><i>${index + 1}</i><span>${escapeHtml(scene.title)}</span><small>${SCENE_LABELS[scene.type]}</small></button>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(lesson.title)}</title>
<style>${HTML_STYLE}</style>
</head>
<body>
<nav aria-label="课程目录"><h1>${escapeHtml(lesson.title)}</h1><p>${lesson.scenes.length} 幕 · 约 ${estimateMinutes(lesson)} 分钟</p>${nav}</nav>
<main>
${sections.join('\n')}
<div class="pager"><button type="button" class="ghost" id="prev">上一幕</button><span><span id="pos"></span>　<kbd>←</kbd> <kbd>→</kbd> 翻页</span><button type="button" id="next">下一幕</button></div>
</main>
<script>${HTML_SCRIPT}</script>
</body>
</html>`;
}

export async function exportHtml(lesson: Lesson): Promise<void> {
  const html = await buildLessonHtml(lesson);
  saveBlob(fileName(lesson, 'html'), new Blob([html], { type: 'text/html;charset=utf-8' }));
}
