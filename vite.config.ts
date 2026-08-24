import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Same-origin proxies: LAN tablets hit only :5173 (no CORS to :3142).
    proxy: {
      '/tracking': {
        target: 'http://127.0.0.1:3138',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://127.0.0.1:3142',
        changeOrigin: true,
      },
      '/rpc': {
        target: 'ws://127.0.0.1:3142',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
