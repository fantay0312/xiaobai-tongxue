/**
 * Python 运行环境的 Worker 端：加载 Pyodide、装包、执行代码。
 *
 * 所有文件都从本站的 pyodide/ 目录取，不碰任何 CDN：
 * - fetch 被换成只放行该目录的版本，顺带把下载进度报给主线程，并把文件存进 Cache Storage
 *   （按 Pyodide 版本分库、按 sha256 校验），下次打开不用再下载；
 * - Python 代码拿到的也是这个 fetch，所以它连不上网，也调不到本站的接口。
 * 超时与取消由主线程直接终止整个 Worker，这里不用处理。
 */
import type { PyodideAPI } from 'pyodide';
import { PY_HARNESS } from './py/harness';
import type { FromWorker, InitMessage, PyManifest, RunMessage, RunOutcome, ToWorker } from './py/protocol';
import type { PyFile } from './pyRuntime';

interface WorkerScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
  fetch: typeof fetch;
  caches?: CacheStorage;
}

interface LockPackage {
  file_name: string;
  depends: string[];
  imports: string[];
}

/** 运行器命名空间（Python dict）里用到的几个入口 */
interface HarnessNamespace {
  get(name: 'configure'): (settings: string) => void;
  get(name: 'setup_matplotlib'): () => void;
  get(name: 'run'): PythonRunner;
}

type PythonRunner = (code: string, out: (text: string) => void, err: (text: string) => void) => Promise<string>;

interface HarnessOutcome {
  ok: boolean;
  result: string | null;
  error: string | null;
  figures: string[];
  files: PyFile[];
  notes: string[];
}

const WORK = '/work';
const FONT_DIR = '/usr/share/fonts';
const CACHE_PREFIX = 'xiaobai-pyodide-';
/** 进度条里下载占的份额，其余留给启动和导入 */
const DOWNLOAD_SHARE = 0.72;
const MAX_STDOUT = 200_000;
const MAX_STDERR = 20_000;
const CONTENT_TYPES: Record<string, string> = { wasm: 'application/wasm', json: 'application/json', mjs: 'text/javascript' };

const scope = self as unknown as WorkerScope;
const post = (message: FromWorker) => scope.postMessage(message);
const nativeFetch = scope.fetch.bind(scope);

let base = '';
let manifest: PyManifest | null = null;
let store: Cache | null = null;
let pyodide: PyodideAPI | null = null;
let runner: PythonRunner | null = null;
/** 正在执行的那次运行的输出口；C 层直接写出的内容也送到这里 */
let sinks: { out: (text: string) => void; err: (text: string) => void } | null = null;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const megabytes = (bytes: number) => Math.round(bytes / 1048576);

/* ---------- 下载进度 ---------- */

const tracker = {
  wanted: new Set<string>(),
  loaded: new Map<string, number>(),
  total: 0,
  network: false,
  lastPost: 0,
};

function trackDownloads(names: Iterable<string>) {
  tracker.wanted = new Set(names);
  tracker.loaded.clear();
  tracker.total = 0;
  for (const name of tracker.wanted) tracker.total += manifest?.files[name]?.size ?? 0;
}

function track(name: string, bytes: number, fromNetwork: boolean) {
  if (!tracker.wanted.has(name) || !tracker.total) return;
  tracker.loaded.set(name, bytes);
  tracker.network ||= fromNetwork;
  let done = 0;
  for (const value of tracker.loaded.values()) done += value;
  const finished = done >= tracker.total;
  const now = performance.now();
  if (!finished && now - tracker.lastPost < 120) return;
  tracker.lastPost = now;
  post({
    type: 'progress',
    ratio: DOWNLOAD_SHARE * Math.min(1, done / tracker.total),
    label: finished
      ? '正在安装依赖包…'
      : `${tracker.network ? '下载运行环境' : '读取本地缓存'} ${megabytes(done)}/${megabytes(tracker.total)} MB`,
  });
}

/* ---------- 只放行本站运行环境目录的 fetch ---------- */

async function openStore(version: string): Promise<Cache | null> {
  const storage = scope.caches;
  if (!storage) return null;
  try {
    const current = CACHE_PREFIX + version;
    for (const key of await storage.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== current) await storage.delete(key);
    }
    return await storage.open(current);
  } catch {
    return null;
  }
}

async function digestMatches(name: string, bytes: ArrayBuffer): Promise<boolean> {
  const expected = manifest?.files[name]?.sha256;
  if (!expected || !globalThis.crypto?.subtle) return true;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of hash) hex += byte.toString(16).padStart(2, '0');
  return hex === expected;
}

async function download(name: string, url: string, size: number): Promise<ArrayBuffer> {
  const response = await nativeFetch(url, { credentials: 'same-origin' });
  if (!response.ok || !response.body) throw new Error(`${name} 下载失败（HTTP ${response.status}）`);
  const reader = response.body.getReader();
  const bytes = new Uint8Array(size);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > size) {
      await reader.cancel().catch(() => {});
      received = -1;
      break;
    }
    bytes.set(value, received);
    received += value.length;
    track(name, received, true);
  }
  // 站点把缺失的文件回落成首页时，大小一定对不上
  if (received !== size) throw new Error(`${name} 不完整，请检查网络后重试`);
  return bytes.buffer;
}

const typedResponse = (name: string, bytes: ArrayBuffer) =>
  new Response(bytes, {
    headers: { 'Content-Type': CONTENT_TYPES[name.slice(name.lastIndexOf('.') + 1)] ?? 'application/octet-stream' },
  });

async function obtain(name: string, url: string, size: number): Promise<ArrayBuffer> {
  if (store) {
    try {
      const cached = await store.match(url);
      if (cached) {
        const bytes = await cached.arrayBuffer();
        if (bytes.byteLength === size && (await digestMatches(name, bytes))) {
          track(name, size, false);
          return bytes;
        }
        await store.delete(url);
      }
    } catch {
      /* 缓存读不了就当没有 */
    }
  }
  const bytes = await download(name, url, size);
  if (!(await digestMatches(name, bytes))) throw new Error(`${name} 校验没有通过，请刷新页面后重试`);
  // 存不进去（配额不足、无痕模式）不影响这一次使用
  store?.put(url, typedResponse(name, bytes)).catch(() => {});
  return bytes;
}

async function guardedFetch(input: RequestInfo | URL): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, base || undefined).href;
  if (!base || !url.startsWith(base)) throw new TypeError('Python 运行环境不能访问网络');
  const name = decodeURIComponent(url.slice(base.length).split(/[?#]/)[0]);
  const entry = manifest?.files[name];
  if (!entry) return nativeFetch(url, { credentials: 'same-origin' });
  return typedResponse(name, await obtain(name, url, entry.size));
}

/**
 * Pyodide 起来之后就用不到这些了；拿掉后 Python 代码没法绕过 fetch 联网，也不能另起一个不受限的 Worker。
 * 这是减少误用的护栏，不是严格的沙箱：真正兜底的是站点 CSP。
 */
function closeNetwork() {
  for (const name of ['XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'Worker', 'SharedWorker']) {
    try {
      Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
    } catch {
      /* 个别浏览器不让改就算了 */
    }
  }
}

/* ---------- 初始化 ---------- */

function dependencyClosure(packages: Record<string, LockPackage>, roots: string[]): string[] {
  const seen = new Set<string>();
  const visit = (name: string) => {
    const entry = packages[name];
    if (!entry || seen.has(name)) return;
    seen.add(name);
    entry.depends.forEach(visit);
  };
  roots.forEach(visit);
  return [...seen];
}

async function init(message: InitMessage) {
  base = message.base;
  manifest = message.manifest;
  store = await openStore(manifest.pyodide);
  scope.fetch = guardedFetch as typeof fetch;

  const packages = (JSON.parse(message.lock) as { packages: Record<string, LockPackage> }).packages;
  const wanted = ['pyodide.asm.wasm', 'python_stdlib.zip'];
  for (const name of dependencyClosure(packages, message.preload)) wanted.push(packages[name].file_name);
  if (manifest.font) wanted.push(manifest.font);
  trackDownloads(wanted);
  post({ type: 'progress', ratio: 0, label: '准备 Python 运行环境…' });

  let loader: typeof import('pyodide');
  try {
    loader = (await import(/* @vite-ignore */ `${base}pyodide.mjs`)) as typeof import('pyodide');
  } catch {
    throw new Error('核心脚本没有取到，请检查网络后重试');
  }
  // 字体和核心文件一起下，装不上也不拦着 Python 启动
  const fontName = manifest.font;
  const fontBytes = fontName
    ? guardedFetch(base + fontName).then((response) => response.arrayBuffer()).catch(() => null)
    : Promise.resolve(null);

  const api = await loader.loadPyodide({
    indexURL: base,
    lockFileContents: message.lock,
    packageBaseUrl: base,
    packages: message.preload,
    env: { MPLBACKEND: 'Agg' },
    stdout: (line) => sinks?.out(`${line}\n`),
    stderr: (line) => sinks?.err(`${line}\n`),
  });
  pyodide = api;
  post({ type: 'progress', ratio: DOWNLOAD_SHARE + 0.04, label: '启动 Python…' });

  let fontPath = '';
  const font = await fontBytes;
  if (font && fontName) {
    fontPath = `${FONT_DIR}/${fontName}`;
    api.FS.mkdirTree(FONT_DIR);
    api.FS.writeFile(fontPath, new Uint8Array(font));
  }

  const namespace = (api.globals.get('dict') as () => HarnessNamespace)();
  api.runPython(PY_HARNESS, { globals: namespace as never });
  namespace.get('configure')(
    JSON.stringify({
      packages: manifest.packages,
      imports: Object.values(packages).flatMap((entry) => entry.imports),
      font: fontPath || null,
    }),
  );
  runner = namespace.get('run');

  // 提前导入，第一次运行就不用再等
  message.preload.forEach((name, index) => {
    post({
      type: 'progress',
      ratio: DOWNLOAD_SHARE + 0.06 + (0.2 * index) / message.preload.length,
      label: `初始化 ${name}…`,
    });
    if (name === 'matplotlib') namespace.get('setup_matplotlib')();
    else api.runPython(`import ${name}`);
  });

  closeNetwork();
  trackDownloads([]);
  post({ type: 'ready' });
}

/* ---------- 执行 ---------- */

function safePath(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.includes('..')) return null;
  return parts.join('/');
}

function decodeBase64(content: string): Uint8Array {
  const binary = atob(content.replace(/^data:[^,]*,/, '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function writeFiles(api: PyodideAPI, files: PyFile[], notes: string[]) {
  for (const file of files) {
    const relative = safePath(file.path);
    if (!relative) {
      notes.push(`文件路径不合法，已跳过：${file.path}`);
      continue;
    }
    const target = `${WORK}/${relative}`;
    try {
      api.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
      api.FS.writeFile(target, file.encoding === 'base64' ? decodeBase64(file.content) : file.content);
    } catch (error) {
      notes.push(`文件 ${relative} 没有写进工作目录：${messageOf(error)}`);
    }
  }
}

async function run(message: RunMessage) {
  const { id, code } = message;
  const notes: string[] = [];
  let stderr = '';
  let pending = '';
  let written = 0;
  let pendingSince = 0;
  let lastPost = 0;
  let truncated = false;

  const flush = () => {
    if (!pending) return;
    post({ type: 'stdout', id, text: pending });
    pending = '';
    lastPost = performance.now();
  };
  // Python 执行期间 Worker 的事件循环是堵住的，定时器不会触发，所以在写入时顺手发出：
  // 整行攒够 60 毫秒发一次；没换行的半行（进度点之类）最多攒 300 毫秒
  const out = (text: string) => {
    if (truncated) return;
    if (written + text.length > MAX_STDOUT) {
      text = `${text.slice(0, MAX_STDOUT - written)}\n…（输出太长，后面的已省略）\n`;
      truncated = true;
    }
    const now = performance.now();
    if (!pending) pendingSince = now;
    written += text.length;
    pending += text;
    if ((pending.endsWith('\n') && now - lastPost > 60) || now - pendingSince > 300) flush();
  };
  const err = (text: string) => {
    if (stderr.length < MAX_STDERR) stderr += text;
  };

  let outcome: RunOutcome;
  try {
    if (!pyodide || !runner) throw new Error('Python 还没有准备好');
    writeFiles(pyodide, message.files, notes);
    try {
      await pyodide.loadPackagesFromImports(code, {
        messageCallback: () => {},
        errorCallback: (text) => notes.push(text),
      });
    } catch (error) {
      throw new Error(`依赖包没有装上：${messageOf(error)}`);
    }
    post({ type: 'started', id });
    sinks = { out, err };
    const result = JSON.parse(await runner(code, out, err)) as HarnessOutcome;
    notes.push(...result.notes);
    outcome = {
      ok: result.ok,
      stderr: '',
      result: result.result ?? undefined,
      figures: result.figures,
      files: result.files,
      error: result.error ?? undefined,
    };
  } catch (error) {
    outcome = { ok: false, stderr: '', figures: [], files: [], error: `运行环境出错：${messageOf(error)}` };
  }
  sinks = null;
  flush();
  outcome.stderr = [stderr.trimEnd(), ...notes].filter(Boolean).join('\n');
  post({ type: 'done', id, outcome });
}

/* ---------- 消息入口：一次只处理一件事 ---------- */

let chain: Promise<void> = Promise.resolve();

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    chain = chain.then(() => init(message)).catch((error) => post({ type: 'fail', message: messageOf(error) }));
  } else if (message.type === 'run') {
    chain = chain.then(() => run(message));
  }
};
