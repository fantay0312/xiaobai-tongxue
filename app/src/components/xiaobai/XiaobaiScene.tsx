/**
 * Canvas 内部场景:纸塑小书生 + 脸(CanvasTexture crossfade)
 * + 成长配饰 + 分场景光照 + 接触阴影 + 可选星尘。
 * 动效原则:一切过渡走阻尼插值(ease-out 质感),禁止 elastic。
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { XiaobaiMood } from '../../types';
import { BLINK_MOODS, drawFace, FACE_CANVAS_SIZE } from './faceTexture';
import { MOOD_MOTION } from './moodMotion';
import { AZURE_DEEP, BODY_WHITE, CHALK, CHALK_AMBER, PAPER } from './palette';
import { ContactShadow, SceneLights } from './SceneEnvironment';
import { XiaobaiBody, type XiaobaiMaterials } from './XiaobaiBody';

export interface XiaobaiSceneProps {
  mood: XiaobaiMood;
  level: 1 | 2 | 3 | 4 | 5;
  speaking: boolean;
  variant: 'paper' | 'board';
  reducedMotion?: boolean;
  /** 星尘粒子(讲解舱 Stage 用) */
  stardust?: boolean;
}

/* ────────────────── 脸:CanvasTexture + crossfade ────────────────── */

const FACE_FADE_SECONDS = 0.26;
function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3);
}

function useFaceTexture(mood: XiaobaiMood, reducedMotion: boolean) {
  const invalidate = useThree((state) => state.invalidate);
  const made = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = FACE_CANVAS_SIZE;
    canvas.height = FACE_CANVAS_SIZE;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    return { ctx, texture };
  }, []);

  // crossfade 状态:prev → next,blend 0→1
  const fade = useRef({ prev: mood, next: mood, blend: 1 });
  // 眨眼排程:timer 走到 0 翻转睑态(闭 ~0.11s,睁 2.4–5.6s 随机),只在待机表情眨
  const blink = useRef({ closed: false, timer: 1.8 });

  useEffect(() => {
    if (reducedMotion) {
      fade.current = { prev: mood, next: mood, blend: 1 };
      blink.current = { closed: false, timer: 1.8 };
      const { ctx, texture } = made;
      if (!ctx) return;
      ctx.clearRect(0, 0, FACE_CANVAS_SIZE, FACE_CANVAS_SIZE);
      drawFace(ctx, mood);
      texture.needsUpdate = true;
      invalidate();
      return;
    }
    if (mood !== fade.current.next) {
      fade.current = { prev: fade.current.next, next: mood, blend: 0 };
    }
  }, [invalidate, made, mood, reducedMotion]);

  // 初始画一帧
  useEffect(() => {
    const { ctx, texture } = made;
    if (!ctx) return;
    ctx.clearRect(0, 0, FACE_CANVAS_SIZE, FACE_CANVAS_SIZE);
    drawFace(ctx, fade.current.next);
    texture.needsUpdate = true;
    invalidate();
  }, [invalidate, made]);

  useEffect(() => () => made.texture.dispose(), [made]);

  /** 每帧推进 crossfade 与眨眼;返回 true 表示本帧发生了重绘 */
  const tick = (dt: number): boolean => {
    const f = fade.current;
    const b = blink.current;
    const { ctx, texture } = made;
    if (!ctx) return false;

    if (f.blend < 1) {
      // 表情切换期间不眨:两张脸都按睁眼画,睑态清零重新排程
      b.closed = false;
      b.timer = 2 + Math.random() * 3;
      f.blend = Math.min(1, f.blend + dt / FACE_FADE_SECONDS);
      const a = easeOutCubic(f.blend);
      ctx.clearRect(0, 0, FACE_CANVAS_SIZE, FACE_CANVAS_SIZE);
      ctx.globalAlpha = 1 - a;
      drawFace(ctx, f.prev);
      ctx.globalAlpha = a;
      drawFace(ctx, f.next);
      ctx.globalAlpha = 1;
      texture.needsUpdate = true;
      return true;
    }

    if (!BLINK_MOODS.has(f.next)) return false;
    b.timer -= dt;
    if (b.timer > 0) return false;
    b.closed = !b.closed;
    b.timer = b.closed ? 0.11 : 2.4 + Math.random() * 3.2;
    ctx.clearRect(0, 0, FACE_CANVAS_SIZE, FACE_CANVAS_SIZE);
    drawFace(ctx, f.next, FACE_CANVAS_SIZE, b.closed);
    texture.needsUpdate = true;
    return true;
  };

  return { texture: made.texture, tick };
}

/* ────────────────── 小书生本体 + 脸 + 姿态 ────────────────── */

const damp = THREE.MathUtils.damp;

function createFigureMaterials(variant: 'paper' | 'board'): XiaobaiMaterials {
  return {
    porcelain: new THREE.MeshStandardMaterial({ color: BODY_WHITE, roughness: 0.92, metalness: 0 }),
    robe: new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.93, metalness: 0 }),
    trim: new THREE.MeshStandardMaterial({
      color: variant === 'board' ? CHALK_AMBER : AZURE_DEEP,
      roughness: 0.82,
      metalness: 0,
    }),
    book: new THREE.MeshStandardMaterial({ color: AZURE_DEEP, roughness: 0.86, metalness: 0 }),
  };
}

function XiaobaiScholar({ mood, level, speaking, variant, reducedMotion = false }: XiaobaiSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const materials = useMemo(() => createFigureMaterials(variant), [variant]);
  useEffect(
    () => () => Object.values(materials).forEach((material) => material.dispose()),
    [materials],
  );

  const face = useFaceTexture(mood, reducedMotion);
  const faceMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ map: face.texture, transparent: true, depthWrite: false }),
    [face.texture],
  );
  useEffect(() => () => faceMaterial.dispose(), [faceMaterial]);

  const pulse = useRef(0);
  const prevMood = useRef(mood);
  useEffect(() => {
    if (prevMood.current === mood) return;
    prevMood.current = mood;
    pulse.current = Math.max(pulse.current, MOOD_MOTION[mood].enterPulse);
  }, [mood]);

  useFrame(({ clock }, dt) => {
    const motion = MOOD_MOTION[mood];
    const group = groupRef.current;
    if (!group) return;

    if (reducedMotion) {
      const staticScale = 1 + motion.puff * 0.25;
      group.scale.setScalar(staticScale);
      group.position.y = 0;
      group.rotation.z = 0;
      face.tick(0);
      return;
    }

    const t = clock.elapsedTime;
    pulse.current *= Math.exp(-dt * 5.2);
    const breath = Math.sin(t * motion.breathSpeed) * motion.breathAmp;
    const targetScale = 1 + motion.puff * 0.25 + pulse.current + breath;
    group.scale.setScalar(damp(group.scale.x, targetScale, 9, dt));

    let y = 0;
    if (motion.bobAmp > 0) y += Math.abs(Math.sin(t * motion.bobSpeed)) * motion.bobAmp;
    if (speaking) y += Math.sin(t * 4.2) * 0.006;
    group.position.y = damp(group.position.y, y, 8, dt);

    let rotation = Math.sin(t * 0.52) * 0.006;
    if (motion.shake > 0) rotation += Math.sin(t * 16) * motion.shake;
    group.rotation.z = damp(group.rotation.z, rotation, 12, dt);
    face.tick(dt);
  });

  return (
    <group ref={groupRef}>
      <XiaobaiBody
        mood={mood}
        level={level}
        speaking={speaking}
        reducedMotion={reducedMotion}
        faceMaterial={faceMaterial}
        materials={materials}
      />
    </group>
  );
}

/* ────────────────── 星尘粒子(Stage 可选背景) ────────────────── */

function Stardust() {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 140;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // 球壳分布,避开正前方镜头区
      const r = 2.4 + Math.random() * 2.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.cos(phi) * 0.7;
      arr[i * 3 + 2] = -Math.abs(r * Math.sin(phi) * Math.sin(theta)) - 0.4;
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 0.02;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={CHALK}
        size={0.028}
        sizeAttenuation
        transparent
        opacity={0.45}
        depthWrite={false}
      />
    </points>
  );
}

/* ────────────────── 场景组装 ────────────────── */

export function XiaobaiScene({
  mood,
  level,
  speaking,
  variant,
  reducedMotion = false,
  stardust = false,
}: XiaobaiSceneProps) {
  return (
    <>
      <SceneLights variant={variant} />
      <XiaobaiScholar
        mood={mood}
        level={level}
        speaking={speaking}
        variant={variant}
        reducedMotion={reducedMotion}
      />
      <ContactShadow variant={variant} />
      {stardust && <Stardust />}
    </>
  );
}

/** 正面视角保留衣袍高度，避免俯视再次把小白压成一颗头。 */
export const XIAOBAI_CAMERA = {
  position: [0, 0.08, 5] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  fov: 32,
};
