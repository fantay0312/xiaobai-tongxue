import JSZip, { type JSZipObject, type JSZipStreamHelper } from 'jszip';
import { htmlToBlocks } from './html-to-blocks';
import { type Article, type Block } from './article';

const MAX_ARCHIVE = 50 * 1024 * 1024;
const MAX_EXPANDED = 80 * 1024 * 1024;
const MAX_ENTRY = 8 * 1024 * 1024;
const MAX_TEXT = 2_000_000;

/** Validate the ZIP directory before decompression, including encrypted/ZIP64 archives. */
function validateArchive(bytes: ArrayBuffer) {
  const data = new DataView(bytes);
  let end = bytes.byteLength - 22;
  for (; end >= Math.max(0, bytes.byteLength - 65_557); end--) {
    if (data.getUint32(end, true) === 0x06054b50 && end + 22 + data.getUint16(end + 20, true) === bytes.byteLength) break;
  }
  if (end < 0 || end < bytes.byteLength - 65_557) throw new Error('这不是完整的 EPUB 文件，请重新导出后再试。');
  const count = data.getUint16(end + 10, true);
  const size = data.getUint32(end + 12, true);
  let cursor = data.getUint32(end + 16, true);
  if (data.getUint16(end + 4, true) || data.getUint16(end + 6, true) || count === 0xffff || count > 5000 || cursor + size > end) {
    throw new Error('这本 EPUB 的压缩格式暂不支持，请导出普通 EPUB 后再试。');
  }
  let expanded = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || data.getUint32(cursor, true) !== 0x02014b50) throw new Error('EPUB 目录已损坏，请重新导出。');
    if (data.getUint16(cursor + 8, true) & 1) throw new Error('暂不支持加密 EPUB，请导入无加密版本。');
    const unpacked = data.getUint32(cursor + 24, true);
    if (unpacked === 0xffffffff || (expanded += unpacked) > MAX_EXPANDED) throw new Error('EPUB 解压后过大，请拆分为较小的书籍。');
    cursor += 46 + data.getUint16(cursor + 28, true) + data.getUint16(cursor + 30, true) + data.getUint16(cursor + 32, true);
    if (cursor > end) throw new Error('EPUB 目录已损坏，请重新导出。');
  }
}

/** Bound actual decompression too: a malicious directory can lie about its sizes. */
function readText(entry: JSZipObject | null): Promise<string> {
  if (!entry) return Promise.reject(new Error('EPUB 缺少章节或目录文件，请重新导出。'));
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    // JSZip documents this API; its bundled declarations omit it on individual entries.
    const stream = (entry as JSZipObject & { internalStream(type: 'uint8array'): JSZipStreamHelper<Uint8Array> }).internalStream('uint8array');
    stream.on('data', (chunk: Uint8Array) => {
      size += chunk.byteLength;
      if (size > MAX_ENTRY) {
        stream.pause();
        reject(new Error('EPUB 单个章节过大，请拆分后再导入。'));
      } else chunks.push(chunk);
    }).on('error', reject).on('end', () => {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      resolve(new TextDecoder().decode(bytes));
    }).resume();
  });
}

function parseXml(text: string): Document {
  // XML remains inert: no external entities, scripts, styles, or remote resources are mounted.
  if (/<!ENTITY/i.test(text)) throw new Error('EPUB 含有不支持的外部实体，请重新导出。');
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('EPUB 目录或章节格式有误，请重新导出。');
  return xml;
}

function elements(root: Document, name: string): Element[] {
  return Array.from(root.querySelectorAll('*')).filter((el) => el.localName.split(':').at(-1) === name);
}

function pathAt(base: string, href: string): string {
  if (!href || /^[a-z][\w+.-]*:|^\/|\\/i.test(href)) throw new Error('EPUB 章节路径无效。');
  const path = decodeURIComponent(href.split('#')[0].split('?')[0]);
  const parts = base.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') { if (!parts.length) throw new Error('EPUB 章节路径无效。'); parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

export async function epubToArticle(file: File, progress?: (p: number, label?: string) => void): Promise<Article> {
  if (file.size > MAX_ARCHIVE) throw new Error('EPUB 文件不能超过 50 MB，请拆分后再导入。');
  const bytes = await file.arrayBuffer();
  validateArchive(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const container = parseXml(await readText(zip.file('META-INF/container.xml')));
  const packagePath = elements(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!packagePath) throw new Error('EPUB 缺少书籍目录，请重新导出。');
  const pkg = parseXml(await readText(zip.file(pathAt('', packagePath))));
  const manifest = new Map(elements(pkg, 'item').map((item) => [item.getAttribute('id'), item]));
  const spine = elements(pkg, 'itemref').filter((item) => item.getAttribute('linear') !== 'no');
  if (!spine.length) throw new Error('EPUB 没有可阅读的章节。');
  // Font obfuscation is allowed; encrypted reading content cannot be imported.
  if (zip.file('META-INF/encryption.xml')) {
    const encryption = parseXml(await readText(zip.file('META-INF/encryption.xml')));
    if (elements(encryption, 'EncryptionMethod').some((method) => ![
      'http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC',
    ].includes(method.getAttribute('Algorithm') ?? ''))) throw new Error('暂不支持加密 EPUB，请导入无加密版本。');
  }
  const blocks: Block[] = [];
  let textSize = 0;
  for (let i = 0; i < spine.length; i++) {
    const item = manifest.get(spine[i].getAttribute('idref'));
    const href = item?.getAttribute('href');
    if (!href || !['application/xhtml+xml', 'text/html'].includes(item?.getAttribute('media-type') ?? '')) throw new Error('EPUB 包含不支持或缺失的章节。');
    progress?.(Math.round((i / spine.length) * 100), `正在读取第 ${i + 1} / ${spine.length} 章`);
    const chapter = parseXml(await readText(zip.file(pathAt(packagePath, href))));
    for (const el of Array.from(chapter.querySelectorAll('script,style,iframe,object,embed,img,picture,svg,video,audio,link'))) el.remove();
    const body = elements(chapter, 'body')[0];
    if (!body) throw new Error('EPUB 章节缺少正文。');
    textSize += body.textContent?.length ?? 0;
    if (textSize > MAX_TEXT) throw new Error('这本书的正文超过 200 万字，请按卷拆分后导入。');
    for (const block of htmlToBlocks(body)) {
      // Internal EPUB links have no matching web route; retain their text without a broken link.
      block.runs = block.runs.map((run) => run.href && !/^https?:\/\//i.test(run.href) ? { ...run, href: undefined } : run);
      blocks.push({ ...block, id: `b${blocks.length + 1}` });
    }
  }
  if (!blocks.length) throw new Error('这本 EPUB 没有可提取的文字；图片书请使用 PDF。');
  progress?.(100, '书籍已读取');
  return {
    id: crypto.randomUUID(), origin: 'file', source: file.name, addedAt: Date.now(), blocks,
    title: elements(pkg, 'title')[0]?.textContent?.trim() || file.name.replace(/\.epub$/i, ''),
    author: elements(pkg, 'creator').map((el) => el.textContent?.trim()).filter(Boolean).join('、') || undefined,
  };
}
