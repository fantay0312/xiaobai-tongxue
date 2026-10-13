import { useState, type CSSProperties } from 'react';
import s from './feed.module.css';

const ATLAS_URL = `${import.meta.env.BASE_URL}xiaoyan-prep-coach-atlas.webp`;

/** 小砚头像：取立绘图集里的头部（平时用站姿帧，思考时用托腮帧）；图片不可用时退回单字。 */
export function XiaoyanAvatar({ size = 28, thinking }: { size?: number; thinking?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={s.avatar}
      style={{ '--s': `${size}px` } as CSSProperties}
      data-pose={thinking ? 'thinking' : 'idle'}
      aria-hidden="true"
    >
      {failed
        ? <b>砚</b>
        : <img src={ATLAS_URL} alt="" decoding="async" draggable={false} onError={() => setFailed(true)} />}
    </span>
  );
}
