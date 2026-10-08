import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { visualizer } from 'rollup-plugin-visualizer'

// ASI default: 5173 → gateway 3142. Loyverse demo (isolated): POSR_DEV_PORT=5174 POSR_GATEWAY_PORT=3143
const devPort = Number(process.env.POSR_DEV_PORT || 5173)
const gatewayPort = process.env.POSR_GATEWAY_PORT || '3142'
const printPort = process.env.POSR_PRINT_PORT || '3133'

function resolveBuildId(): string {
  const stamp = Date.now()
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (sha) return `${stamp}-${sha}`
  } catch {
    // git unavailable — timestamp alone is enough for version.json polls
  }
  return String(stamp)
}

function clientVersionPlugin(buildId: string): Plugin {
  const payload = JSON.stringify({ buildId }, null, 2)

  return {
    name: 'posr-client-version',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url !== '/version.json') {
          next()
          return
        }
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(payload)
      })
    },
    writeBundle(options) {
      const dir = options.dir || path.resolve(process.cwd(), 'dist')
      const target = path.join(dir, 'version.json')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(target, payload + '\n', 'utf8')
    },
  }
}

// Date formats the app interpolates into SurrealQL and Luxon calls. A .env missing them
// bakes "undefined" into queries and silently empties date-filtered reports.
const DATE_FORMAT_DEFAULTS: Record<string, string> = {
  VITE_DATE_FORMAT: 'yyyy-MM-dd',
  VITE_TIME_FORMAT: 'HH:mm',
  VITE_DATE_TIME_FORMAT: 'yyyy-MM-dd HH:mm',
  VITE_DATE_HUMAN_FORMAT: 'ff',
  VITE_DB_DATABASE_DATE_FORMAT: '%Y-%m-%d',
  VITE_DB_DATABASE_FORMAT: '%Y-%m-%d %H:%M',
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const buildId = resolveBuildId()
  const dateFormatDefines = Object.fromEntries(
    Object.entries(DATE_FORMAT_DEFAULTS)
      .filter(([key]) => !env[key])
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])
  )

  return {
  define: {
    ...dateFormatDefines,
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
  },
  plugins: [
    react(),
    clientVersionPlugin(buildId),
    visualizer({
      filename: './dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (
            id.includes('/antd/') ||
            id.includes('\\antd\\') ||
            id.includes('@rc-component') ||
            id.includes('@ant-design')
          ) {
            return 'antd'
          }
          if (
            id.includes('/react-dom/') ||
            id.includes('\\react-dom\\') ||
            id.includes('/react/') ||
            id.includes('\\react\\')
          ) {
            // Only core react packages, not react-* siblings
            if (
              /node_modules[/\\]react[/\\]/.test(id) ||
              /node_modules[/\\]react-dom[/\\]/.test(id) ||
              /node_modules[/\\]scheduler[/\\]/.test(id)
            ) {
              return 'react-vendor'
            }
          }
        },
      },
    },
  },
}
})
