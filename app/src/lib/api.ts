/**
 * 同源网关 API 根路径。
 * 跟随构建 base(XB_BASE):根部署 → /api;路径前缀部署(如 /xiaobai/) → /xiaobai/api。
 * node 环境(simulate/livetest 经由 engine 间接引入)没有 import.meta.env,回退 '/'。
 */
const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
export const API_BASE = `${base.replace(/\/+$/, '')}/api`;
