/**
 * 小白的日记 —— 课后叙事装置(doc §1),渲染 deriveDiary 的产物,自己不做任何派生。
 * 铁纪律(doc §1.1 样例 B):正文零报错样式——没有红字、没有警示图标、
 * 记岔的那段与其他段落零样式差异;天气是唯一不动声色的信号。
 */
import type { DiaryPage } from '../../engine/story';
import s from './diary.module.css';

export function XiaobaiDiary({ page }: { page: DiaryPage }) {
  return (
    <article className={s.leaf} aria-label="小白的日记">
      <p className={s.dateLine}>{page.dateLabel}　{page.weather}</p>
      {page.paragraphs.map((text, i) => (
        // 段落由模板确定性生成,顺序即身份,index 作 key 安全
        <p key={i} className={s.para}>{text}</p>
      ))}
    </article>
  );
}
