/**
 * 科技主题氛围层 —— 装饰性竖条波纹场。
 * 不接麦克风、不读音频;只在 data-theme=tech 时由 AppShell 挂载。
 */
import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import styles from './TechBarfield.module.css';

function fieldNoise(x: number, y: number, time: number): number {
  const n =
    Math.sin(x * 0.018 + time) * Math.cos(y * 0.012 + time * 0.7) +
    Math.sin(x * 0.031 - time * 0.8) * Math.cos(y * 0.008 + time);
  return (n + 1) / 2;
}

function readBarColor(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--terra').trim();
  return raw || 'oklch(0.780 0.148 210.4)';
}

export function TechBarfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);
      const color = readBarColor();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = 1;
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
      const step = 7;
      for (let x = 0; x < width; x += step) {
        const envelope = 0.34 + 0.56 * Math.abs(Math.sin(x * 0.012 + time));
        const noise = fieldNoise(x, height * 0.5, time);
        const barHeight = height * (0.16 + 0.74 * envelope * noise);
        const y0 = (height - barHeight) / 2;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y0);
        ctx.lineTo(x + 0.5, y0 + barHeight);
        ctx.stroke();
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    if (reducedMotion) {
      draw(0);
      return () => observer.disconnect();
    }

    const loop = (now: number) => {
      draw(now * 0.00045);
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className={styles.field} aria-hidden="true" />;
}
