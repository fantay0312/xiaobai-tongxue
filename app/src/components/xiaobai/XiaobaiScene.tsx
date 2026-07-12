/**
 * Canvas 内部场景:团子本体(shader 形变) + 脸(CanvasTexture crossfade)
 * + 头顶配饰 + 分场景光照 + 接触阴影 + 可选星尘。
 * 动效原则:一切过渡走阻尼插值(ease-out 质感),禁止 elastic。
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { XiaobaiMood } from '../../types';
import { LevelAccessory } from './Accessories';
import { createBlobMaterial } from './blobMaterial';
import { BLINK_MOODS, drawFace, FACE_CANVAS_SIZE } from './faceTexture';
import { MOOD_MOTION } from './moodMotion';
import { AZURE_RIM, BOARD_DEEP, CHALK, CHALK_AMBER, INK_SOFT, PAPER_EDGE } from './palette';

export interface XiaobaiSceneProps {
  mood: XiaobaiMood;
  level: 1 | 2 | 3 | 4 | 5;
  speaking: boolean;
  variant: 'paper' | 'board';
  /** 星尘粒子(讲解舱 Stage 用) */
  stardust?: boolean;
}

/* ────────────────── 脸:CanvasTexture + crossfade ────────────────── */

const FACE_FADE_SECONDS = 0.26;

function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3);
}

function useFaceTexture(mood: XiaobaiMood) {
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
    if (mood !== fade.current.next) {
      fade.current = { prev: fade.current.next, next: mood, blend: 0 };
    }
  }, [mood]);

  // 初始画一帧
  useEffect(() => {
    const { ctx, texture } = made;
    if (!ctx) return;
    ctx.clearRect(0, 0, FACE_CANVAS_SIZE, FACE_CANVAS_SIZE);
    drawFace(ctx, fade.current.next);
    texture.needsUpdate = true;
  }, [made]);

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

function XiaobaiBlob({ mood, level, speaking, variant }: XiaobaiSceneProps) {
  const groupRef = useRef<THREE.Group>(null);

  const { material, uniforms } = useMemo(
    () =>
      variant === 'board'
        ? createBlobMaterial(AZURE_RIM, 0.34) // 黑板:青色轮廓 rim(--azure 提亮)
        : createBlobMaterial(PAPER_EDGE, 0.16), // 纸面:暖纸色微弱边缘光
    [variant],
  );
  useEffect(() => () => material.dispose(), [material]);

  const face = useFaceTexture(mood);
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
    const t = clock.elapsedTime;
    const m = MOOD_MOTION[mood];
    const g = groupRef.current;
    if (!g) return;

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
      {/* 团子本体:高细分二十面体 + simplex 位移 */}
      <mesh material={material}>
        <icosahedronGeometry args={[1, 24]} />
      </mesh>
      {/* 脸:贴于正面(团子最大位移 ~0.08,平面放 1.1 避免穿插) */}
      <mesh position={[0, 0.06, 1.1]} material={faceMaterial} renderOrder={2}>
        <planeGeometry args={[1.5, 1.5]} />
      </mesh>
      <LevelAccessory level={level} />
    </group>
  );
}

/* ────────────────── 光照(两种场景) ────────────────── */

function SceneLights({ variant }: { variant: 'paper' | 'board' }) {
  if (variant === 'board') {
    return (
      <>
        {/* 夜自习黑板:偏暖顶光(--chalk-amber) + 青色 rim(--azure 提亮) */}
        <ambientLight intensity={0.55} color={CHALK} />
        <directionalLight position={[0.6, 4, 1.8]} intensity={2.4} color={CHALK_AMBER} />
        <directionalLight position={[-2.5, 1.2, -2.5]} intensity={1.6} color={AZURE_RIM} />
        <directionalLight position={[2.5, 0.4, -1.5]} intensity={0.7} color={AZURE_RIM} />
      </>
    );
  }
  return (
    <>
      {/* 宣纸场景:明亮柔和三点光 */}
      <ambientLight intensity={1.05} color={CHALK} />
      <directionalLight position={[2, 3, 4]} intensity={2.0} color={'#fff7e8' /* 暖白主光,≈ --paper 提亮 */} />
      <directionalLight position={[-3, 1.5, 2]} intensity={0.8} color={PAPER_EDGE} />
      <directionalLight position={[0, 2, -3]} intensity={1.0} color={CHALK} />
    </>
  );
}

/* ────────────────── 接触阴影(两种场景都有,团子不再悬空) ────────────────── */

function ContactShadow({ variant }: { variant: 'paper' | 'board' }) {
  // 黑板地面:深墨浓影;宣纸页面:淡墨软影(把团子"放"在纸上,而不是浮着)
  const base = variant === 'board' ? BOARD_DEEP : INK_SOFT;
  const texture = useMemo(() => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, `${base}b3`); // 中心 ~0.7 透明度
      grad.addColorStop(0.55, `${base}40`);
      grad.addColorStop(1, `${base}00`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [base]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh
      position={[0, -1.12, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={variant === 'board' ? [2.3, 1.5, 1] : [2.05, 1.3, 1]}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} transparent opacity={variant === 'board' ? 0.55 : 0.3} depthWrite={false} />
    </mesh>
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

export function XiaobaiScene({ mood, level, speaking, variant, stardust = false }: XiaobaiSceneProps) {
  return (
    <>
      <SceneLights variant={variant} />
      <XiaobaiBlob mood={mood} level={level} speaking={speaking} variant={variant} />
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
