/**
 * 宣传页的章节登记表：顶栏、手机菜单、产品全景、页脚都从这里取章节 id 与名字。
 * 各章的 <section id> 必须与这里一致。
 */
export interface LandingSection {
  id: string;
  /** 顶栏与菜单里的名字 */
  label: string;
  /** 章节序号与墨块单字；全景与常见问题没有 */
  no?: string;
  glyph?: string;
  /** 桌面顶栏放不下全部章节，只放标了 nav 的几项；手机菜单列出全部 */
  nav?: boolean;
}

export const SECTIONS: readonly LandingSection[] = [
  { id: 'overview', label: '产品全景', nav: true },
  { id: 'learn', label: '学习终端', no: '01', glyph: '学', nav: true },
  { id: 'teach', label: '教小白', no: '02', glyph: '教', nav: true },
  { id: 'practice', label: '工作台', no: '03', glyph: '练', nav: true },
  { id: 'delegate', label: '助理与 AI 课堂', no: '04', glyph: '托' },
  { id: 'research', label: '科研台', no: '05', glyph: '研', nav: true },
  { id: 'memory', label: '记忆库', no: '06', glyph: '记', nav: true },
  { id: 'anywhere', label: '手机与个性化', no: '07', glyph: '随' },
  { id: 'faq', label: '常见问题' },
];

export function sectionById(id: string): LandingSection {
  const found = SECTIONS.find((item) => item.id === id);
  if (!found) throw new Error(`unknown landing section: ${id}`);
  return found;
}

/** 滚动到某一章。HashRouter 下不能用真锚点（会被当成路由），所以手动滚。 */
export function scrollToSection(id: string, smooth: boolean) {
  document.getElementById(id)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}
