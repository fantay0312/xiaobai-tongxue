/**
 * mood → 团子形变/律动参数表。
 * 语义与占位实现的表情注释一致:confused 抖动、thinking 缓慢、aha 瞬间鼓起、
 * happy 轻快弹、shy 缩小;所有过渡在 useFrame 内用阻尼插值,柔和 ease-out 质感。
 */
import type { XiaobaiMood } from '../../types';

export interface MoodMotion {
  /** simplex 噪声顶点位移幅度(呼吸形变的"软度") */
  amp: number;
  /** 噪声时间频率(形变流动快慢) */
  freq: number;
  /** 高频抖动幅度(confused 专用的瑟瑟发抖) */
  jitter: number;
  /** 呼吸挤压幅度(横向鼓/纵向压) */
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
}

export const MOOD_MOTION: Record<XiaobaiMood, MoodMotion> = {
  idle: { amp: 0.045, freq: 0.35, jitter: 0, breathAmp: 0.016, breathSpeed: 1.6, puff: 0, bobAmp: 0, bobSpeed: 0, enterPulse: 0 },
  curious: { amp: 0.052, freq: 0.6, jitter: 0, breathAmp: 0.02, breathSpeed: 2.1, puff: 0.012, bobAmp: 0.012, bobSpeed: 2.2, enterPulse: 0.03 },
  confused: { amp: 0.05, freq: 0.55, jitter: 0.02, breathAmp: 0.014, breathSpeed: 2.5, puff: -0.01, bobAmp: 0, bobSpeed: 0, enterPulse: 0 },
  thinking: { amp: 0.03, freq: 0.16, jitter: 0, breathAmp: 0.012, breathSpeed: 1.0, puff: 0, bobAmp: 0, bobSpeed: 0, enterPulse: 0 },
  aha: { amp: 0.06, freq: 0.85, jitter: 0, breathAmp: 0.022, breathSpeed: 2.3, puff: 0.045, bobAmp: 0.018, bobSpeed: 2.8, enterPulse: 0.14 },
  happy: { amp: 0.055, freq: 0.75, jitter: 0, breathAmp: 0.026, breathSpeed: 2.6, puff: 0.022, bobAmp: 0.035, bobSpeed: 3.2, enterPulse: 0.06 },
  proud: { amp: 0.04, freq: 0.3, jitter: 0, breathAmp: 0.02, breathSpeed: 1.4, puff: 0.04, bobAmp: 0, bobSpeed: 0, enterPulse: 0.05 },
  shy: { amp: 0.028, freq: 0.45, jitter: 0.008, breathAmp: 0.01, breathSpeed: 2.0, puff: -0.09, bobAmp: 0, bobSpeed: 0, enterPulse: 0 },
};
