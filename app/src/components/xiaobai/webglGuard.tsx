/**
 * WebGL 可用性探测(模块级缓存,只测一次)+ 渲染错误边界。
 * 两者共同保证:任何环境下小白都能以 CSS 团子形态在场,绝不炸页面。
 */
import { Component } from 'react';
import type { ReactNode } from 'react';

let webglSupport: boolean | null = null;

export function detectWebGL(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement('canvas');
    webglSupport = !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

interface BoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

/** three 场景渲染出错时切换到降级内容 */
export class AvatarErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
