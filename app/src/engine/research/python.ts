/**
 * 在浏览器内的 Python 里跑一段代码：挂载课题的 data/ 与 code/，把写出的文件和图存回课题。
 * 工具 run_python 与文件面板的「运行」按钮共用。环境不可用时如实返回，不伪造输出。
 */
import { pythonAvailable, runPython, type PyFile } from '../../lib/pyRuntime';
import type { Provenance, ToolView } from './types';
import { baseName, dataUrlBase64, fileExists, listFiles, mimeOf, normalizePath, readFile, toDataUrl, writeFile } from './workspace';

export type PythonView = Extract<ToolView, { kind: 'python' }>;

export interface PythonRunInput {
  code: string;
  /** 把这段代码存成课题文件，如 code/analysis.py */
  saveAs?: string;
  /** 图片文件名的前缀；不传则取 saveAs 的文件名 */
  figureStem?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdout?: (text: string) => void;
  provenance: Omit<Provenance, 'at' | 'action' | 'actor'>;
  /** 代码文件记在谁名下 */
  author: Provenance['actor'];
}

export interface PythonRunResult {
  /** false = 环境不可用，代码没有运行 */
  available: boolean;
  view: PythonView;
  /** 存回课题时没成功的文件及原因 */
  saveErrors: string[];
}

const MOUNT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_FILES = 24;

/** 保留开头和结尾：报错通常在最后 */
export function clipOutput(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.35);
  const tail = max - head;
  return `${text.slice(0, head)}\n…（中间省略 ${text.length - max} 字）…\n${text.slice(-tail)}`;
}

async function mountFiles(owner: string | null, projectId: string): Promise<PyFile[]> {
  const mounted: PyFile[] = [];
  let total = 0;
  for (const meta of listFiles(owner, projectId)) {
    if (!meta.path.startsWith('data/') && !meta.path.startsWith('code/')) continue;
    if (total + meta.size > MOUNT_BYTES) continue;
    const file = await readFile(owner, projectId, meta.path);
    if (!file) continue;
    total += meta.size;
    mounted.push(meta.encoding === 'utf8'
      ? { path: meta.path, content: file.content, encoding: 'utf8' }
      : { path: meta.path, content: dataUrlBase64(file.content), encoding: 'base64' });
  }
  return mounted;
}

function freePath(owner: string | null, projectId: string, wanted: string, taken: Set<string>): string {
  if (!fileExists(owner, projectId, wanted) && !taken.has(wanted)) return wanted;
  const dot = wanted.lastIndexOf('.');
  const stem = dot > 0 ? wanted.slice(0, dot) : wanted;
  const ext = dot > 0 ? wanted.slice(dot) : '';
  for (let index = 2; index < 200; index += 1) {
    const candidate = `${stem}-${index}${ext}`;
    if (!fileExists(owner, projectId, candidate) && !taken.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now().toString(36)}${ext}`;
}

export async function runProjectPython(owner: string | null, projectId: string, input: PythonRunInput): Promise<PythonRunResult> {
  const saveErrors: string[] = [];
  let savedAs: string | undefined;

  // 代码先落盘：即使环境不可用或运行失败，脚本也留得下来
  if (input.saveAs) {
    const path = normalizePath(input.saveAs);
    if (!path) saveErrors.push(`${input.saveAs}：路径不合法，代码没有另存`);
    else {
      try {
        await writeFile(owner, projectId, { path, content: input.code, provenance: { ...input.provenance, actor: input.author } });
        savedAs = path;
      } catch (error) {
        saveErrors.push(`${path}：${error instanceof Error ? error.message : '保存失败'}`);
      }
    }
  }

  const empty: PythonView = { kind: 'python', code: input.code.slice(0, 8000), ok: false, stdout: '', stderr: '', figures: [], files: [], durationMs: 0, ...(savedAs ? { savedAs } : {}) };
  const available = await pythonAvailable().catch(() => false);
  if (!available) {
    return { available: false, view: { ...empty, error: '当前浏览器里没有可用的 Python 运行环境，代码没有运行。' }, saveErrors };
  }

  const mounted = await mountFiles(owner, projectId);
  const result = await runPython({
    code: input.code,
    files: mounted,
    timeoutMs: input.timeoutMs,
    onStdout: input.onStdout,
    signal: input.signal,
  });

  const taken = new Set<string>();
  const written: string[] = [];
  for (const file of result.files.slice(0, MAX_OUTPUT_FILES)) {
    const path = normalizePath(file.path);
    if (!path) {
      saveErrors.push(`${file.path}：路径不合法，没有存回课题`);
      continue;
    }
    try {
      const binary = file.encoding === 'base64';
      await writeFile(owner, projectId, {
        path,
        content: binary ? toDataUrl(file.content, mimeOf(path)) : file.content,
        encoding: binary ? 'dataurl' : 'utf8',
        provenance: { ...input.provenance, actor: 'python', note: savedAs ? `由 ${savedAs} 写出` : '由运行的代码写出' },
      });
      written.push(path);
      taken.add(path);
    } catch (error) {
      saveErrors.push(`${path}：${error instanceof Error ? error.message : '保存失败'}`);
    }
  }
  if (result.files.length > MAX_OUTPUT_FILES) saveErrors.push(`代码写出了 ${result.files.length} 个文件，只存回前 ${MAX_OUTPUT_FILES} 个`);

  const named = input.figureStem ?? (savedAs ? baseName(savedAs) : '');
  const stem = named ? named.replace(/\.[a-z0-9]+$/i, '') : `fig-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
  const figures: string[] = [];
  for (const [index, dataUrl] of result.figures.entries()) {
    const path = freePath(owner, projectId, `figures/${stem}${result.figures.length > 1 ? `-${index + 1}` : ''}.png`, taken);
    try {
      await writeFile(owner, projectId, {
        path,
        content: dataUrl.startsWith('data:') ? dataUrl : toDataUrl(dataUrl, 'image/png'),
        encoding: 'dataurl',
        provenance: { ...input.provenance, actor: 'python', note: savedAs ? `由 ${savedAs} 画出` : '由运行的代码画出' },
      });
      figures.push(path);
      taken.add(path);
    } catch (error) {
      saveErrors.push(`${path}：${error instanceof Error ? error.message : '保存失败'}`);
    }
  }

  return {
    available: true,
    saveErrors,
    view: {
      kind: 'python',
      code: input.code.slice(0, 8000),
      ok: result.ok,
      stdout: clipOutput(result.stdout, 6000),
      stderr: clipOutput(result.stderr, 2400),
      ...(result.error ? { error: clipOutput(result.error, 3000) } : {}),
      ...(result.result ? { result: clipOutput(result.result, 1600) } : {}),
      figures,
      files: written,
      durationMs: result.durationMs,
      ...(savedAs ? { savedAs } : {}),
    },
  };
}
