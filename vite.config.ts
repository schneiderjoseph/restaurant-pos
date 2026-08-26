import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"

// ASI default: 5173 → gateway 3142. Loyverse demo (isolated): POSR_DEV_PORT=5174 POSR_GATEWAY_PORT=3143
const devPort = Number(process.env.POSR_DEV_PORT || 5173)
const gatewayPort = process.env.POSR_GATEWAY_PORT || '3142'
const printPort = process.env.POSR_PRINT_PORT || '3133'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") }
  },
  server: {
    host: '0.0.0.0',
    port: devPort,
    strictPort: true,
    // Same-origin proxies: LAN tablets hit only the Vite port (no CORS to gateway).
    proxy: {
      '/tracking': {
        target: 'http://127.0.0.1:3138',
        changeOrigin: true,
      },
      '/print': {
        target: `http://127.0.0.1:${printPort}`,
        changeOrigin: true,
      },
      '/auth': {
        target: `http://127.0.0.1:${gatewayPort}`,
        changeOrigin: true,
      },
      '/rpc': {
        target: `ws://127.0.0.1:${gatewayPort}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
