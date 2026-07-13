import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { AZURE_RIM, BOARD_DEEP, CHALK, CHALK_AMBER, INK_SOFT, PAPER_EDGE } from './palette';

export function SceneLights({ variant }: { variant: 'paper' | 'board' }) {
  if (variant === 'board') {
    return (
      <>
        <ambientLight intensity={0.5} color={CHALK} />
        <directionalLight position={[0.8, 3.6, 2.8]} intensity={1.65} color={CHALK} />
        <directionalLight position={[2.2, 2.8, 3.4]} intensity={0.35} color={CHALK_AMBER} />
        <directionalLight position={[-2.8, 1.4, 1.4]} intensity={0.95} color={AZURE_RIM} />
        <directionalLight position={[2.3, 0.6, -1.8]} intensity={0.55} color={AZURE_RIM} />
      </>
    );
  }

  return (
    <>
      <ambientLight intensity={0.84} color={CHALK} />
      <directionalLight position={[1.3, 3.4, 4]} intensity={1.05} color={CHALK} />
      <directionalLight position={[0, 0.6, 5]} intensity={0.2} color={CHALK} />
      <directionalLight position={[2.5, 3, 3.2]} intensity={0.28} color={CHALK_AMBER} />
      <directionalLight position={[-3, 1.4, 2.2]} intensity={0.62} color={PAPER_EDGE} />
      <directionalLight position={[0, 2.4, -3]} intensity={0.5} color={CHALK} />
    </>
  );
}

export function ContactShadow({ variant }: { variant: 'paper' | 'board' }) {
  const base = variant === 'board' ? BOARD_DEEP : INK_SOFT;
  const texture = useMemo(() => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, `${base}b3`);
      grad.addColorStop(0.55, `${base}40`);
      grad.addColorStop(1, `${base}00`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    return result;
  }, [base]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh
      position={[0, -1.23, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={variant === 'board' ? [1.75, 1.15, 1] : [1.25, 0.72, 1]}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={variant === 'board' ? 0.45 : 0.1}
        depthWrite={false}
      />
    </mesh>
  );
}
