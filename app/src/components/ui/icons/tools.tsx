/** 工作台工具：笔记、导图、测验、闪卡、待办、写作 */
import { INK, Move, Svg, Wash, keyStroke, type XbIconProps } from './base';

/** 笔记：一张竖排的笺纸，左下折了一角 */
export function IconNote(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M7 2.8h10A2.2 2.2 0 0 1 19.2 5v14a2.2 2.2 0 0 1-2.2 2.2H9.8l-5-5V5A2.2 2.2 0 0 1 7 2.8z" />
      <path d="M7 2.8h10A2.2 2.2 0 0 1 19.2 5v14a2.2 2.2 0 0 1-2.2 2.2H9.8l-5-5V5A2.2 2.2 0 0 1 7 2.8z" />
      <Move kind="nudge">
        <path d="M4.8 16.2H8A1.8 1.8 0 0 1 9.8 18v3.2" />
      </Move>
      <path d="M15.6 6.8v9.6M12.2 6.8v9.6M8.8 6.8v4.6" />
    </Svg>
  );
}

/** 导图：一个主干，分出三根枝，枝头各结一粒芽 */
export function IconMindmap(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M5.2 9.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z" />
      <circle cx="5.2" cy="12" r="2.4" />
      <path d="M7.6 12c3 0 2.8-6.4 6.2-6.4h5" />
      <path d="M7.6 12h8.8" />
      <path d="M7.6 12c3 0 2.8 6.4 6.2 6.4h3.2" />
      <Move kind="nudge">
        <circle {...INK} cx="19.9" cy="5.6" r="1.3" />
        <circle {...INK} cx="17.5" cy="12" r="1.3" />
        <circle {...INK} cx="18.1" cy="18.4" r="1.3" />
      </Move>
    </Svg>
  );
}

/** 测验：答卷，和一道红笔的大勾 */
export function IconQuiz(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M5.8 2.8h9.4A2.2 2.2 0 0 1 17.4 5v14a2.2 2.2 0 0 1-2.2 2.2H5.8A2.2 2.2 0 0 1 3.6 19V5a2.2 2.2 0 0 1 2.2-2.2z" />
      {/* 右边留一个缺口让大勾甩出去 */}
      <path d="M17.4 9.7V5a2.2 2.2 0 0 0-2.2-2.2H5.8A2.2 2.2 0 0 0 3.6 5v14a2.2 2.2 0 0 0 2.2 2.2h9.4a2.2 2.2 0 0 0 2.2-2.2v-3.6" />
      <path d="M7 7.4h7M7 10.8h4.2" />
      <Move kind="nudge">
        <path className={keyStroke} d="M9.6 14.6l3 3.2 8.6-9.4" />
      </Move>
    </Svg>
  );
}

/** 闪卡：两张叠着的卡片，后面那张正翻出来 */
export function IconFlashcard(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M5 8.6h10a2.2 2.2 0 0 1 2.2 2.2V19a2.2 2.2 0 0 1-2.2 2.2H5A2.2 2.2 0 0 1 2.8 19v-8.2A2.2 2.2 0 0 1 5 8.6z" />
      <Move kind="tiltBack" origin="10px 21px">
        <path d="M5.4 7.5v-.3a2 2 0 0 1 2-2h10.4a2 2 0 0 1 2 2v8.6a2 2 0 0 1-2 2h-1.4" transform="rotate(-8 12.6 11.5)" />
      </Move>
      <rect x="2.8" y="8.6" width="14.4" height="12.6" rx="2.2" />
      <path d="M6.6 13.4h6.8M6.6 16.8h3.6" />
    </Svg>
  );
}

/** 待办：今日课业，头一条已经勾掉 */
export function IconTodo(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M5.4 2.8a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z" />
      <Move kind="nudge">
        <path className={keyStroke} d="M3 6.4l2 2.1 3.8-4.5" />
      </Move>
      <path d="M12 6.2h9.2M12 12.4h9.2M12 18.6h5.6" />
      <circle cx="5.4" cy="12.4" r="2.2" />
      <circle cx="5.4" cy="18.6" r="2.2" />
    </Svg>
  );
}

/** 写作：钢笔尖落在一行稿纸格上 */
export function IconWriting(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M7.8 14.2 9.6 7.6l3.6-1.6 2.8 2.8-1.6 3.6z" />
      <rect x="2.8" y="16.2" width="18.4" height="5" rx="1.6" />
      <path d="M8.9 16.2v5M15.1 16.2v5" />
      <Move kind="tilt" origin="7.8px 14.2px">
        <path d="M7.8 14.2 9.6 7.6l3.6-1.6 1.6-1.6 2.8 2.8-1.6 1.6-1.6 3.6z" />
        <path d="M13.2 6l2.8 2.8M7.8 14.2l3.4-3.4" />
        <circle {...INK} cx="11.9" cy="10.1" r=".9" />
      </Move>
    </Svg>
  );
}
