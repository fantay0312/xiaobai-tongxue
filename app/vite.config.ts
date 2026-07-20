import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // 部署到路径前缀时:XB_BASE=/xiaobai/ npm run build;本地开发/根部署保持 '/'
  base: process.env.XB_BASE || '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // rolldown 原生分包(advancedChunks):把稳定不变的第三方运行时与庞大的 topics 数据
        // 各自切成长效缓存块,与页面路由块并行下载。入口会静态引用这两块(预期行为),
        // 收益是并行下载 + 版本稳定的长效缓存,而非减少总字节。
        advancedChunks: {
          groups: [
            {
              name: 'vendor',
              test: /[\\/]node_modules[\\/](?:react|react-dom|react-router|react-router-dom|scheduler|zustand|lucide-react)[\\/]/,
            },
            {
              name: 'topics',
              test: /[\\/]src[\\/]data[\\/]topics[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: {
    // 本地联调网关(node server/index.mjs, port 8787);网关未启动时 /api 报错,
    // 前端按"独立模式"处理(不强制登录、LLM 走本地配置),不影响原有开发流
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
