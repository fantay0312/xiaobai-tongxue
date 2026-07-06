/**
 * 3D 画布本体 —— 唯一静态引入 three/R3F 的入口,由 XiaobaiAvatar 懒加载。
 * default export 是 React.lazy 的要求;three 由此从主包拆成异步 chunk。
 * onReady 在 WebGL 上下文就绪时回调,占位团子由父组件届时才撤走。
 */
import { Canvas } from '@react-three/fiber';
import type { XiaobaiMood } from '../../types';
import { XiaobaiScene, XIAOBAI_CAMERA } from './XiaobaiScene';

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
  return (
    <Canvas
      dpr={[1, 2]}
      camera={XIAOBAI_CAMERA}
      gl={{ alpha: true, antialias: true }}
      style={{ background: 'transparent' }}
      onCreated={() => onReady?.()}
    >
      <XiaobaiScene mood={mood} level={level} speaking={speaking} variant={variant} />
    </Canvas>
  );
}
