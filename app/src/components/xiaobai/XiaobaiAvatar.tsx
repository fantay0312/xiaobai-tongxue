/**
 * 小白 3D 形象 —— Props 契约 FROZEN(three.js/R3F 实现)
 * mood 驱动表情与形变;level 驱动头顶配饰(1嫩芽 2灯泡 3-4眼镜 5学士帽);
 * speaking 时轻微弹跳;variant 适配纸面/黑板两种场景光照。
 * WebGL 不可用或渲染出错时自动降级为 CSS 团子(FallbackBlob)。
 */
import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import type { XiaobaiMood } from '../../types';
import { FallbackBlob } from './FallbackBlob';
import { XiaobaiScene, XIAOBAI_CAMERA } from './XiaobaiScene';
import { AvatarErrorBoundary, detectWebGL } from './webglGuard';

export interface XiaobaiAvatarProps {
  mood: XiaobaiMood;
  level: 1 | 2 | 3 | 4 | 5;
  speaking?: boolean;
  /** 画布边长 px,默认 240 */
  size?: number;
  /** 场景:paper 宣纸页面 / board 黑板讲解舱 */
  variant?: 'paper' | 'board';
}

export function XiaobaiAvatar({
  mood,
  level,
  speaking = false,
  size = 240,
  variant = 'paper',
}: XiaobaiAvatarProps) {
  const webglOK = useMemo(detectWebGL, []);

  if (!webglOK) return <FallbackBlob mood={mood} size={size} variant={variant} />;

  return (
    <div style={{ width: size, height: size }} aria-label={`小白(${mood})`} role="img">
      <AvatarErrorBoundary fallback={<FallbackBlob mood={mood} size={size} variant={variant} />}>
        <Canvas
          dpr={[1, 2]}
          camera={XIAOBAI_CAMERA}
          gl={{ alpha: true, antialias: true }}
          style={{ background: 'transparent' }}
        >
          <XiaobaiScene mood={mood} level={level} speaking={speaking} variant={variant} />
        </Canvas>
      </AvatarErrorBoundary>
    </div>
  );
}

export { XiaobaiStage } from './XiaobaiStage';
export type { XiaobaiStageProps } from './XiaobaiStage';
