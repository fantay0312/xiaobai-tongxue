/** 课内学习方式与旅程：带我学、读讲义、师徒旅程 */
import { INK, Move, Svg, Wash, keyStroke, type XbIconProps } from './base';

/** 带我学：小砚提着的一盏灯笼 */
export function IconGuide(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M8.6 5.6h6.8c1.8 1.6 2.8 3.5 2.8 5.6s-1 4-2.8 5.6H8.6C6.8 15.2 5.8 13.3 5.8 11.2s1-4 2.8-5.6z" />
      <path d="M9.4 5.6c0-1.8 1.1-2.8 2.6-2.8s2.6 1 2.6 2.8" />
      <path className={keyStroke} d="M8 5.6h8M8 16.8h8" />
      <path d="M8.6 5.6c-1.8 1.6-2.8 3.5-2.8 5.6s1 4 2.8 5.6M15.4 5.6c1.8 1.6 2.8 3.5 2.8 5.6s-1 4-2.8 5.6" />
      <path {...INK} d="M12 8.2c1.2 1.4 1.8 2.5 1.8 3.5a1.8 1.8 0 0 1-3.6 0c0-1 .6-2.1 1.8-3.5z" />
      <Move kind="sway" origin="12px 16.8px">
        <path {...INK} d="M12 18.4c.9.8 1.3 1.7 1.3 2.8h-2.6c0-1.1.4-2 1.3-2.8z" />
      </Move>
    </Svg>
  );
}

/** 读讲义：一幅展开的卷轴，上下是轴，卷末钤一方小印 */
export function IconRead(props: XbIconProps) {
  return (
    <Svg {...props}>
      <Wash d="M6 5.8h12v12.4H6z" />
      <rect {...INK} x="3.4" y="3.4" width="17.2" height="2.4" rx="1.2" />
      <rect {...INK} x="3.4" y="18.2" width="17.2" height="2.4" rx="1.2" />
      <path d="M6 5.8v12.4M18 5.8v12.4" />
      <path d="M15 8.4v7.2M11.8 8.4v4.6" />
      <rect {...INK} x="7.6" y="13.4" width="2.2" height="2.2" rx=".5" />
    </Svg>
  );
}

/** 师徒旅程：从一点墨出发，一条弯路通到旗下 */
export function IconJourney(props: XbIconProps) {
  return (
    <Svg {...props}>
      <circle {...INK} cx="4.6" cy="19" r="1.6" />
      <path d="M6.8 19c5 0 8.2-1 8.2-3.6 0-2.4-5.8-1.6-5.8-4.4 0-1.6 2.4-2 8-1.8" />
      <Move kind="nudge">
        <path className={keyStroke} d="M17.2 9.2V3" />
        <path {...INK} d="M17.2 2.8l4 1.8-4 1.8z" />
      </Move>
    </Svg>
  );
}
