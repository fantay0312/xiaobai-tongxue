/** 费曼四站（备课、上课、赴考、批注复盘），以及思考与模型两枚小图标 */
import { INK, Move, Svg, Wash, keyStroke, type XbIconProps } from './base';

/** 备课：灯下温书。选中时灯光照到书页上 */
export function IconPrep(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M6.4 9.4h11.2l3.2 5.3c-3.2-.8-6.3-.6-8.8.9-2.5-1.5-5.6-1.7-8.8-.9z" />
      <path d="M12 2.8v1.8M9.8 4.6h4.4l3.4 4.8H6.4z" />
      <path d="M10.2 9.4a1.8 1.8 0 0 0 3.6 0" />
      <path d="M12 15.6v5.6M12 15.6c-2.6-1.6-5.8-1.8-9.2-.8v5.6c3.4-1 6.6-.8 9.2.8M12 15.6c2.6-1.6 5.8-1.8 9.2-.8v5.6c-3.4-1-6.6-.8-9.2.8" />
    </Svg>
  );
}

/** 上课：黑板前站着听讲的小白 */
export function IconLesson(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M5 2.8h10.4A2.2 2.2 0 0 1 17.6 5v8.6H5a2.2 2.2 0 0 1-2.2-2.2V5A2.2 2.2 0 0 1 5 2.8z" />
      {/* 黑板右下角被人挡住，所以两条边都不画到头 */}
      <path d="M11.8 13.6H5a2.2 2.2 0 0 1-2.2-2.2V5A2.2 2.2 0 0 1 5 2.8h10.4A2.2 2.2 0 0 1 17.6 5v2.2" />
      <path d="M6.4 6.6h6.2M6.4 9.8h3" />
      <Move kind="lift">
        <circle cx="16.4" cy="12.2" r="2.6" />
      </Move>
      <path d="M11.6 21.2c.3-2.8 2-4.3 4.8-4.3s4.5 1.5 4.8 4.3" />
    </Svg>
  );
}

/** 赴考：带密封线的考卷，和一支蘸了墨的笔 */
export function IconExam(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M5.8 2.8h9.4A2.2 2.2 0 0 1 17.4 5v14a2.2 2.2 0 0 1-2.2 2.2H5.8A2.2 2.2 0 0 1 3.6 19V5a2.2 2.2 0 0 1 2.2-2.2z" />
      <path d="M17.4 11V5a2.2 2.2 0 0 0-2.2-2.2H5.8A2.2 2.2 0 0 0 3.6 5v14a2.2 2.2 0 0 0 2.2 2.2h9.4a2.2 2.2 0 0 0 2.2-2.2v-2.6" />
      <path d="M7.4 3.6v16.8" strokeDasharray="1.2 2.6" />
      <path d="M10.6 7.2h3.8M10.6 10.6h2.2" />
      <Move kind="tilt" origin="11.6px 19.4px">
        <path className={keyStroke} d="M15.6 15.4l5-5" />
        <path {...INK} d="M14.15 15.15C12.5 16 11.9 17.5 11.6 19.4c1.9-.3 3.4-.9 4.25-2.55z" />
      </Move>
    </Svg>
  );
}

/** 批注复盘：先生的红笔——一个勾、一个圈、一道波浪线 */
export function IconReview(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M17.4 4.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z" />
      <Move kind="nudge">
        <path className={keyStroke} d="M3.2 8.6l2.8 3 6-7.4" />
      </Move>
      <circle cx="17.4" cy="8" r="3.4" />
      <path d="M2.8 18c1.5-1.8 3.1-1.8 4.6 0s3.1 1.8 4.6 0 3.1-1.8 4.6 0 3.1 1.8 4.6 0" />
    </Svg>
  );
}

/** 思考 / 生成：一滴墨落下去，水面漾开一圈 */
export function IconSpark(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M12 13.6c4.7 0 8.6 1.6 8.6 3.6s-3.9 3.6-8.6 3.6-8.6-1.6-8.6-3.6 3.9-3.6 8.6-3.6z" />
      <Move kind="lift">
        <path {...INK} d="M12 2.4c1.9 2.4 3 4.2 3 5.8a3 3 0 0 1-6 0c0-1.6 1.1-3.4 3-5.8z" />
      </Move>
      <ellipse cx="12" cy="17.2" rx="8.6" ry="3.6" />
    </Svg>
  );
}

/** 模型：一盏油灯，灯芯上的火苗 */
export function IconModel(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M12.4 2.8c.4 2.6 3.4 4.4 3.4 7.6a3.8 3.8 0 0 1-7.6 0c0-1.5.6-2.7 1.6-3.7.2 1.1.7 1.7 1.4 2-.5-2.2-.1-4.2 1.2-5.9z" />
      <Move kind="lift">
        <path d="M12.4 2.8c.4 2.6 3.4 4.4 3.4 7.6a3.8 3.8 0 0 1-7.6 0c0-1.5.6-2.7 1.6-3.7.2 1.1.7 1.7 1.4 2-.5-2.2-.1-4.2 1.2-5.9z" />
      </Move>
      <path d="M12 14.2v2.4" />
      <path className={keyStroke} d="M4.8 16.6h14.4c0 2.6-3.2 4.6-7.2 4.6s-7.2-2-7.2-4.6z" />
    </Svg>
  );
}
