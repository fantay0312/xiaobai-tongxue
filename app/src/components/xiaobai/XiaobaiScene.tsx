/**
 * Canvas 内部场景:团子本体(shader 形变) + 脸(CanvasTexture crossfade)
 * + 头顶配饰 + 分场景光照 + 接触阴影 + 可选星尘。
 * 动效原则:一切过渡走阻尼插值(ease-out 质感),禁止 elastic。
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { XiaobaiMood } from '../../types';
import { LevelAccessory } from './Accessories';
import { createBlobMaterial } from './blobMaterial';
import { BLINK_MOODS, drawFace, FACE_CANVAS_SIZE } from './faceTexture';
import { MOOD_MOTION } from './moodMotion';
import { AZURE_RIM, CHALK, PAPER_EDGE } from './palette';
import { ContactShadow, SceneLights } from './SceneEnvironment';
import { StudentSilhouette } from './StudentSilhouette';

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

/* ────────────────── 团子 + 脸 + 配饰 ────────────────── */

const damp = THREE.MathUtils.damp;
function XiaobaiBlob({ mood, level, speaking, variant, reducedMotion = false }: XiaobaiSceneProps) {
  const groupRef = useRef<THREE.Group>(null);

  const { material, uniforms } = useMemo(
    () =>
      variant === 'board'
        ? createBlobMaterial(AZURE_RIM, 0.34) // 黑板:青色轮廓 rim(--azure 提亮)
        : createBlobMaterial(PAPER_EDGE, 0.16), // 纸面:暖纸色微弱边缘光
    [variant],
  );
  useEffect(() => () => material.dispose(), [material]);

  const face = useFaceTexture(mood, reducedMotion);
  const faceMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: face.texture,
        transparent: true,
        depthWrite: false,
      }),
    [face.texture],
  );
  useEffect(() => () => faceMaterial.dispose(), [faceMaterial]);

  // mood 进场脉冲(aha 瞬间鼓起 / 其他 mood 微弹跳),指数衰减 = ease-out
  const pulse = useRef(0);
  const prevMood = useRef(mood);
  useEffect(() => {
    if (prevMood.current !== mood) {
      prevMood.current = mood;
      pulse.current = Math.max(pulse.current, MOOD_MOTION[mood].enterPulse, 0.04);
    }
  }, [mood]);

  useFrame(({ clock }, dt) => {
    const m = MOOD_MOTION[mood];
    const g = groupRef.current;
    if (!g) return;

    if (reducedMotion) {
      const staticScale = 1 + m.puff * 0.25;
      uniforms.uTime.value = 0;
      uniforms.uAmp.value = m.amp;
      uniforms.uFreq.value = m.freq;
      uniforms.uJitter.value = 0;
      g.scale.set(staticScale, staticScale, staticScale);
      g.position.y = 0;
      g.rotation.z = mood === 'shy' ? -0.05 : mood === 'proud' ? 0.03 : 0;
      return;
    }

    const t = clock.elapsedTime;

    // 1. shader 形变参数:阻尼趋近目标(柔和 ease-out)
    uniforms.uTime.value = t;
    uniforms.uAmp.value = damp(uniforms.uAmp.value, m.amp, 6, dt);
    uniforms.uFreq.value = damp(uniforms.uFreq.value, m.freq, 6, dt);
    uniforms.uJitter.value = damp(uniforms.uJitter.value, m.jitter, 8, dt);

    // 2. 脉冲衰减(瞬间鼓起后弹回)
    pulse.current *= Math.exp(-dt * 5.2);

    // 3. 呼吸挤压 + 整体缩放,作用于 group 使脸/配饰一起动
    const breath = Math.sin(t * m.breathSpeed) * m.breathAmp;
    const scale = 1 + m.puff * 0.5 + pulse.current;
    const targetSX = (1 + breath) * scale;
    const targetSY = (1 - breath * 0.85) * scale;
    g.scale.x = damp(g.scale.x, targetSX, 10, dt);
    g.scale.z = damp(g.scale.z, targetSX, 10, dt);
    g.scale.y = damp(g.scale.y, targetSY, 10, dt);

    // 4. bob:speaking 上下轻浮 + happy 自主小弹跳(正弦,非 elastic)
    let y = 0;
    if (m.bobAmp > 0) y += Math.abs(Math.sin(t * m.bobSpeed)) * m.bobAmp;
    if (speaking) y += Math.sin(t * 5.5) * 0.028 + 0.012;
    g.position.y = damp(g.position.y, y, 8, dt);

    // 5. 姿态:轻微摇摆;confused 高频小幅左右发抖
    let rz = Math.sin(t * 0.6) * 0.02;
    if (mood === 'confused') rz += Math.sin(t * 22) * 0.014;
    if (mood === 'shy') rz -= 0.05;
    if (mood === 'proud') rz += 0.03;
    g.rotation.z = damp(g.rotation.z, rz, 12, dt);

    // 6. 表情 crossfade
    face.tick(dt);
  });

  return (
    <group ref={groupRef}>
      {/* 团子本体:适度细分二十面体 + simplex 位移，兼顾轮廓与移动端开销。 */}
      <mesh material={material}>
        <icosahedronGeometry args={[1, 8]} />
      </mesh>
      <StudentSilhouette material={material} variant={variant} />
      {/* 脸:贴于正面(团子最大位移 ~0.08,平面放 1.1 避免穿插) */}
      <mesh position={[0, 0.06, 1.1]} material={faceMaterial} renderOrder={2}>
        <planeGeometry args={[1.5, 1.5]} />
      </mesh>
      <LevelAccessory level={level} />
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
      <XiaobaiBlob
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

/** 供外层 Canvas 复用的相机参数:略俯视,把接触阴影和头顶配饰都框进画面 */
export const XIAOBAI_CAMERA = {
  position: [0, 0.9, 4.6] as [number, number, number],
  rotation: [-0.12, 0, 0] as [number, number, number],
  fov: 36,
};
