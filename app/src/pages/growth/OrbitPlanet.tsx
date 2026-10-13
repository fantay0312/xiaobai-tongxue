import { useEffect, useRef } from 'react';
import earthTexture from '../../assets/orbit-earth.jpg';
import { ORBIT_RINGS, orbitalPoint, SEA_HEIGHT, SEA_WIDTH } from './knowledgeSeaGeometry';
import s from './KnowledgeSeaField.module.css';

/** 参考环轨的球面投影；贴图来自用户提供的 HTML，球体只承担装饰。 */
export function OrbitPlanet({ compact, selected }: { compact: boolean; selected: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      const source = document.createElement('canvas');
      source.width = image.naturalWidth;
      source.height = image.naturalHeight;
      const sourceContext = source.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) return;
      sourceContext.drawImage(image, 0, 0);
      const texture = sourceContext.getImageData(0, 0, source.width, source.height);
      const size = 384;
      canvas.width = canvas.height = size;
      const pixels = context.createImageData(size, size);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const nx = (x + 0.5) / size * 2 - 1;
          const ny = (y + 0.5) / size * 2 - 1;
          const inside = 1 - nx * nx - ny * ny;
          if (inside <= 0) continue;
          const nz = Math.sqrt(inside);
          const longitude = Math.atan2(nx, nz) + 1.35;
          const latitude = Math.asin(ny);
          const tx = Math.floor(((longitude / (Math.PI * 2) + 0.5) % 1) * source.width);
          const ty = Math.min(source.height - 1, Math.floor((latitude / Math.PI + 0.5) * source.height));
          const sourceIndex = (ty * source.width + tx) * 4;
          const targetIndex = (y * size + x) * 4;
          const light = 0.18 + Math.max(0, -nx * 0.58 - ny * 0.35 + nz * 0.69) * 0.82;
          for (let channel = 0; channel < 3; channel += 1) pixels.data[targetIndex + channel] = texture.data[sourceIndex + channel] * light;
          pixels.data[targetIndex + 3] = Math.min(255, inside * size * 255);
        }
      }
      context.putImageData(pixels, 0, 0);
    };
    image.src = earthTexture;
    return () => { active = false; image.onload = null; };
  }, []);
  return (
    <div className={s.orbitScene} data-observing={selected || undefined} aria-hidden="true">
      <svg className={s.orbitRings} viewBox={`0 0 ${SEA_WIDTH} ${SEA_HEIGHT}`} preserveAspectRatio="none">
        {ORBIT_RINGS.map((_, index) => (
          <path key={index} d={Array.from({ length: 129 }, (_, step) => {
            const point = orbitalPoint(index, step / 128 * Math.PI * 2, compact);
            return `${step === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
          }).join(' ') + ' Z'} />
        ))}
      </svg>
      <div className={s.planet}><canvas ref={canvasRef} /></div>
    </div>
  );
}
