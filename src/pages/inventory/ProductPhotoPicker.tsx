import { useRef, useState, type ChangeEvent } from 'react'
import { Modal } from '../../components/ui'
import { downscalePhoto } from './helpers'

/** Both product forms use the same preview/confirmation flow; no database writes here. */
export default function ProductPhotoPicker({ photo, onChange }: { photo?: string; onChange: (photo: string | undefined) => void }) {
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const processing = useRef(false)
  async function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = '' // Allow choosing the same file again after cancelling.
    if (!file || processing.current) return
    processing.current = true
    setBusy(true)
    setError('')
    try {
      if (file.type && !file.type.startsWith('image/')) throw new Error('not an image')
      setPreview(await downscalePhoto(file))
    } catch { setError('عکس باز نشد. یک عکس دیگر از کامره یا گالری انتخاب کنید؛ عکس قبلی محفوظ است.') }
    finally { processing.current = false; setBusy(false) }
  }
  return <section className="mb-4" aria-label="عکس بوت">
    <div className="flex flex-wrap items-center gap-3">
      {photo && <img src={photo} alt="عکس فعلی بوت" className="h-20 w-20 rounded-xl object-cover" />}
      <button type="button" disabled={busy} className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white" onClick={() => camera.current?.click()}>گرفتن عکس با کامره</button>
      <button type="button" disabled={busy} className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold" onClick={() => gallery.current?.click()}>انتخاب از گالری</button>
      <input ref={camera} aria-label="فایل کامره" type="file" accept="image/*" capture="environment" className="hidden" onChange={select} />
      <input ref={gallery} aria-label="فایل گالری" type="file" accept="image/*" className="hidden" onChange={select} />
      {photo && <button type="button" disabled={busy} className="text-sm text-red-600" onClick={() => { if (confirm('عکس از این فرم حذف شود؟ تغییر با ذخیرهٔ فرم ثبت می‌شود.')) onChange(undefined) }}>حذف عکس</button>}
    </div>
    <p className="mt-2 text-xs text-slate-500">اگر کامره باز نشد، از گالری انتخاب کنید. عکس پس از ذخیرهٔ فرم ثبت می‌شود.</p>
    {busy && <p role="status" className="mt-2 text-sm">در حال آماده‌کردن عکس…</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {preview && <Modal title="پیش‌نمایش عکس بوت" onClose={() => setPreview(undefined)}>
      <img src={preview} alt="پیش‌نمایش عکس جدید بوت" className="mb-4 max-h-80 w-full rounded-xl object-contain" />
      <div className="flex gap-3"><button type="button" className="flex-1 rounded-xl bg-teal-700 p-3 font-bold text-white" onClick={() => { onChange(preview); setPreview(undefined) }}>استفاده از این عکس</button><button type="button" className="rounded-xl bg-slate-100 p-3" onClick={() => setPreview(undefined)}>لغو</button></div>
    </Modal>}
  </section>
}
