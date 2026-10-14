import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root,
  base: `${process.env.XB_BASE || '/'}reader/`,
  plugins: [tailwindcss()],
  resolve: { alias: { '@': `${root}src`, 'next/link': `${root}src/compat/link.tsx`, 'next/navigation': `${root}src/compat/navigation.ts`, '@clerk/nextjs': `${root}src/compat/account.tsx` } },
  build: { outDir: '../dist/reader', emptyOutDir: true },
  server: { fs: { allow: [root] }, proxy: { '/api': 'http://127.0.0.1:8787' } },
});
