/** 一级板块：对话、工作台、教小白、AI 课堂、助理任务、记忆、资料库、成长册 */
import { INK, Move, Svg, Wash, keyStroke, type XbIconProps } from './base';

/** 对话 / 问小砚：一方砚台，砚池里有墨，笔正蘸进去 */
export function IconChat(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M6.2 9.6h10.4a2.6 2.6 0 0 1 2.6 2.6v6.4a2.6 2.6 0 0 1-2.6 2.6H6.2a2.6 2.6 0 0 1-2.6-2.6v-6.4a2.6 2.6 0 0 1 2.6-2.6z" />
      {/* 砚身在右上留一个缺口让笔穿过 */}
      <path d="M9.4 9.6H6.2a2.6 2.6 0 0 0-2.6 2.6v6.4a2.6 2.6 0 0 0 2.6 2.6h10.4a2.6 2.6 0 0 0 2.6-2.6v-6.4a2.6 2.6 0 0 0-2.6-2.6h-.5" />
      <ellipse {...INK} cx="9.6" cy="16.6" rx="3.4" ry="1.9" />
      <Move kind="tilt" origin="9px 14.6px">
        <path className={keyStroke} d="M13.1 9.9l7.1-7.1" />
        <path {...INK} d="M11.6 9.8C10 10.7 9.2 12.2 9 14.6c1.8-.4 3.3-1.4 4.2-3.2z" />
      </Move>
    </Svg>
  );
}

/** 工作台：一张翘头案，案上搁着墨和笔筒 */
export function IconWorkbench(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M6.6 13.4h10.8v4.2H6.6z" />
      <path className={keyStroke} d="M2.8 11.8c.9.1 1.5.6 1.8 1.6h14.8c.3-1 .9-1.5 1.8-1.6" />
      <path d="M6.6 13.4v7.8M17.4 13.4v7.8M6.6 17.6h10.8" />
      <path d="M12.8 13.4V8.6h5.2v4.8" />
      <Move kind="tilt" origin="15.4px 8.6px">
        <path d="M14.5 8.6l-.3-2.4M16.7 8.6l.8-3.8" />
        <path {...INK} d="M13.2 6.3c-.3-1.4 0-2.6.9-3.7.9 1.1 1.2 2.3.9 3.7z" />
      </Move>
      <rect {...INK} x="5.8" y="10.6" width="4.4" height="2" rx=".6" />
    </Svg>
  );
}

/** 教小白：小白本人——头顶一个发髻，身上是交领的衣襟 */
export function IconTeach(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M5.6 21.2c.3-2.7 1.9-4.2 4.6-4.6l1.8 2.2 1.8-2.2c2.7.4 4.3 1.9 4.6 4.6z" />
      <Move kind="lift">
        <path d="M10.6 6.5a1.9 1.9 0 1 1 2.8 0" />
        <circle cx="12" cy="10.3" r="4" />
      </Move>
      <path d="M5.6 21.2c.3-2.7 1.9-4.2 4.6-4.6l3.8 4.6" />
      <path d="M18.4 21.2c-.3-2.7-1.9-4.2-4.6-4.6l-1.4 1.8" />
    </Svg>
  );
}

/** AI 课堂：架子上的黑板，板槽里搁着一截粉笔 */
export function IconClassroom(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M6.6 3.8h10.8A2.2 2.2 0 0 1 19.6 6v8.6H4.4V6a2.2 2.2 0 0 1 2.2-2.2z" />
      <path d="M4.4 14.6V6a2.2 2.2 0 0 1 2.2-2.2h10.8A2.2 2.2 0 0 1 19.6 6v8.6" />
      <path className={keyStroke} d="M2.8 14.6h18.4" />
      <path d="M8.2 14.6l-2 6.6M15.8 14.6l2 6.6" />
      <path d="M7.6 9c1.3-1.8 2.5-1.8 3.8 0s2.5 1.8 3.8 0" />
      <Move kind="nudge">
        <rect {...INK} x="14.2" y="12" width="3" height="1.6" rx=".8" />
      </Move>
    </Svg>
  );
}

/** 助理任务：一块交出去的令牌，牌上打了勾，下面坠着穗子 */
export function IconAgent(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M9.2 6.2h5.6L18 9.4v6.4a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 15.8V9.4z" />
      <circle cx="12" cy="4.5" r="1.7" />
      <path d="M9.2 6.2h5.6L18 9.4v6.4a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 15.8V9.4z" />
      <path className={keyStroke} d="M9.2 12.2l2 2.1 3.8-4.3" />
      <Move kind="sway" origin="12px 17.6px">
        <path {...INK} d="M12 18.8c.9.8 1.4 1.7 1.4 2.8h-2.8c0-1.1.5-2 1.4-2.8z" />
      </Move>
    </Svg>
  );
}

/** 记忆：一只匣子，盖沿下挂着半圆的锁牌 */
export function IconMemory(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M7.4 5.6h9.2a2.2 2.2 0 0 1 2.2 2.2v2.4H5.2V7.8a2.2 2.2 0 0 1 2.2-2.2z" />
      <path d="M5.2 10.2V7.8a2.2 2.2 0 0 1 2.2-2.2h9.2a2.2 2.2 0 0 1 2.2 2.2v2.4" />
      <path className={keyStroke} d="M2.8 10.2h18.4" />
      <path d="M4.2 10.2V19a2.2 2.2 0 0 0 2.2 2.2h11.2a2.2 2.2 0 0 0 2.2-2.2v-8.8" />
      <Move kind="lift">
        <path d="M9.2 10.2v1.6a2.8 2.8 0 0 0 5.6 0v-1.6" />
        <circle {...INK} cx="12" cy="12.1" r="1" />
      </Move>
    </Svg>
  );
}

/** 资料库：架上两册书，旁边斜靠着一卷卷轴 */
export function IconLibrary(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M3.8 21.2V6.6A1.2 1.2 0 0 1 5 5.4h1.4a1.2 1.2 0 0 1 1.2 1.2v14.6z" />
      <path className={keyStroke} d="M2.8 21.2h18.4" />
      <path d="M3.8 21.2V6.6A1.2 1.2 0 0 1 5 5.4h1.4a1.2 1.2 0 0 1 1.2 1.2v14.6" />
      <path d="M7.6 9.8a1.2 1.2 0 0 1 1.2-1.2h1.4a1.2 1.2 0 0 1 1.2 1.2v11.4" />
      <path d="M3.8 17.4h7.6" />
      <Move kind="tiltBack" origin="19px 20px">
        <g transform="rotate(-17 17.2 12.9)">
          <rect x="15.2" y="5.6" width="4" height="14.6" rx="2" />
          <path d="M15.2 13.4h4" />
          <circle {...INK} cx="17.2" cy="8" r=".9" />
        </g>
      </Move>
    </Svg>
  );
}

/** 成长册：线装的册子，封面一行题字，旁边钤一方印 */
export function IconGrowth(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M16.4 2.8h1.4A2.2 2.2 0 0 1 20 5v14a2.2 2.2 0 0 1-2.2 2.2h-1.4z" />
      <rect x="4" y="2.8" width="16" height="18.4" rx="2.2" />
      <path d="M16.4 2.8v18.4M16.4 7.4H20M16.4 12H20M16.4 16.6H20" />
      <path d="M12.8 6.6v10.8" />
      <Move kind="lift">
        <rect {...INK} x="6.6" y="11.2" width="4" height="4" rx=".9" transform="rotate(-6 8.6 13.2)" />
      </Move>
    </Svg>
  );
}

/** 科研台：一只圆底烧瓶，瓶里有墨 */
export function IconResearch(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M10.2 9.4L5.3 17.7A2.3 2.3 0 0 0 7.3 21.2h9.4a2.3 2.3 0 0 0 2-3.5L13.8 9.4z" />
      <path className={keyStroke} d="M9.2 2.8h5.6" />
      <path d="M10.2 2.8v6.6L5.3 17.7A2.3 2.3 0 0 0 7.3 21.2h9.4a2.3 2.3 0 0 0 2-3.5L13.8 9.4V2.8" />
      <path {...INK} d="M8.3 15.4h7.4l1.4 2.5a.9.9 0 0 1-.8 1.4H7.7a.9.9 0 0 1-.8-1.4z" />
      <Move kind="lift" origin="12px 12px">
        <circle {...INK} cx="12.9" cy="12.6" r=".8" />
      </Move>
    </Svg>
  );
}
