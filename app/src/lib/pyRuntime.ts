/**
 * 浏览器内的 Python 运行环境 —— 科研台用它真实地跑分析和画图。
 * 基于 Pyodide（WebAssembly），在 Web Worker 里执行，代码与数据都不离开浏览器。
 *
 * 文件全部来自本站的 pyodide/ 目录（由 scripts/fetch-pyodide.mjs 准备），不从任何 CDN 加载。
 * 解释器是长驻的：同一个页面里多次运行共享变量和工作目录，直到超时、取消或 resetPython()。
 * 导出名与签名是科研台的契约，保持不变。
 */
import type { FromWorker, PyManifest, RunOutcome, ToWorker } from './py/protocol';

export interface PyFile {
  /** 相对路径，如 data/results.csv */
  path: string;
  /** 文本内容；二进制用 base64 */
  content: string;
  encoding?: 'utf8' | 'base64';
}

export interface PyRunInput {
  code: string;
  /** 运行前写进工作目录的文件 */
  files?: PyFile[];
  /** 默认 60 秒，超时会终止 Worker */
  timeoutMs?: number;
  /** 标准输出的流式回调（累计全文） */
  onStdout?: (text: string) => void;
  signal?: AbortSignal;
}

export interface PyRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** 最后一个表达式的 repr（如果有） */
  result?: string;
  /** matplotlib 画出的图，PNG 的 data URL，按产生顺序 */
  figures: string[];
  /** 这次运行在工作目录里新建或改过的文件 */
  files: PyFile[];
  /** 出错时的 Python 回溯（已截短） */
  error?: string;
  durationMs: number;
}

/** 可用的三方包（已随站点自带，不联网下载）；与 scripts/fetch-pyodide.mjs 的 PACKAGES 保持一致 */
export const PY_PACKAGES = ['numpy', 'pandas', 'matplotlib', 'scipy'] as const;

/** 预热时就下载并导入的包。scipy 有 13 MB，等代码第一次 import 时才下载 */
const PRELOAD = ['numpy', 'pandas', 'matplotlib'];
const DEFAULT_TIMEOUT_MS = 60_000;
/** 用户代码开始执行前（装依赖包）最多等这么久 */
const PREPARE_TIMEOUT_MS = 180_000;
const UNAVAILABLE = 'Python 运行环境暂不可用';
const CANCELLED_BEFORE_START = '已取消，代码没有运行。';
const STATE_LOST = '解释器已重启：之前定义的变量、导入的模块和工作目录里的文件都已清空。';

type ProgressListener = (ratio: number, label: string) => void;

interface Environment {
  base: string;
  lock: string;
  manifest: PyManifest;
}

interface Session {
  worker: Worker;
  alive: boolean;
  ready: Promise<void>;
  settleReady: (error?: Error) => void;
}

interface ActiveRun {
  id: number;
  session: Session;
  onStarted: () => void;
  onStdout: (text: string) => void;
  onDone: (outcome: RunOutcome) => void;
  interrupt: (reason: string) => void;
}

let environment: Promise<Environment | null> | null = null;
let session: Session | null = null;
let activeRun: ActiveRun | null = null;
let queue: Promise<unknown> = Promise.resolve();
let runCount = 0;
let lastProgress = { ratio: 0, label: '' };
const listeners = new Set<ProgressListener>();

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/* ---------- 是否可用 ---------- */

/** type: 'module' 的 Worker 只有被支持时才会去读这个选项 */
function supportsModuleWorker(): boolean {
  let supported = false;
  try {
    const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
    const options = {
      get type(): WorkerType {
        supported = true;
        return 'module';
      },
    };
    new Worker(url, options).terminate();
    URL.revokeObjectURL(url);
  } catch {
    /* 构造不出来按不支持处理 */
  }
  return supported;
}

async function probeEnvironment(): Promise<Environment | null> {
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || typeof WebAssembly !== 'object') return null;
  if (!supportsModuleWorker()) return null;
  const base = new URL(`${import.meta.env?.BASE_URL ?? '/'}pyodide/`, window.location.href).href;
  const response = await fetch(`${base}pyodide-lock.json`, { cache: 'no-cache' });
  if (!response.ok) return null;
  const lock = await response.text();
  try {
    // 文件不存在时站点会回落成首页 HTML，解析不过就说明没有随站提供
    const manifest = (JSON.parse(lock) as { tool?: { xiaobai?: PyManifest } }).tool?.xiaobai;
    if (!manifest?.pyodide || !manifest.files?.['pyodide.asm.wasm']) return null;
    return { base, lock, manifest };
  } catch {
    return null;
  }
}

function loadEnvironment(): Promise<Environment | null> {
  if (!environment) {
    const attempt = probeEnvironment().catch(() => {
      // 网络抖动不算“没有”，下次调用再查
      if (environment === attempt) environment = null;
      return null;
    });
    environment = attempt;
  }
  return environment;
}

/** 运行环境是否随站点提供（文件存在且浏览器支持） */
export async function pythonAvailable(): Promise<boolean> {
  return (await loadEnvironment()) !== null;
}

/* ---------- Worker 会话 ---------- */

function emitProgress(ratio: number, label: string) {
  lastProgress = { ratio, label };
  for (const listener of listeners) {
    try {
      listener(ratio, label);
    } catch {
      /* 界面回调出错不影响加载 */
    }
  }
}

/** 终止一个会话。还在等它就绪的调用方会被唤醒：带 error 就失败，不带就去等下一个会话 */
function retire(target: Session, error?: Error) {
  if (!target.alive) return;
  target.alive = false;
  target.worker.terminate();
  if (session === target) session = null;
  target.settleReady(error);
}

function handleMessage(owner: Session, message: FromWorker) {
  if (!owner.alive) return;
  switch (message.type) {
    case 'progress':
      emitProgress(message.ratio, message.label);
      break;
    case 'ready':
      owner.settleReady();
      break;
    case 'fail':
      retire(owner, new Error(`Python 运行环境加载失败：${message.message}`));
      break;
    case 'started':
      if (activeRun?.id === message.id) activeRun.onStarted();
      break;
    case 'stdout':
      if (activeRun?.id === message.id) activeRun.onStdout(message.text);
      break;
    case 'done':
      if (activeRun?.id === message.id) activeRun.onDone(message.outcome);
      break;
  }
}

function startSession(env: Environment): Session {
  const worker = new Worker(new URL('./pyWorker.ts', import.meta.url), { type: 'module' });
  let settleReady: Session['settleReady'] = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    settleReady = (error) => (error ? reject(error) : resolve());
  });
  ready.catch(() => {});
  const created: Session = { worker, alive: true, ready, settleReady };
  worker.onmessage = (event: MessageEvent<FromWorker>) => handleMessage(created, event.data);
  worker.onerror = (event) => {
    event.preventDefault();
    if (!created.alive) return;
    retire(created, new Error('Python 运行环境加载失败：Worker 没有启动成功'));
    if (activeRun?.session === created) activeRun.interrupt('运行环境意外中断，可能是内存不够。');
  };
  emitProgress(0, '准备 Python 运行环境…');
  const init: ToWorker = { type: 'init', base: env.base, lock: env.lock, manifest: env.manifest, preload: PRELOAD };
  worker.postMessage(init);
  return created;
}

async function ensureSession(): Promise<Session> {
  const env = await loadEnvironment();
  if (!env) throw new Error(UNAVAILABLE);
  for (;;) {
    session ??= startSession(env);
    const current = session;
    await current.ready;
    if (current.alive) return current;
  }
}

/** Worker 被终止后在后台重新备好，下一次运行不用从头等 */
function rewarm() {
  void ensureSession().catch(() => {});
}

/**
 * 预热：提前下载并初始化，返回加载进度 0–1 的回调。
 * 加载失败会 reject（Error.message 是可以直接展示的中文），失败前也会用同一句话回调一次进度。
 */
export async function warmPython(onProgress?: (ratio: number, label: string) => void): Promise<void> {
  if (onProgress) {
    listeners.add(onProgress);
    // 已经在加载或加载完了：先补上当前进度
    if (session && lastProgress.label) onProgress(lastProgress.ratio, lastProgress.label);
  }
  try {
    await ensureSession();
    onProgress?.(1, 'Python 已就绪');
  } catch (error) {
    onProgress?.(lastProgress.ratio, messageOf(error));
    throw error;
  } finally {
    if (onProgress) listeners.delete(onProgress);
  }
}

/* ---------- 运行 ---------- */

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error(CANCELLED_BEFORE_START));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

const notRun = (error: string): PyRunResult => ({
  ok: false,
  stdout: '',
  stderr: '',
  figures: [],
  files: [],
  error,
  durationMs: 0,
});

async function execute(input: PyRunInput): Promise<PyRunResult> {
  const { signal } = input;
  if (signal?.aborted) return notRun(CANCELLED_BEFORE_START);
  let owner: Session;
  try {
    owner = await abortable(ensureSession(), signal);
  } catch (error) {
    return notRun(messageOf(error));
  }
  if (signal?.aborted) return notRun(CANCELLED_BEFORE_START);

  return new Promise<PyRunResult>((resolve) => {
    const id = ++runCount;
    const startedAt = performance.now();
    const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_TIMEOUT_MS;
    let stdout = '';
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (outcome: RunOutcome) => {
      if (activeRun?.id !== id) return;
      activeRun = null;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ ...outcome, stdout, durationMs: Math.round(performance.now() - startedAt) });
    };
    // 超时和取消都只能整个终止 Worker：解释器状态随之丢失，在 stderr 里说明
    const interrupt = (reason: string) => {
      if (activeRun?.id !== id) return;
      retire(owner);
      finish({ ok: false, stderr: `${reason}\n${STATE_LOST}`, figures: [], files: [], error: reason });
      rewarm();
    };
    const onAbort = () => interrupt('运行已取消。');

    activeRun = {
      id,
      session: owner,
      onStarted: () => {
        clearTimeout(timer);
        timer = setTimeout(
          () => interrupt(`运行超过 ${Math.round(timeoutMs / 100) / 10} 秒，已强制停止。`),
          timeoutMs,
        );
      },
      onStdout: (text) => {
        stdout += text;
        try {
          input.onStdout?.(stdout);
        } catch {
          /* 界面回调出错不影响运行 */
        }
      },
      onDone: finish,
      interrupt,
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => interrupt('依赖包迟迟没有装好，已停止等待。'), PREPARE_TIMEOUT_MS);
    const message: ToWorker = { type: 'run', id, code: input.code, files: input.files ?? [] };
    owner.worker.postMessage(message);
  });
}

/**
 * 运行一段 Python。不会 reject：环境不可用、超时、取消、代码报错都体现在返回值里。
 * 同一时间只执行一段，并发调用按先后排队；超时从代码真正开始执行算起，不含首次下载。
 */
export function runPython(input: PyRunInput): Promise<PyRunResult> {
  const task = queue.then(() => execute(input));
  queue = task.catch(() => undefined);
  return task;
}

/** 重置解释器（清掉变量与工作目录）；正在跑的那一次会被中断 */
export async function resetPython(): Promise<void> {
  if (activeRun) activeRun.interrupt('解释器被重置，本次运行已中断。');
  else if (session) retire(session);
  if (await pythonAvailable()) await ensureSession();
}
