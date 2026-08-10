import { useState } from 'react'
import { Field, inputCls, PrimaryBtn } from '../components/ui'
import { finishPasswordRecovery } from '../lib/supa'

export default function ResetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    if (password.length < 8) {
      setError('رمز باید حداقل ۸ حرف باشد')
      return
    }
    if (password !== confirm) {
      setError('دو رمز یکسان نیست')
      return
    }
    setBusy(true)
    setError('')
    try {
      await finishPasswordRecovery(password)
      window.history.replaceState(null, '', new URL('.', window.location.href).toString())
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center p-6">
      <img src="./icon-192.png" alt="اتل" className="mx-auto mb-3 h-24 w-24 rounded-3xl" />
      <h1 className="mb-3 text-center text-xl font-bold text-slate-800">تعیین رمز عبور نو</h1>

      {done ? (
        <>
          <div className="mb-4 rounded-xl bg-green-50 p-4 text-center text-sm font-bold text-green-700">
            ✅ رمز عبور تغییر کرد. اکنون با ایمیل مالک اصلی و رمز نو وارد شوید.
          </div>
          <PrimaryBtn onClick={onDone}>رفتن به صفحهٔ ورود</PrimaryBtn>
        </>
      ) : (
        <>
          <p className="mb-4 text-center text-sm text-slate-500">برای حساب مالک اصلی یک رمز نو و قوی بسازید.</p>
          <Field label="رمز عبور نو *">
            <input className={inputCls} dir="ltr" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="تکرار رمز عبور نو *">
            <input className={inputCls} dir="ltr" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <PrimaryBtn onClick={submit} disabled={busy || password.length < 8 || confirm.length < 8}>
            {busy ? '...' : 'ذخیرهٔ رمز نو'}
          </PrimaryBtn>
        </>
      )}
    </div>
  )
}
