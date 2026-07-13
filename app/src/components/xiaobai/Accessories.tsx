/**
 * 头顶配饰(全部用 three 基础几何体拼装):
 *   Lv.1 嫩芽(茎+两片叶,黛绿) · Lv.2 悬浮灯泡(藤黄)
 *   Lv.3 圆框眼镜 · Lv.4 眼镜+头顶问号气泡 · Lv.5 学士帽(墨青,藤黄流苏)
 * 配色对应 tokens.css 语义,见 palette.ts 注释。
 */
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  AMBER, AZURE_DEEP, CHALK, DUST, INK, INK_SOFT, JADE, JADE_DEEP,
} from './palette';

/** Lv.1 嫩芽:微曲茎 + 两片对生叶 */
function Sprout() {
  return (
    <group position={[0, 0.59, 0]} rotation={[0, 0, -0.045]} scale={0.9}>
      {/* 头顶芽节把茎叶和头部真正连起来，不再像悬空图标。 */}
      <mesh position={[0, -0.015, 0]} scale={[1, 0.55, 1]}>
        <sphereGeometry args={[0.07, 16, 12]} />
        <meshStandardMaterial color={JADE_DEEP} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.11, 0]} rotation={[0, 0, -0.04]}>
        <cylinderGeometry args={[0.026, 0.034, 0.25, 10]} />
        <meshStandardMaterial color={JADE_DEEP} roughness={0.85} />
      </mesh>
      <mesh position={[-0.095, 0.24, 0]} rotation={[0, 0, 0.72]} scale={[1, 0.32, 0.52]}>
        <sphereGeometry args={[0.14, 20, 14]} />
        <meshStandardMaterial color={JADE} roughness={0.8} />
      </mesh>
      <mesh position={[0.1, 0.25, 0]} rotation={[0, 0, -0.72]} scale={[1, 0.32, 0.52]}>
        <sphereGeometry args={[0.14, 20, 14]} />
        <meshStandardMaterial color={JADE} roughness={0.8} />
      </mesh>
    </group>
  );
}

/** Lv.2 悬浮灯泡:玻璃球 + 灯丝点 + 螺口底座,整体缓慢浮动 */
function Bulb({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    if (reducedMotion) {
      ref.current.position.y = 0.91;
      ref.current.rotation.z = 0;
      return;
    }
    const t = clock.elapsedTime;
    ref.current.position.y = 0.91 + Math.sin(t * 1.4) * 0.025;
    ref.current.rotation.z = Math.sin(t * 0.9) * 0.08;
  });
  return (
    <group ref={ref} position={[0, 0.91, 0]}>
      {/* 玻璃球体(--amber 藤黄,自发光营造点亮感) */}
      <mesh position={[0, 0.06, 0]}>
        <sphereGeometry args={[0.15, 24, 18]} />
        <meshStandardMaterial
          color={AMBER}
          emissive={AMBER}
          emissiveIntensity={0.55}
          roughness={0.35}
          transparent
          opacity={0.92}
        />
      </mesh>
      {/* 灯丝亮点 */}
      <mesh position={[0, 0.05, 0]}>
        <sphereGeometry args={[0.05, 12, 10]} />
        <meshStandardMaterial color={CHALK} emissive={AMBER} emissiveIntensity={1.4} />
      </mesh>
      {/* 螺口底座(--dust 灰) */}
      <mesh position={[0, -0.09, 0]}>
        <cylinderGeometry args={[0.06, 0.05, 0.09, 12]} />
        <meshStandardMaterial color={DUST} roughness={0.6} metalness={0.35} />
      </mesh>
      {/* 暖光晕(仅一盏小点光,黑板场景里更出效果) */}
      <pointLight color={AMBER} intensity={0.9} distance={1.6} decay={2} />
    </group>
  );
}

/** Lv.3/4 圆框眼镜:两只圆环 + 鼻梁,悬于脸面(z=1.1)前,圈住画出来的眼睛 */
function Glasses() {
  return (
    <group position={[0, 0.1, 0.69]}>
      <mesh position={[-0.205, 0, 0]}>
        <torusGeometry args={[0.145, 0.018, 10, 32]} />
        <meshStandardMaterial color={INK} roughness={0.5} />
      </mesh>
      <mesh position={[0.205, 0, 0]}>
        <torusGeometry args={[0.145, 0.018, 10, 32]} />
        <meshStandardMaterial color={INK} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.025, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.014, 0.014, 0.14, 8]} />
        <meshStandardMaterial color={INK} roughness={0.5} />
      </mesh>
    </group>
  );
}

/** Lv.3/4 头顶问号气泡:压扁球气泡 + 几何拼的"?"(圆环缺口+竖杆+圆点),缓慢浮动 */
function QuestionBubble({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    if (reducedMotion) {
      ref.current.position.y = 0.79;
      ref.current.rotation.z = 0;
      return;
    }
    const t = clock.elapsedTime;
    ref.current.position.y = 0.79 + Math.sin(t * 1.2 + 1) * 0.025;
    ref.current.rotation.z = Math.sin(t * 0.8) * 0.06;
  });
  return (
    <group ref={ref} position={[0.55, 0.79, 0.08]} scale={0.78}>
      {/* 气泡本体(--chalk 粉笔白,压扁球) */}
      <mesh scale={[1, 1, 0.45]}>
        <sphereGeometry args={[0.24, 24, 18]} />
        <meshStandardMaterial color={CHALK} roughness={0.9} />
      </mesh>
      {/* 气泡小尾巴 */}
      <mesh position={[-0.16, -0.2, 0]} rotation={[0, 0, 0.6]} scale={[1, 1, 0.45]}>
        <sphereGeometry args={[0.06, 12, 10]} />
        <meshStandardMaterial color={CHALK} roughness={0.9} />
      </mesh>
      {/* "?" 上钩:圆环留缺口(arc),开口朝左下 */}
      <group position={[0, 0.035, 0.12]}>
        <mesh rotation={[0, 0, Math.PI * -0.55]}>
          <torusGeometry args={[0.075, 0.02, 8, 24, Math.PI * 1.5]} />
          <meshStandardMaterial color={INK_SOFT} roughness={0.6} />
        </mesh>
        {/* "?" 竖杆 */}
        <mesh position={[0, -0.1, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.055, 8]} />
          <meshStandardMaterial color={INK_SOFT} roughness={0.6} />
        </mesh>
        {/* "?" 圆点 */}
        <mesh position={[0, -0.175, 0]}>
          <sphereGeometry args={[0.026, 10, 8]} />
          <meshStandardMaterial color={INK_SOFT} roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

/** Lv.5 学士帽:帽箍圆柱 + 方板 + 顶扣 + 垂坠流苏(--azure-deep 墨青 / --amber 藤黄) */
function GraduationCap() {
  return (
    <group position={[0, 0.56, 0]} rotation={[0.06, 0.3, -0.07]} scale={0.82}>
      {/* 帽箍 */}
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.4, 0.46, 0.22, 24]} />
        <meshStandardMaterial color={AZURE_DEEP} roughness={0.75} />
      </mesh>
      {/* 方板 */}
      <mesh position={[0, 0.19, 0]}>
        <boxGeometry args={[1.05, 0.055, 1.05]} />
        <meshStandardMaterial color={AZURE_DEEP} roughness={0.75} />
      </mesh>
      {/* 顶扣 */}
      <mesh position={[0, 0.235, 0]}>
        <sphereGeometry args={[0.035, 12, 10]} />
        <meshStandardMaterial color={AMBER} roughness={0.55} />
      </mesh>
      {/* 流苏:板面横线 + 角上垂线 + 穗头(--amber 藤黄) */}
      <group>
        <mesh position={[0.26, 0.225, 0.26]} rotation={[0, Math.PI / 4, Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.012, 0.74, 6]} />
          <meshStandardMaterial color={AMBER} roughness={0.6} />
        </mesh>
        <mesh position={[0.52, 0.1, 0.52]}>
          <cylinderGeometry args={[0.012, 0.012, 0.24, 6]} />
          <meshStandardMaterial color={AMBER} roughness={0.6} />
        </mesh>
        <mesh position={[0.52, -0.05, 0.52]}>
          <sphereGeometry args={[0.035, 10, 8]} />
          <meshStandardMaterial color={AMBER} roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

export function LevelAccessory({
  level,
  reducedMotion,
}: {
  level: 1 | 2 | 3 | 4 | 5;
  reducedMotion: boolean;
}) {
  if (level === 1) return <Sprout />;
  if (level === 2) return <Bulb reducedMotion={reducedMotion} />;
  if (level === 3) return <Glasses />;
  if (level === 5) return <GraduationCap />;
  return (
    <>
      <Glasses />
      <QuestionBubble reducedMotion={reducedMotion} />
    </>
  );
}
