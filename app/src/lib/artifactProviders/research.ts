/**
 * 科研台的文件登记到成果登记处：报告、笔记、综述、文献库、分析脚本会和上传的资料并排出现在资料库里，
 * 也能被附到对话里。只登记适合阅读的文本文件；数据表和图片不登记。
 */
import { registerArtifactProvider, type Artifact } from '../artifacts';
import { baseName, extensionOf, formatBytes, readFile } from '../../engine/research/workspace';
import { researchStore, subscribeResearchFiles } from '../../store/researchStore';

const READABLE = new Set(['md', 'markdown', 'txt', 'tex', 'bib', 'py', 'r']);
const FENCE: Record<string, string> = { py: 'python', r: 'r', bib: 'bibtex', tex: 'latex' };
const SEPARATOR = '::';

registerArtifactProvider('research', {
  list(owner) {
    const data = researchStore.get(owner);
    return data.projects.flatMap((project) => (data.files[project.id] ?? [])
      .filter((file) => file.encoding === 'utf8' && READABLE.has(extensionOf(file.path)) && file.size > 0)
      .map((file): Artifact => {
        const id = `${project.id}${SEPARATOR}${file.path}`;
        const last = file.provenance[file.provenance.length - 1];
        const open = { view: 'research', params: { project: project.id, file: file.path } };
        return {
          key: `research-file:${id}`,
          kind: 'research-file',
          id,
          title: file.path,
          summary: `${project.title} · ${formatBytes(file.size)}`,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          madeBy: last?.actor === 'user' ? 'user' : 'ai',
          origin: { section: 'research', label: `科研台：${project.title}`, open },
          open,
        };
      }));
  },
  async content(owner, id) {
    const at = id.indexOf(SEPARATOR);
    if (at < 0) return null;
    const projectId = id.slice(0, at);
    const path = id.slice(at + SEPARATOR.length);
    const file = await readFile(owner, projectId, path);
    if (!file || file.meta.encoding !== 'utf8') return null;
    const project = researchStore.getProject(owner, projectId);
    const fence = FENCE[extensionOf(path)];
    return {
      title: `${project?.title ?? '科研课题'} / ${path}`,
      text: fence ? `\`\`\`${fence}\n${file.content}\n\`\`\`` : file.content,
      filename: baseName(path),
      mime: file.meta.mime,
    };
  },
  subscribe: subscribeResearchFiles,
});
