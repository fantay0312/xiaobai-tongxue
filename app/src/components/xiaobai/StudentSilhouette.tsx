import * as THREE from 'three';
import { AZURE_DEEP, CHALK_AMBER } from './palette';

const SIDES = [-1, 1] as const;

export function StudentSilhouette({
  material,
  variant,
}: {
  material: THREE.MeshStandardMaterial;
  variant: 'paper' | 'board';
}) {
  const accent = variant === 'board' ? CHALK_AMBER : AZURE_DEEP;

  return (
    <>
      {SIDES.map((side) => (
        <mesh
          key={`arm-${side}`}
          position={[side * 0.91, -0.2, 0.08]}
          rotation={[0, 0, side * -0.34]}
          scale={[0.34, 0.66, 0.34]}
          material={material}
        >
          <sphereGeometry args={[0.5, 16, 12]} />
        </mesh>
      ))}
      {SIDES.map((side) => (
        <mesh
          key={`foot-${side}`}
          position={[side * 0.47, -0.91, 0.24]}
          rotation={[0.08, 0, side * -0.08]}
          scale={[0.62, 0.3, 0.7]}
          material={material}
        >
          <sphereGeometry args={[0.5, 16, 12]} />
        </mesh>
      ))}
      {SIDES.map((side) => (
        <mesh key={`collar-${side}`} position={[side * 0.13, -0.48, 0.91]} rotation={[0, 0, side * 0.66]}>
          <boxGeometry args={[0.055, 0.38, 0.035]} />
          <meshBasicMaterial color={accent} />
        </mesh>
      ))}
    </>
  );
}
