import { useState } from 'react'
import { login, registerOwner } from '../lib/supa'
import { Field, inputCls, PrimaryBtn } from '../components/ui'

export default function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [shopName, setShopName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') await login(email.trim(), password)
      else await registerOwner(email.trim(), password, name.trim(), shopName.trim())
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center p-6">
      <img src="./icon-192.png" alt="اتال" className="mx-auto mb-3 h-24 w-24 rounded-3xl" />
      <h1 className="mb-6 text-center text-xl font-bold text-slate-800">
        {mode === 'login' ? 'ورود به حساب' : 'ثبت‌نام مالک دکان'}
      </h1>

      {mode === 'register' && (
        <>
          <Field label="نام شما *">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="نام دکان *">
            <input className={inputCls} value={shopName} onChange={(e) => setShopName(e.target.value)} />
          </Field>
        </>
      )}
      <Field label="ایمیل *">
        <input className={inputCls} dir="ltr" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="رمز عبور *">
        <input className={inputCls} dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={submit} disabled={busy || !email.trim() || password.length < 6 || (mode === 'register' && (!name.trim() || !shopName.trim()))}>
        {busy ? '...' : mode === 'login' ? 'ورود' : 'ثبت‌نام'}
      </PrimaryBtn>
      {password.length > 0 && password.length < 6 && <p className="mt-2 text-xs text-amber-600">رمز حداقل ۶ حرف باشد</p>}

      <button className="mt-4 text-center text-sm text-teal-700" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'حساب ندارید؟ ثبت‌نام مالک (فقط بار اول)' : 'حساب دارید؟ ورود'}
      </button>
      <p className="mt-6 text-center text-xs text-slate-400">کارمندان: حساب شما را مالک می‌سازد؛ با ایمیل و رمز خود وارد شوید.</p>
    </div>
  )
}
