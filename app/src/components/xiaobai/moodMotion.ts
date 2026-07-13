/**
 * mood → 小书生的姿态/律动参数表。
 * 表情负责情绪可读性，头、书和袖的小动作只做辅助，不再把整个角色当宠物式软球拉伸。
 */
import type { XiaobaiMood } from '../../types';

export interface MoodMotion {
  /** 均匀呼吸缩放幅度 */
  breathAmp: number;
  /** 呼吸速度 rad/s */
  breathSpeed: number;
  /** 常驻整体缩放偏移(shy 缩小为负,proud 挺起为正) */
  puff: number;
  /** 自主小弹跳幅度(happy 轻快弹) */
  bobAmp: number;
  /** 自主小弹跳速度 */
  bobSpeed: number;
  /** mood 进入瞬间的鼓起脉冲(aha 瞬间鼓起) */
  enterPulse: number;
  /** 头部左右轻偏 */
  headTilt: number;
  /** 抱书高度相对偏移 */
  bookLift: number;
  /** 袖子向外展开的角度 */
  armSpread: number;
  /** confused 专用的轻微摇头幅度 */
  shake: number;
}

export const MOOD_MOTION: Record<XiaobaiMood, MoodMotion> = {
  idle: { breathAmp: 0.006, breathSpeed: 1.35, puff: 0, bobAmp: 0, bobSpeed: 0, enterPulse: 0, headTilt: 0, bookLift: 0, armSpread: 0, shake: 0 },
  curious: { breathAmp: 0.007, breathSpeed: 1.7, puff: 0.006, bobAmp: 0.006, bobSpeed: 1.9, enterPulse: 0.015, headTilt: -0.045, bookLift: 0, armSpread: 0.015, shake: 0 },
  confused: { breathAmp: 0.005, breathSpeed: 1.9, puff: -0.006, bobAmp: 0, bobSpeed: 0, enterPulse: 0, headTilt: 0.045, bookLift: 0.025, armSpread: -0.02, shake: 0.007 },
  thinking: { breathAmp: 0.004, breathSpeed: 0.9, puff: 0, bobAmp: 0, bobSpeed: 0, enterPulse: 0, headTilt: 0.035, bookLift: 0.035, armSpread: -0.015, shake: 0 },
  aha: { breathAmp: 0.008, breathSpeed: 1.9, puff: 0.012, bobAmp: 0.01, bobSpeed: 2.4, enterPulse: 0.055, headTilt: -0.025, bookLift: -0.04, armSpread: 0.11, shake: 0 },
  happy: { breathAmp: 0.008, breathSpeed: 2, puff: 0.008, bobAmp: 0.014, bobSpeed: 2.6, enterPulse: 0.025, headTilt: -0.02, bookLift: -0.025, armSpread: 0.075, shake: 0 },
  proud: { breathAmp: 0.005, breathSpeed: 1.2, puff: 0.012, bobAmp: 0, bobSpeed: 0, enterPulse: 0.02, headTilt: 0.018, bookLift: -0.015, armSpread: 0.025, shake: 0 },
  shy: { breathAmp: 0.004, breathSpeed: 1.5, puff: -0.025, bobAmp: 0, bobSpeed: 0, enterPulse: 0, headTilt: -0.04, bookLift: 0.105, armSpread: -0.045, shake: 0 },
};
