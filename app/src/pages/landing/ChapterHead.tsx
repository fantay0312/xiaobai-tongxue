import type { ReactNode } from 'react';
import s from './landing.module.css';

/** 章节题头：序号 + 墨块单字 + 一道细线 + 章名，下接大标题与一段导语。 */
export function ChapterHead({ no, glyph, name, titleId, title, lead }: {
  no: string;
  glyph: string;
  name: string;
  titleId: string;
  title: ReactNode;
  lead: ReactNode;
}) {
  return (
    <header data-reveal>
      <div className={s.chapterMark}>
        <span className={s.chapterNo}>{no}</span>
        <span className={s.chapterGlyph} aria-hidden="true">{glyph}</span>
        <span className={s.chapterRule} aria-hidden="true" />
        <span>{name}</span>
      </div>
      <h2 id={titleId} className={s.chapterTitle}>
        {/* 按逗号分成不可拆的短句：折行只落在句读上，不把一个字孤零零甩到行尾 */}
        {typeof title === 'string'
          ? title.split('，').map((clause, index, all) => (
            <span key={clause} className={s.chapterClause}>
              {index < all.length - 1 ? `${clause}，` : clause}
            </span>
          ))
          : title}
      </h2>
      <p className={s.chapterLead}>{lead}</p>
    </header>
  );
}
