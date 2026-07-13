/**
 * 3D 画布本体 —— 唯一静态引入 three/R3F 的入口,由 XiaobaiAvatar 懒加载。
 * default export 是 React.lazy 的要求;three 由此从主包拆成异步 chunk。
 * onReady 在首帧场景实际进入渲染循环后回调，占位形象此时才撤走。
 */
import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { XiaobaiMood } from '../../types';
import { XiaobaiScene, XIAOBAI_CAMERA } from './XiaobaiScene';

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

function CanvasLifecycle({
  onReady,
  onContextLost,
}: {
  onReady?: () => void;
  onContextLost?: () => void;
}) {
  const gl = useThree((state) => state.gl);
  const readySent = useRef(false);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (event: Event) => {
      event.preventDefault();
      onContextLost?.();
    };
    canvas.addEventListener('webglcontextlost', handleLost);
    return () => canvas.removeEventListener('webglcontextlost', handleLost);
  }, [gl, onContextLost]);

  useFrame(() => {
    if (readySent.current) return;
    readySent.current = true;
    onReady?.();
  });

  return null;
}

export default function SceneCanvas({
  mood,
  level,
  speaking,
  variant,
  onReady,
  onContextLost,
}: {
  mood: XiaobaiMood;
  level: 1 | 2 | 3 | 4 | 5;
  speaking: boolean;
  variant: 'paper' | 'board';
  onReady?: () => void;
  onContextLost?: () => void;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={reducedMotion ? 'demand' : 'always'}
      camera={XIAOBAI_CAMERA}
      gl={{ alpha: true, antialias: true }}
      style={{ background: 'transparent' }}
    >
      <CanvasLifecycle onReady={onReady} onContextLost={onContextLost} />
      <XiaobaiScene
        mood={mood}
        level={level}
        speaking={speaking}
        variant={variant}
        reducedMotion={reducedMotion}
      />
    </Canvas>
  );
}
