import { useRef, useState } from 'react'

/**
 * One save at a time. On a slow phone a quick double tap on «ذخیره» used to write the same expense or
 * purchase twice — the till lost the money twice. The ref blocks the second tap in the same instant
 * (before React has re-rendered the button as disabled); `busy` then disables it on screen.
 */
export function useSubmitOnce() {
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  async function run(task: () => unknown): Promise<void> {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      await task()
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { busy, run }
}
