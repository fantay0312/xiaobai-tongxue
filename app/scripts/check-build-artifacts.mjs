/**
 * 发布产物体检 —— 构建链的最后一环,失败即中断发布。
 *
 * 由来:2026-07-30 一次 Finder「保留两者」式的目录合并,在 node_modules 里留下了
 * 五千多个 `xxx 2.js` / `xxx 2.woff2` 陈旧副本。Vite 会把它们当独立资源一并打进
 * dist,于是 148 个无引用垃圾文件跟着上了生产,还把 `find | xargs sha256sum`
 * 的发布校验步骤(文件名带空格)整个搞挂。
 *
 * 根因已由 npm ci 重装解决,这里是防复发的闸:宁可让构建当场失败并指向真正的
 * 病灶,也不要让人在 rsync 前"记得手动清一下"。
 *
 * 用法:node check-build-artifacts.mjs <distDir> [--label 名称]
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/* macOS 副本命名:基名 + 空格 + 纯数字 + 扩展名。Vite 产物名一律 `名-哈希.扩展`,
   不含空格,所以这个形状不会误伤正常资源。 */
const DUPLICATE_NAME = /\s\d+(\.[^.]+)?$/;

function walk(dir, hits = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return hits;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, hits);
    else if (DUPLICATE_NAME.test(entry.name)) hits.push(full);
  }
  return hits;
}

const [distDir = 'dist'] = process.argv.slice(2);
const labelFlag = process.argv.indexOf('--label');
const label = labelFlag > -1 ? process.argv[labelFlag + 1] : distDir;

if (!statSync(distDir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`产物体检:找不到目录 ${distDir}`);
  process.exit(1);
}

const duplicates = walk(distDir);
if (duplicates.length === 0) {
  process.exit(0);
}

const shown = duplicates.slice(0, 8);
console.error(`
✗ 产物体检未通过:${label} 里有 ${duplicates.length} 个 macOS 重复副本

${shown.map((f) => `    ${f}`).join('\n')}${duplicates.length > shown.length ? `\n    …另有 ${duplicates.length - shown.length} 个` : ''}

这些是无引用的垃圾文件,发到生产只会白占体积,并让发布脚本里按空白分词的
命令(如 find | xargs sha256sum)出错。

病灶几乎一定在 node_modules,先确认再重装:
    find node_modules -name '* [0-9].*' | wc -l
    rm -rf node_modules && npm ci

修完重新构建即可。不要只删 dist 里的副本 —— 下次构建它们还会回来。
`);
process.exit(1);
