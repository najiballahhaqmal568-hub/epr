import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import { db } from './db'

registerSW({ immediate: true })

// بعد از «ریست این موبایل»، تنظیمات نگه‌داشته‌شده را برگردان
const restore = localStorage.getItem('restoreSettings')
if (restore) {
  localStorage.removeItem('restoreSettings')
  try {
    const kept = JSON.parse(restore) as { key: string; value: unknown }[]
    void Promise.all(kept.map((s) => db.settings.put(s)))
  } catch {
    /* قابل چشم‌پوشی */
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
