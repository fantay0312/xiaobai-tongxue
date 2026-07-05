/**
 * XiaobaiStage —— 讲解舱直接嵌入的小白舞台:
 * 团子 + 黑板场景光影(暖顶光 + 青色 rim + 接触阴影) + 星尘粒子背景。
 * 铺满父容器;WebGL 不可用或渲染出错时降级为 CSS 团子。
 */
import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import type { XiaobaiMood } from '../../types';
import { FallbackBlob } from './FallbackBlob';
import { XiaobaiScene, XIAOBAI_CAMERA } from './XiaobaiScene';
import { AvatarErrorBoundary, detectWebGL } from './webglGuard';
import styles from './XiaobaiStage.module.css';

export interface XiaobaiStageProps {
  mood: XiaobaiMood;
  level: 1 | 2 | 3 | 4 | 5;
  speaking?: boolean;
  className?: string;
  /** 星尘粒子背景,默认开启 */
  stardust?: boolean;
}

export function XiaobaiStage({
  mood,
  level,
  speaking = false,
  className,
  stardust = true,
}: XiaobaiStageProps) {
  const webglOK = useMemo(detectWebGL, []);
  const cls = className ? `${styles.stage} ${className}` : styles.stage;

  const fallback = (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <FallbackBlob mood={mood} size={200} variant="board" />
    </div>
  );

  return (
    <div className={cls} aria-label={`小白(${mood})`} role="img">
      {webglOK ? (
        <AvatarErrorBoundary fallback={fallback}>
          <Canvas
            dpr={[1, 2]}
            camera={XIAOBAI_CAMERA}
            gl={{ alpha: true, antialias: true }}
            style={{ background: 'transparent' }}
          >
            <XiaobaiScene
              mood={mood}
              level={level}
              speaking={speaking}
              variant="board"
              stardust={stardust}
            />
          </Canvas>
        </AvatarErrorBoundary>
      ) : (
        fallback
      )}
    </div>
  );
}
