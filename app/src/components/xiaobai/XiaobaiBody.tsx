/**
 * 小白的纸塑小书生本体。
 * 头、衣袍、袖、手、书和鞋的轮廓分层建模，避免再把四肢贴在一颗大球上。
 */
import { useRef } from 'react';
import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { XiaobaiMood } from '../../types';
import { LevelAccessory } from './Accessories';
import { MOOD_MOTION } from './moodMotion';

export interface XiaobaiMaterials {
  porcelain: THREE.MeshStandardMaterial;
  robe: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  book: THREE.MeshStandardMaterial;
}

interface XiaobaiBodyProps {
  mood: XiaobaiMood;
  level: 1 | 2 | 3 | 4 | 5;
  speaking: boolean;
  reducedMotion: boolean;
  faceMaterial: THREE.MeshBasicMaterial;
  materials: XiaobaiMaterials;
}

const SIDES = [-1, 1] as const;
const ROBE_PROFILE = [
  new THREE.Vector2(0, -0.56),
  new THREE.Vector2(0.59, -0.55),
  new THREE.Vector2(0.66, -0.47),
  new THREE.Vector2(0.59, -0.12),
  new THREE.Vector2(0.49, 0.25),
  new THREE.Vector2(0.34, 0.48),
  new THREE.Vector2(0, 0.5),
];

const damp = THREE.MathUtils.damp;

function setArmRotation(
  ref: React.RefObject<THREE.Group | null>,
  target: number,
  dt: number,
  immediate: boolean,
) {
  if (!ref.current) return;
  ref.current.rotation.z = immediate ? target : damp(ref.current.rotation.z, target, 8, dt);
}

export function XiaobaiBody({
  mood,
  level,
  speaking,
  reducedMotion,
  faceMaterial,
  materials,
}: XiaobaiBodyProps) {
  const headRef = useRef<THREE.Group>(null);
  const bookRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);

  useFrame(({ clock }, dt) => {
    const motion = MOOD_MOTION[mood];
    const t = reducedMotion ? 0 : clock.elapsedTime;
    const immediate = reducedMotion;
    const nod = speaking && !reducedMotion ? Math.sin(t * 4.2) * 0.018 : 0;

    if (headRef.current) {
      const targetTilt = motion.headTilt + nod;
      headRef.current.rotation.z = immediate
        ? targetTilt
        : damp(headRef.current.rotation.z, targetTilt, 7, dt);
    }

    if (bookRef.current) {
      const targetY = -0.59 + motion.bookLift;
      bookRef.current.position.y = immediate
        ? targetY
        : damp(bookRef.current.position.y, targetY, 9, dt);
    }

    const baseAngle = 0.46 - motion.armSpread;
    setArmRotation(leftArmRef, baseAngle, dt, immediate);
    setArmRotation(
      rightArmRef,
      -(baseAngle - (speaking && !reducedMotion ? 0.13 : 0)),
      dt,
      immediate,
    );
  });

  return (
    <>
      <group ref={headRef} position={[0, 0.38, 0.01]}>
        <mesh material={materials.porcelain} scale={[1.02, 0.86, 0.92]}>
          <sphereGeometry args={[0.67, 32, 24]} />
        </mesh>
        <mesh position={[0, 0.005, 0.63]} material={faceMaterial} renderOrder={3}>
          <planeGeometry args={[1, 0.92]} />
        </mesh>
        <LevelAccessory level={level} reducedMotion={reducedMotion} />
      </group>

      <mesh position={[0, -0.57, -0.03]} scale={[1, 1.12, 0.76]} material={materials.robe}>
        <latheGeometry args={[ROBE_PROFILE, 32]} />
      </mesh>

      {SIDES.map((side) => (
        <group
          key={`arm-${side}`}
          ref={side === -1 ? leftArmRef : rightArmRef}
          position={[side * 0.38, -0.34, 0.14]}
          rotation={[0, 0, side * -0.46]}
        >
          <mesh position={[0, -0.15, 0]} scale={[0.82, 1, 0.76]} material={materials.robe}>
            <capsuleGeometry args={[0.115, 0.27, 6, 20]} />
          </mesh>
          <mesh position={[0, -0.315, 0.12]} scale={[0.82, 1, 0.76]} material={materials.trim}>
            <cylinderGeometry args={[0.122, 0.122, 0.035, 20]} />
          </mesh>
          <mesh position={[0, -0.345, 0.52]} scale={[0.075, 0.086, 0.064]} material={materials.porcelain}>
            <sphereGeometry args={[1, 20, 16]} />
          </mesh>
        </group>
      ))}

      <RoundedBox
        args={[0.31, 0.045, 0.032]}
        radius={0.018}
        smoothness={2}
        position={[-0.075, -0.17, 0.43]}
        rotation={[0, 0, -0.43]}
        material={materials.trim}
      />
      <RoundedBox
        args={[0.26, 0.045, 0.034]}
        radius={0.018}
        smoothness={2}
        position={[0.075, -0.2, 0.435]}
        rotation={[0, 0, 0.43]}
        material={materials.trim}
      />

      <group ref={bookRef} position={[0, -0.59, 0.57]} rotation={[0.02, 0.06, -0.045]}>
        <RoundedBox args={[0.5, 0.4, 0.078]} radius={0.03} smoothness={3} material={materials.book} />
        <RoundedBox
          args={[0.4, 0.024, 0.06]}
          radius={0.012}
          smoothness={2}
          position={[0, 0.2, 0]}
          material={materials.porcelain}
        />
        <mesh position={[0, 0.08, 0.045]} material={materials.porcelain}>
          <boxGeometry args={[0.2, 0.018, 0.01]} />
        </mesh>
        <mesh position={[0, 0.035, 0.045]} material={materials.porcelain}>
          <boxGeometry args={[0.13, 0.012, 0.01]} />
        </mesh>
      </group>

    </>
  );
}
