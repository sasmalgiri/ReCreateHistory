import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The renderer lives in src/renderer (identical to the desktop app's UI).
// In dev, Vite serves it on 5173 and proxies /api → the Express server (8787).
// In prod, `vite build` emits static assets to dist/public which the server serves.
export default defineConfig({
  root: 'src/renderer',
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: resolve('dist/public'),
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve('src/renderer/index.html') }
    }
  }
})
