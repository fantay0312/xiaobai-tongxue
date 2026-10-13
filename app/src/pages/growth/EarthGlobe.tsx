import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import earthUrl from '../../assets/earth.jpg';
import s from './KnowledgeSeaField.module.css';

const AXIAL = 0.41;
const SPIN_SPEED = 0.08;

export type EarthMotion = {
  yaw: number;
  pitch: number;
  spin: number;
};

type Tex = { data: Uint8ClampedArray; w: number; h: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function bilinear(src: Uint8ClampedArray, tw: number, th: number, u: number, v: number) {
  const fx = u * (tw - 1);
  const fy = v * (th - 1);
  const x0 = fx | 0;
  const y0 = fy | 0;
  const x1 = x0 + 1 < tw ? x0 + 1 : 0;
  const y1 = Math.min(th - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const i00 = (y0 * tw + x0) * 4;
  const i10 = (y0 * tw + x1) * 4;
  const i01 = (y1 * tw + x0) * 4;
  const i11 = (y1 * tw + x1) * 4;
  return [
    src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11,
    src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11,
    src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11,
  ];
}

function paintSphere(
  ctx: CanvasRenderingContext2D,
  image: ImageData,
  tex: Tex,
  size: number,
  yaw: number,
  pitch: number,
  spin: number,
) {
  const dest = image.data;
  const src = tex.data;
  const cyaw = Math.cos(yaw);
  const syaw = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const ca = Math.cos(AXIAL);
  const sa = Math.sin(AXIAL);
  const llen = Math.hypot(-0.32, 0.58, 0.75);
  const lx = -0.32 / llen;
  const ly = 0.58 / llen;
  const lz = 0.75 / llen;

  for (let y = 0; y < size; y += 1) {
    const ny = -((y + 0.5) / size * 2 - 1);
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size * 2 - 1;
      const r2 = nx * nx + ny * ny;
      const di = (y * size + x) * 4;
      if (r2 > 1) {
        dest[di + 3] = 0;
        continue;
      }
      const nz = Math.sqrt(1 - r2);
      const y1 = ny * cp + nz * sp;
      const z1 = -ny * sp + nz * cp;
      const xO = nx * cyaw - z1 * syaw;
      const zO = nx * syaw + z1 * cyaw;
      const xT = xO * ca - y1 * sa;
      const yT = xO * sa + y1 * ca;
      let u = Math.atan2(xT, zO) / (Math.PI * 2) + 0.5 + spin / (Math.PI * 2);
      u -= Math.floor(u);
      const v = clamp(0.5 - Math.asin(clamp(yT, -1, 1)) / Math.PI, 0, 0.9999);
      const sample = bilinear(src, tex.w, tex.h, u, v);
      const light = Math.max(0, nx * lx + ny * ly + nz * lz);
      const shade = 0.16 + 0.92 * light;
      const fres = (1 - nz) ** 2.4;
      dest[di] = clamp(sample[0] * shade + 48 * fres, 0, 255);
      dest[di + 1] = clamp(sample[1] * shade + 96 * fres, 0, 255);
      dest[di + 2] = clamp(sample[2] * shade + 150 * fres, 0, 255);
      dest[di + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function EarthGlobe({
  motion,
  reduced,
  dragging,
}: {
  motion: { current: EarthMotion };
  reduced: boolean;
  dragging?: { current: boolean };
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; yaw: number; pitch: number } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: true });
    if (!wrap || !canvas || !ctx) return;

    let tex: Tex | null = null;
    let image: ImageData | null = null;
    let size = 0;
    let running = true;
    let visible = true;
    let raf = 0;
    let last = performance.now();
    const img = new Image();
    img.decoding = 'async';
    img.src = earthUrl;
    img.onload = () => {
      if (!running) return;
      const sample = document.createElement('canvas');
      sample.width = 512;
      sample.height = 256;
      const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
      if (!sampleCtx) return;
      sampleCtx.drawImage(img, 0, 0, 512, 256);
      const pixels = sampleCtx.getImageData(0, 0, 512, 256);
      tex = { data: pixels.data, w: 512, h: 256 };
    };

    const paint = () => {
      const box = wrap.getBoundingClientRect();
      const next = Math.max(48, Math.min(192, Math.round(box.width * Math.min(2, window.devicePixelRatio || 1))));
      if (box.width < 2) return;
      if (next !== size || !image) {
        size = next;
        canvas.width = size;
        canvas.height = size;
        image = ctx.createImageData(size, size);
      }
      const { yaw, pitch, spin } = motion.current;
      if (!tex || !image) {
        const fallback = ctx.createRadialGradient(size * 0.38, size * 0.34, size * 0.04, size * 0.5, size * 0.5, size * 0.5);
        fallback.addColorStop(0, '#9fd4f5');
        fallback.addColorStop(0.52, '#1f6eb8');
        fallback.addColorStop(1, '#0b3a70');
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = fallback;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 0.5, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      paintSphere(ctx, image, tex, size, yaw, pitch, spin);
    };

    const loop = (now: number) => {
      if (!running) return;
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible || document.hidden) return;
      if (!reduced && !dragRef.current) motion.current.spin += dt * SPIN_SPEED;
      paint();
      raf = window.requestAnimationFrame(loop);
    };

    const resume = () => {
      if (!running || raf || !visible || document.hidden) return;
      last = performance.now();
      raf = window.requestAnimationFrame(loop);
    };

    const onVisibility = () => resume();
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) resume();
      else if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    }, { threshold: 0.04 });
    io.observe(wrap);
    document.addEventListener('visibilitychange', onVisibility);
    resume();

    return () => {
      running = false;
      if (raf) window.cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [motion, reduced]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: motion.current.yaw,
      pitch: motion.current.pitch,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.id) return;
    const moved = (event.clientX - drag.x) ** 2 + (event.clientY - drag.y) ** 2;
    if (dragging && moved > 16) dragging.current = true;
    motion.current.yaw = drag.yaw + (event.clientX - drag.x) * 0.008;
    motion.current.pitch = clamp(drag.pitch + (event.clientY - drag.y) * 0.006, -1.05, 1.05);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== event.pointerId) return;
    dragRef.current = null;
    if (dragging) dragging.current = false;
  };

  return (
    <div
      ref={wrapRef}
      className={s.earth}
      role="img"
      aria-label="地球，按住拖动可旋转"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} />
      <div className={s.horizonWash} />
      <div className={s.limbScatter} />
      <div className={s.limbSun} />
    </div>
  );
}
