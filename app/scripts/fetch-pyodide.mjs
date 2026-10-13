/**
 * 准备浏览器内 Python 运行环境的静态文件 → app/public/pyodide/
 *
 * 科研台的代码在用户浏览器里用 Pyodide 执行。生产站的 CSP 不允许从 CDN 取脚本，
 * 所以核心文件和每一个 wheel 都必须由本站提供。这些二进制不进 git（见 .gitignore），
 * 由本脚本按固定版本重建：
 *   1. 核心文件从 node_modules/pyodide 复制（版本必须与 PYODIDE_VERSION 一致）；
 *   2. 只下载 PACKAGES 及其依赖闭包的 wheel，逐个校验 pyodide-lock.json 里的 sha256；
 *   3. 从站内已有的像素字体裁出一份常用汉字子集，给 matplotlib 画中文用；
 *   4. 写一份只含随站文件的精简 pyodide-lock.json，tool.xiaobai 里记着每个文件的字节数与 sha256；
 *   5. 目录里多余的旧文件会被清掉。
 * 可重复执行：已存在且校验通过的文件直接跳过，不联网。
 *
 * 用法：node scripts/fetch-pyodide.mjs
 * 下载源默认是 Pyodide 官方发布地址，网络不通时可用 PYODIDE_BASE_URL 指向镜像（sha256 照常校验）。
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PYODIDE_VERSION = '314.0.7';
/** 对用户承诺的三方包；改这里要同步改 src/lib/pyRuntime.ts 的 PY_PACKAGES */
const PACKAGES = ['numpy', 'pandas', 'matplotlib', 'scipy'];
const CORE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip'];
const LOCK_FILE = 'pyodide-lock.json';
const FONT_FILE = 'xb-plot-cjk.otf';
const FONT_LICENSE = 'xb-plot-cjk.OFL.txt';
/** 裁字体的做法变了就加一，旧产物会被重做 */
const FONT_RECIPE = 1;

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(appDir, 'node_modules', 'pyodide');
const outDir = path.join(appDir, 'public', 'pyodide');
const toolDir = path.join(appDir, 'node_modules', '.cache', 'xiaobai-pyodide');
const fontSource = path.join(appDir, 'public', 'fonts', 'fusion-pixel-12px-proportional-zh_hans.woff2');
const fontLicense = path.join(appDir, 'public', 'fonts', 'OFL.txt');
const releaseBase = (process.env.PYODIDE_BASE_URL || `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`).replace(/\/?$/, '/');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

/** 常用汉字（GB2312 一二级）加拉丁、希腊、标点和数学符号；在 Pyodide 里用 fontTools 裁 */
const SUBSET_FONT = `
from fontTools import subset
from fontTools.ttLib import TTFont

wanted = set()
for start, stop in ((0x20, 0x7F), (0xA0, 0x180), (0x370, 0x400), (0x2000, 0x2070), (0x2100, 0x2300),
                    (0x2460, 0x2500), (0x25A0, 0x2600), (0x3000, 0x3040), (0xFF00, 0xFFF0)):
    wanted.update(range(start, stop))
for high in range(0xB0, 0xF8):
    for low in range(0xA1, 0xFF):
        try:
            wanted.add(ord(bytes([high, low]).decode('gb2312')))
        except UnicodeDecodeError:
            pass

options = subset.Options()
options.layout_features = []
options.name_IDs = [1, 2, 3, 4, 6]
options.notdef_outline = True
options.glyph_names = False
options.hinting = False
font = TTFont('/tmp/source.woff2', recalcTimestamp=False)
subsetter = subset.Subsetter(options)
subsetter.populate(unicodes=wanted)
subsetter.subset(font)
font.flavor = None
font.save('/tmp/subset.otf')
`;

async function readIfExists(file) {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

/** 先写临时文件再改名，中断时不会留下半截文件 */
async function writeAtomic(file, buffer) {
  const temp = `${file}.part`;
  await writeFile(temp, buffer);
  await rename(temp, file);
}

async function download(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw new Error(`下载失败 ${url}：${lastError?.message ?? lastError}`);
}

/** 目标位置已有且 sha256 对得上就直接用，否则下载并校验 */
async function ensureWheel(entry, dir) {
  const target = path.join(dir, entry.file_name);
  const existing = await readIfExists(target);
  if (existing && sha256(existing) === entry.sha256) return { buffer: existing, fresh: false };
  const buffer = await download(releaseBase + entry.file_name);
  const actual = sha256(buffer);
  if (actual !== entry.sha256) {
    throw new Error(`${entry.file_name} 校验失败：期望 ${entry.sha256}，实际 ${actual}`);
  }
  await writeAtomic(target, buffer);
  return { buffer, fresh: true };
}

function dependencyClosure(lock, roots) {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    const entry = lock.packages[name];
    if (!entry) throw new Error(`pyodide-lock.json 里没有 ${name}`);
    seen.add(name);
    entry.depends.forEach(visit);
  };
  roots.forEach(visit);
  return [...seen].sort();
}

/**
 * 用 Node 里的 Pyodide + fontTools 把站内的 woff2 像素字体裁成 OTF 子集。
 * matplotlib 自带的 FreeType 读不了 woff2，所以要在构建时转好。brotli 只在这里用，不随站发布。
 */
async function buildFontSubset(lock, source) {
  await mkdir(toolDir, { recursive: true });
  for (const name of [...CORE_FILES, LOCK_FILE]) {
    await copyFile(path.join(sourceDir, name), path.join(toolDir, name));
  }
  for (const name of ['fonttools', 'brotli']) {
    const local = await readIfExists(path.join(outDir, lock.packages[name].file_name));
    if (local) await writeFile(path.join(toolDir, lock.packages[name].file_name), local);
    await ensureWheel(lock.packages[name], toolDir);
  }
  const { loadPyodide } = await import(pathToFileURL(path.join(toolDir, 'pyodide.mjs')).href);
  const pyodide = await loadPyodide({
    indexURL: `${toolDir}/`,
    packages: ['fonttools', 'brotli'],
    stdout: () => {},
    stderr: () => {},
  });
  pyodide.FS.writeFile('/tmp/source.woff2', source);
  pyodide.runPython(SUBSET_FONT);
  return Buffer.from(pyodide.FS.readFile('/tmp/subset.otf'));
}

async function ensureFont(lock, previous) {
  const source = await readIfExists(fontSource);
  if (!source) return null;
  const origin = { sha256: sha256(source), recipe: FONT_RECIPE };
  const target = path.join(outDir, FONT_FILE);
  const existing = await readIfExists(target);
  const recorded = previous?.fontOrigin;
  if (
    existing &&
    recorded?.sha256 === origin.sha256 &&
    recorded?.recipe === origin.recipe &&
    previous?.files?.[FONT_FILE]?.sha256 === sha256(existing)
  ) {
    return { buffer: existing, origin, fresh: false };
  }
  const buffer = await buildFontSubset(lock, source);
  await writeAtomic(target, buffer);
  return { buffer, origin, fresh: true };
}

async function main() {
  const installed = JSON.parse(await readFile(path.join(sourceDir, 'package.json'), 'utf8')).version;
  if (installed !== PYODIDE_VERSION) {
    throw new Error(`node_modules/pyodide 是 ${installed}，脚本固定的是 ${PYODIDE_VERSION}。先对齐版本再运行。`);
  }
  const lock = JSON.parse(await readFile(path.join(sourceDir, LOCK_FILE), 'utf8'));
  const shipped = dependencyClosure(lock, PACKAGES);
  await mkdir(outDir, { recursive: true });

  const lockTarget = path.join(outDir, LOCK_FILE);
  let previous = null;
  try {
    previous = JSON.parse(await readFile(lockTarget, 'utf8')).tool?.xiaobai ?? null;
  } catch {
    /* 第一次运行或文件损坏：按没有处理 */
  }

  const files = {};
  const report = [];
  const record = (status, name, buffer) => {
    files[name] = { size: buffer.length, sha256: sha256(buffer) };
    report.push([status, name, buffer.length]);
  };

  for (const name of CORE_FILES) {
    const source = await readFile(path.join(sourceDir, name));
    const target = path.join(outDir, name);
    const existing = await readIfExists(target);
    const same = existing && sha256(existing) === sha256(source);
    if (!same) await writeAtomic(target, source);
    record(same ? '已就绪' : '已复制', name, source);
  }

  for (const name of shipped) {
    const { buffer, fresh } = await ensureWheel(lock.packages[name], outDir);
    record(fresh ? '已下载' : '已就绪', lock.packages[name].file_name, buffer);
  }

  let font = null;
  try {
    font = await ensureFont(lock, previous);
  } catch (error) {
    console.warn(`! 中文字体没有生成，图里的中文会显示成方框：${error.message}`);
  }
  if (font) {
    record(font.fresh ? '已生成' : '已就绪', FONT_FILE, font.buffer);
    await copyFile(fontLicense, path.join(outDir, FONT_LICENSE));
  }

  const trimmed = {
    info: lock.info,
    packages: Object.fromEntries(shipped.map((name) => [name, lock.packages[name]])),
    tool: {
      ...lock.tool,
      xiaobai: {
        pyodide: PYODIDE_VERSION,
        packages: PACKAGES,
        files,
        ...(font ? { font: FONT_FILE, fontOrigin: font.origin } : {}),
      },
    },
  };
  const lockText = `${JSON.stringify(trimmed)}\n`;
  if ((await readIfExists(lockTarget))?.toString('utf8') !== lockText) {
    await writeAtomic(lockTarget, lockText);
  }

  const keep = new Set([LOCK_FILE, ...Object.keys(files), ...(font ? [FONT_LICENSE] : [])]);
  for (const entry of await readdir(outDir)) {
    if (keep.has(entry)) continue;
    await rm(path.join(outDir, entry), { recursive: true, force: true });
    report.push(['已清理', entry, 0]);
  }

  let total = 0;
  for (const entry of keep) total += (await stat(path.join(outDir, entry))).size;
  for (const [status, name, bytes] of report) {
    console.log(`${status}  ${name}${bytes ? `  ${megabytes(bytes)}` : ''}`);
  }
  console.log(`\nPyodide ${PYODIDE_VERSION}（Python ${lock.info.python}）→ ${path.relative(appDir, outDir)}`);
  console.log(`随站包：${PACKAGES.join('、')}；连依赖共 ${shipped.length} 个 wheel，目录合计 ${megabytes(total)}`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
