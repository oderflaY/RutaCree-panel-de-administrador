import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

// El panel llama a /api/... y al WebSocket /api/socket del mismo origen; en desarrollo Vite lo
// reenvía al backend (por defecto, producción). Quitamos el header Origin al reenviar para que el
// servidor trate la conexión como una app nativa y no la rechace por CORS/Origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.API_TARGET || 'https://82-21-72-68.sslip.io'
  const stripOrigin = (proxy: any) => {
    proxy.on('proxyReq', (r: any) => r.removeHeader('origin'))
    proxy.on('proxyReqWs', (r: any) => r.removeHeader('origin'))
  }
  return {
    // En producción el backend sirve el panel en /panel/.
    base: '/panel/',
    plugins: [react(), tailwind()],
    // La CSP del panel no permite workers blob:, así que usamos la build CSP de MapLibre y su
    // worker como archivo propio (ver main.tsx).
    resolve: { alias: [{ find: /^maplibre-gl$/, replacement: 'maplibre-gl/dist/maplibre-gl-csp.js' }] },
    server: {
      host: true,
      proxy: {
        '/api': { target, changeOrigin: true, secure: true, ws: true, configure: stripOrigin },
      },
    },
  }
})
