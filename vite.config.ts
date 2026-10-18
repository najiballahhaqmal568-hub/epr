import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// شناختن عکس بوت در خود گوشی (بی انترنت): فایل‌های wasm ـِ MediaPipe از node_modules کنار اپ گذاشته می‌شوند.
// فقط نسخهٔ SIMD — همهٔ گوشی‌های اندروید امروزی آن را دارند و نسخهٔ دوم ۹ مگابایت دیگر می‌شد.
// مدل (public/vision/mobilenet_v3_small.tflite) خودش در public است.
const VISION_FILES: Record<string, string> = {
  'vision/vision_wasm_internal.js': 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js',
  'vision/vision_wasm_internal.wasm': 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm'
}
function visionAssets(): Plugin {
  return {
    name: 'vision-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0].replace(/^\//, '') ?? ''
        const source = VISION_FILES[path]
        if (!source) return next()
        res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        res.end(readFileSync(source))
      })
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(VISION_FILES)) this.emitFile({ type: 'asset', fileName, source: readFileSync(source) })
    }
  }
}

export default defineConfig({
  base: './',
  // بار اول 📷 در حالت توسعه صفحه را دوباره بار نکند
  optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
  plugins: [
    react(),
    tailwindcss(),
    visionAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/*.woff2'],
      manifest: {
        name: 'فروشگاه اتل',
        short_name: 'اتل',
        description: 'فروشگاه اتل — سیستم مدیریت گدام، فروش و مشتریان',
        dir: 'rtl',
        lang: 'fa',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // ۱۴ مگابایتِ شناختن عکس فقط بار اولی که 📷 زده شود دانلود می‌شود و بعد بی انترنت کار می‌کند
        globIgnores: ['vision/**'],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.includes('/vision/'),
          handler: 'CacheFirst',
          options: { cacheName: 'vision', expiration: { maxEntries: 8 } }
        }]
      }
    })
  ]
})
