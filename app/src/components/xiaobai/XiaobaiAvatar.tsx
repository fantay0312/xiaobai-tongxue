/**
 * 小白 3D 纸塑小书生 —— Props 契约 FROZEN(three.js/R3F 实现)
 * mood 驱动表情与形变;level 驱动头顶配饰(1嫩芽 2灯泡 3-4眼镜 5学士帽);
 * speaking 时轻微弹跳;variant 适配纸面/黑板两种场景光照。
 * WebGL 不可用或渲染出错时自动降级为同轮廓的 CSS 小书生(FallbackBlob);
 * three chunk 懒加载，降级形象一直垫底到 WebGL 首帧就绪才撤，首屏无空框无闪空。
 */
import { Suspense, lazy, useMemo, useState } from 'react';
import type { XiaobaiMood } from '../../types';
import { FallbackBlob } from './FallbackBlob';
import { AvatarErrorBoundary, detectWebGL } from './webglGuard';
import { getXiaobaiLabel } from './xiaobaiLabel';

const SceneCanvas = lazy(() => import('./SceneCanvas'));

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
  const [ready, setReady] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const fallback = <FallbackBlob mood={mood} level={level} variant={variant} />;
  const showCanvas = webglOK && !contextLost;

  return (
    <div
      style={{ position: 'relative', width: size, height: size, containerType: 'inline-size' }}
      aria-label={getXiaobaiLabel(mood, level)}
      role="img"
    >
      {(!showCanvas || !ready) && (
        <div style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
          {fallback}
        </div>
      )}
      {showCanvas && (
        <AvatarErrorBoundary
          fallback={<div style={{ position: 'absolute', inset: 0 }} aria-hidden="true">{fallback}</div>}
        >
          <Suspense fallback={null}>
            <SceneCanvas
              mood={mood}
              level={level}
              speaking={speaking}
              variant={variant}
              onReady={() => setReady(true)}
              onContextLost={() => {
                setReady(false);
                setContextLost(true);
              }}
            />
          </Suspense>
        </AvatarErrorBoundary>
      )}
    </div>
  );
}
