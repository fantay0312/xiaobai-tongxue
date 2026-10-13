import { useEffect, useState } from 'react';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { isImagePath, normalizePath, readFile, type FileMeta } from '../../../../engine/research';

const IMAGE_LINK = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(\s+"[^"]*")?\s*\)/g;

/** 把相对路径按所在目录解析成课题内路径（支持 ./ 与 ../） */
function resolvePath(target: string, baseDir: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) return null;
  const parts = target.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return normalizePath(parts.join('/'));
}

/**
 * 渲染课题里的 Markdown：正文里用相对路径引用的课题图片（如 figures/a.png）换成实际内容再显示。
 * 找不到的图保持原样，不会显示成别的东西。
 */
export function WorkspaceMarkdown({ owner, projectId, text, files, baseDir = '' }: {
  owner: string | null;
  projectId: string;
  text: string;
  /** 课题文件列表；变化时重新解析图片 */
  files: FileMeta[];
  /** 这段 Markdown 所在的目录，用来解析相对路径 */
  baseDir?: string;
}) {
  const [resolved, setResolved] = useState(text);

  useEffect(() => {
    let alive = true;
    const known = new Set(files.filter((file) => file.encoding === 'dataurl' && isImagePath(file.path)).map((file) => file.path));
    const wanted = new Map<string, string>();
    for (const match of text.matchAll(IMAGE_LINK)) {
      const path = resolvePath(match[2], baseDir);
      const hit = path && known.has(path) ? path : (() => {
        const fromRoot = resolvePath(match[2], '');
        return fromRoot && known.has(fromRoot) ? fromRoot : null;
      })();
      if (hit) wanted.set(match[2], hit);
    }
    if (!wanted.size) {
      setResolved(text);
      return;
    }
    void Promise.all([...wanted].map(async ([target, path]) => [target, (await readFile(owner, projectId, path))?.content] as const)).then((pairs) => {
      if (!alive) return;
      const urls = new Map(pairs.filter((pair): pair is readonly [string, string] => typeof pair[1] === 'string'));
      setResolved(text.replace(IMAGE_LINK, (whole, alt: string, target: string) => (urls.has(target) ? `![${alt}](${urls.get(target)})` : whole)));
    });
    return () => { alive = false; };
  }, [owner, projectId, text, files, baseDir]);

  return <CoachMarkdown text={resolved} />;
}
