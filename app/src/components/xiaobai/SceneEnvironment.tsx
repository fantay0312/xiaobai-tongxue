import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { AZURE_RIM, BOARD_DEEP, CHALK, CHALK_AMBER, INK_SOFT, PAPER_EDGE } from './palette';

export function SceneLights({ variant }: { variant: 'paper' | 'board' }) {
  if (variant === 'board') {
    return (
      <>
        <ambientLight intensity={0.55} color={CHALK} />
        <directionalLight position={[0.6, 4, 1.8]} intensity={2.4} color={CHALK_AMBER} />
        <directionalLight position={[-2.5, 1.2, -2.5]} intensity={1.6} color={AZURE_RIM} />
        <directionalLight position={[2.5, 0.4, -1.5]} intensity={0.7} color={AZURE_RIM} />
      </>
    );
  }

  return (
    <>
      <ambientLight intensity={1.05} color={CHALK} />
      <directionalLight position={[2, 3, 4]} intensity={2} color="#fff7e8" />
      <directionalLight position={[-3, 1.5, 2]} intensity={0.8} color={PAPER_EDGE} />
      <directionalLight position={[0, 2, -3]} intensity={1} color={CHALK} />
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
      position={[0, -1.12, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={variant === 'board' ? [2.3, 1.5, 1] : [2.05, 1.3, 1]}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={variant === 'board' ? 0.55 : 0.3}
        depthWrite={false}
      />
    </mesh>
  );
}
