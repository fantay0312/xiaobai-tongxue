/**
 * 3D 画布本体 —— 唯一静态引入 three/R3F 的入口,由 XiaobaiAvatar 懒加载。
 * default export 是 React.lazy 的要求;three 由此从主包拆成异步 chunk。
 * onReady 在 WebGL 上下文就绪时回调,占位团子由父组件届时才撤走。
 */
import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
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

export default function SceneCanvas({
  mood,
  level,
  speaking,
  variant,
  onReady,
}: {
  mood: XiaobaiMood;
  level: 1 | 2 | 3 | 4 | 5;
  speaking: boolean;
  variant: 'paper' | 'board';
  onReady?: () => void;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={reducedMotion ? 'demand' : 'always'}
      camera={XIAOBAI_CAMERA}
      gl={{ alpha: true, antialias: true }}
      style={{ background: 'transparent' }}
      onCreated={() => onReady?.()}
    >
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
