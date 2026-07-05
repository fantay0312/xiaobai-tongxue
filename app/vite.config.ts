import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // 部署到路径前缀时:XB_BASE=/xiaobai/ npm run build;本地开发/根部署保持 '/'
  base: process.env.XB_BASE || '/',
  plugins: [react()],
  server: {
    // 本地联调网关(node server/index.mjs, port 8787);网关未启动时 /api 报错,
    // 前端按"独立模式"处理(不强制登录、LLM 走本地配置),不影响原有开发流
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
