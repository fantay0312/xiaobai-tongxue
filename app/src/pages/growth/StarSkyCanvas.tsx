import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import {
  SEA_HEIGHT,
  SEA_WIDTH,
  seedMilkyWay,
  seedSkyStars,
  type SeaPoint,
  type SkyStar,
} from './knowledgeSeaGeometry';
import s from './KnowledgeSeaField.module.css';

type SkyPalette = {
  deep: string;
  ink: string;
  moon: string;
  blue: string;
  jade: string;
  amber: string;
};

type Vec3 = { x: number; y: number; z: number };

function readPalette(host: HTMLElement): SkyPalette {
  const style = getComputedStyle(host);
  return {
    deep: style.getPropertyValue('--sky-deep').trim() || 'oklch(0.205 0.025 250)',
    ink: style.getPropertyValue('--sky-ink').trim() || 'oklch(0.252 0.026 248)',
    moon: style.getPropertyValue('--sky-moon').trim() || 'oklch(0.943 0.035 86)',
    blue: style.getPropertyValue('--sky-blue').trim() || 'oklch(0.752 0.061 237)',
    jade: style.getPropertyValue('--sky-jade').trim() || 'oklch(0.774 0.055 119)',
    amber: style.getPropertyValue('--sky-amber').trim() || 'oklch(0.754 0.091 75)',
  };
}

function tintColor(palette: SkyPalette, tint: SkyStar['tint']): string {
  if (tint === 1) return palette.blue;
  if (tint === 2) return palette.jade;
  if (tint === 3) return palette.amber;
  return palette.moon;
}

function look(point: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x = point.x * cy - point.z * sy;
  const z = point.x * sy + point.z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return {
    x,
    y: point.y * cp - z * sp,
    z: point.y * sp + z * cp,
  };
}

function project(point: Vec3, width: number, height: number) {
  if (point.z <= 0.06) return null;
  const scale = Math.min(width, height) * 0.96;
  const falloff = point.z + 1.12;
  return {
    px: width * 0.5 + (point.x / falloff) * scale,
    py: height * 0.5 + (point.y / falloff) * scale,
    depth: point.z,
  };
}

function drawSpikes(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  length: number,
) {
  ctx.beginPath();
  ctx.moveTo(px - length, py);
  ctx.lineTo(px + length, py);
  ctx.moveTo(px, py - length);
  ctx.lineTo(px, py + length);
  ctx.stroke();
}

export function StarSkyCanvas({
  compact,
  keepouts,
}: {
  compact: boolean;
  keepouts: SeaPoint[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keepoutRef = useRef(keepouts);
  keepoutRef.current = keepouts;
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !host || !ctx) return;

    const stars = seedSkyStars(compact ? 420 : 720);
    const milky = seedMilkyWay(compact ? 180 : 260);
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    let palette = readPalette(host);
    let width = 0;
    let height = 0;
    let dpr = 1;
    let yaw = 0.18;
    let last = performance.now();
    let raf = 0;
    let running = true;
    let visible = true;

    const paint = (now: number, animate: boolean) => {
      const dt = Math.min(48, now - last);
      last = now;
      if (animate) {
        yaw += dt * 0.000028;
        pointer.x += (pointer.tx - pointer.x) * 0.045;
        pointer.y += (pointer.ty - pointer.y) * 0.045;
      }
      const pitch = pointer.y * 0.32;
      const viewYaw = yaw + pointer.x * 0.62;

      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.deep;
      ctx.fillRect(0, 0, width, height);

      const zenith = ctx.createRadialGradient(
        width * 0.5,
        height * 0.42,
        Math.min(width, height) * 0.08,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.72,
      );
      zenith.addColorStop(0, palette.deep);
      zenith.addColorStop(0.55, palette.ink);
      zenith.addColorStop(1, palette.blue);
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = zenith;
      ctx.fillRect(0, 0, width, height);

      const airglow = ctx.createLinearGradient(0, height * 0.72, 0, height);
      airglow.addColorStop(0, 'transparent');
      airglow.addColorStop(1, palette.blue);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = airglow;
      ctx.fillRect(0, height * 0.68, width, height * 0.32);

      ctx.lineWidth = 0.7;
      ctx.strokeStyle = palette.moon;
      ctx.globalAlpha = 0.035;
      const meridians = compact ? 4 : 6;
      const steps = compact ? 24 : 32;
      for (let meridian = 0; meridian < meridians; meridian += 1) {
        const lon = (meridian / meridians) * Math.PI * 2;
        ctx.beginPath();
        let drawing = false;
        for (let step = 0; step <= steps; step += 1) {
          const lat = -Math.PI / 2 + (step / steps) * Math.PI;
          const mapped = project(look({
            x: Math.cos(lat) * Math.sin(lon),
            y: Math.sin(lat),
            z: Math.cos(lat) * Math.cos(lon),
          }, viewYaw, pitch), width, height);
          if (!mapped) {
            drawing = false;
            continue;
          }
          if (!drawing) {
            ctx.moveTo(mapped.px, mapped.py);
            drawing = true;
          } else {
            ctx.lineTo(mapped.px, mapped.py);
          }
        }
        ctx.stroke();
      }

      const holes = keepoutRef.current;
      const holeX = width / SEA_WIDTH;
      const holeY = height / SEA_HEIGHT;
      const clearR = compact ? 30 : 36;
      const hitsKeepout = (px: number, py: number, extra = 0) => {
        const limit = (clearR + extra) * (clearR + extra);
        for (const hole of holes) {
          const dx = px - hole.x * holeX;
          const dy = py - hole.y * holeY;
          if (dx * dx + dy * dy < limit) return true;
        }
        return false;
      };

      ctx.globalAlpha = 1;
      for (let index = 0; index < milky.length; index += 12) {
        const clump = milky[index];
        const mapped = project(look(clump, viewYaw, pitch), width, height);
        if (!mapped || hitsKeepout(mapped.px, mapped.py, 18)) continue;
        const radius = 22 + (1.15 - mapped.depth) * 52;
        const haze = ctx.createRadialGradient(mapped.px, mapped.py, 0, mapped.px, mapped.py, radius);
        haze.addColorStop(0, palette.moon);
        haze.addColorStop(1, 'transparent');
        ctx.globalAlpha = 0.03 + (1 - mapped.depth) * 0.028;
        ctx.fillStyle = haze;
        ctx.beginPath();
        ctx.arc(mapped.px, mapped.py, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      const drawCatalog = (catalog: SkyStar[], twinkle: boolean) => {
        for (const star of catalog) {
          const mapped = project(look(star, viewYaw, pitch), width, height);
          if (!mapped) continue;
          if (mapped.px < -12 || mapped.py < -12 || mapped.px > width + 12 || mapped.py > height + 12) continue;
          const pulse = twinkle ? 0.86 + 0.14 * Math.sin(now * star.twinkle + star.phase) : 0.94;
          const alpha = Math.min(0.95, star.opacity * pulse * (0.55 + 0.45 * mapped.depth));
          const radius = Math.max(0.28, star.size * (0.7 + 0.55 * mapped.depth));
          ctx.fillStyle = tintColor(palette, star.tint);
          ctx.globalAlpha = alpha;
          if (radius <= 0.7) {
            ctx.fillRect(mapped.px, mapped.py, 1.2, 1.2);
            continue;
          }
          if (hitsKeepout(mapped.px, mapped.py, star.mag < 1.65 ? 14 : 0)) continue;
          ctx.beginPath();
          ctx.arc(mapped.px, mapped.py, radius, 0, Math.PI * 2);
          ctx.fill();
          if (star.mag < 1.65) {
            ctx.strokeStyle = palette.moon;
            ctx.globalAlpha = alpha * 0.42;
            ctx.lineWidth = 0.7;
            drawSpikes(ctx, mapped.px, mapped.py, 5.5 + (1.65 - star.mag) * 4.2);
            ctx.globalAlpha = alpha * 0.16;
            ctx.beginPath();
            ctx.arc(mapped.px, mapped.py, radius * 4.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      };

      drawCatalog(milky, animate);
      drawCatalog(stars, animate);
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      if (!running) return;
      if (!visible || document.hidden) return;
      paint(now, true);
      raf = window.requestAnimationFrame(tick);
    };

    const resume = () => {
      if (reduced || !running || !visible || document.hidden) return;
      last = performance.now();
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(tick);
    };

    const onPointerMove = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      pointer.tx = ((event.clientX - box.left) / box.width) * 2 - 1;
      pointer.ty = ((event.clientY - box.top) / box.height) * 2 - 1;
    };
    const onPointerLeave = () => {
      pointer.tx = 0;
      pointer.ty = 0;
    };

    const resize = () => {
      const box = host.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      palette = readPalette(host);
      paint(performance.now(), false);
    };

    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) resume();
    }, { threshold: 0.04 });
    io.observe(host);
    host.addEventListener('pointermove', onPointerMove, { passive: true });
    host.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', resume);
    resume();

    return () => {
      running = false;
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [compact, reduced]);

  return <canvas ref={canvasRef} className={s.sky} aria-hidden="true" />;
}
