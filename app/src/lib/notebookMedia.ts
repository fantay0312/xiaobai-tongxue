import type { StudyArtifact } from '../engine/studyStudio';

export function videoExportSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

/** Produce a real, silent caption video. Speech synthesis is not an audio capture API. */
export async function exportCaptionVideo(artifact: StudyArtifact, signal: AbortSignal, onProgress: (value: number) => void): Promise<Blob> {
  if (!videoExportSupported()) throw new Error('当前浏览器不支持视频导出，可先导出 HTML 课件。');
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('当前浏览器没有可用的视频编码器。');
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法初始化视频画面。');
  const pages = [{ title: artifact.title, text: `字幕导读 · ${artifact.sources.length} 份来源\n${artifact.method === 'model' ? 'AI 整理，请核对原文' : '依据资料摘编'}` }, ...artifact.sections.flatMap((section) => {
    const chars = Array.from(section.text.replace(/\s+/g, ' '));
    return Array.from({ length: Math.max(1, Math.ceil(chars.length / 300)) }, (_, i) => ({ title: section.title, text: chars.slice(i * 300, (i + 1) * 300).join('') }));
  })];
  const stream = canvas.captureStream(15);
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream, { mimeType }); }
  catch { stream.getTracks().forEach((track) => track.stop()); throw new Error('当前浏览器无法启动视频录制。'); }
  const chunks: BlobPart[] = [];
  const draw = (index: number) => {
    const page = pages[index];
    context.fillStyle = '#f7f8fb'; context.fillRect(0, 0, 1280, 720);
    context.fillStyle = '#2865b8'; context.fillRect(64, 65, 42, 5);
    context.fillStyle = '#242b37'; context.font = '600 36px sans-serif';
    const lines = (text: string, maxWidth: number) => { const out: string[] = []; let line = ''; for (const char of text) { if (char === '\n' || context.measureText(line + char).width > maxWidth) { out.push(line); line = char === '\n' ? '' : char; } else line += char; } if (line) out.push(line); return out; };
    lines(page.title, 1120).slice(0, 2).forEach((line, n) => context.fillText(line, 64, 130 + n * 48));
    context.font = '25px sans-serif'; context.fillStyle = '#4d586a';
    lines(page.text, 1120).slice(0, 10).forEach((line, n) => context.fillText(line, 64, 250 + n * 34));
    context.font = '18px sans-serif'; context.fillStyle = '#687385'; context.fillText(`小白同学 · ${index + 1} / ${pages.length} · 无声字幕视频`, 64, 670);
    context.fillStyle = '#2865b8'; context.fillRect(0, 710, 1280 * (index + 1) / pages.length, 10);
  };
  return new Promise<Blob>((resolve, reject) => {
    let index = 0; let aborted = false; let timer: ReturnType<typeof setInterval> | undefined; let frameTimer: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => { if (timer) clearInterval(timer); if (frameTimer) clearInterval(frameTimer); stream.getTracks().forEach((track) => track.stop()); signal.removeEventListener('abort', abort); };
    const abort = () => { aborted = true; if (recorder.state !== 'inactive') recorder.stop(); else { cleanup(); reject(new DOMException('Aborted', 'AbortError')); } };
    signal.addEventListener('abort', abort, { once: true });
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { cleanup(); reject(new Error('视频导出失败，请重试。')); };
    recorder.onstop = () => { cleanup(); if (aborted) reject(new DOMException('Aborted', 'AbortError')); else if (chunks.length) resolve(new Blob(chunks, { type: mimeType })); else reject(new Error('没有录制到视频画面。')); };
    if (signal.aborted) { cleanup(); reject(new DOMException('Aborted', 'AbortError')); return; }
    draw(index); recorder.start(); onProgress(0);
    frameTimer = setInterval(() => draw(index), 1000 / 15);
    timer = setInterval(() => { index += 1; onProgress(index / pages.length); if (index >= pages.length) recorder.stop(); else draw(index); }, 3500);
  });
}

export function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename.replace(/[\\/:*?"<>|]/g, '-'); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
