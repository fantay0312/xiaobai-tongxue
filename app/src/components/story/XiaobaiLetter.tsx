/**
 * 小白的来信 —— 战术性遗忘的渲染层(doc §8),成长册卷三里一封一封摆。
 * 信纸只是壳:正文素材全部来自 deriveXiaobaiLetter 的真实派生
 * (还记得的最低层级已命中要点 + 精确模糊的最高层级已命中要点 + 最新金句原文),
 * 组件自己不发明任何知识内容;复习入口由父级注入 onReply(原 goReview 契约,含防抖)。
 */
import type { XiaobaiLetterData } from '../../engine/story';
import s from './letter.module.css';

interface Props {
  topicTitle: string;
  data: XiaobaiLetterData;
  busy: boolean;
  onReply: () => void;
}

export function XiaobaiLetter({ topicTitle, data, busy, onReply }: Props) {
  // 记忆段:先交代温书缘起,再摆"还记得的"(证明不是全忘了),金句按原文引用不改写
  const memoryParts = [`前日所学「${topicTitle}」,弟子近来自己温书。`];
  if (data.remembered) memoryParts.push(data.remembered);
  if (data.analogy) memoryParts.push(`先生当时打的那个比方——『${data.analogy}』——弟子倒还记得。`);

  return (
    <article className={s.letter} aria-label={`小白关于「${topicTitle}」的来信`}>
      <p className={s.salute}>先生钧鉴:</p>
      <p className={s.text}>{memoryParts.join('')}</p>
      {/* 情感核:不是干瘪的「该复习了」,而是一处具体的、正在变模糊的点 */}
      <p className={`${s.text} ${s.fuzzy}`}>{data.fuzzy}</p>
      <p className={s.text}>先生得空时,能再与弟子讲讲么?</p>
      <div className={s.foot}>
        <span className={s.signature}>弟子 小白 顿首</span>
        <span className={s.sealMark} aria-hidden="true">白</span>
      </div>
      <div className={s.actions}>
        <button type="button" className={s.replyBtn} disabled={busy} onClick={onReply}>
          回信,与它讲讲
        </button>
      </div>
    </article>
  );
}
