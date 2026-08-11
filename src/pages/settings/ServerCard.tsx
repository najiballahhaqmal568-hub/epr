import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getServerConfig, setServerConfig } from '../../lib/supa'
import { Card, inputCls, Field, PrimaryBtn } from '../../components/ui'

export function ServerCard() {
  const [expanded, setExpanded] = useState(false)
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')
  const configured = useLiveQuery(async () => Boolean(await getServerConfig()), [])

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-800">اتصال به سرور (همگام‌سازی ابری)</p>
      <p className="mb-3 text-sm text-slate-500">
        {configured
          ? '✅ سرور تنظیم شده است. اطلاعات بین موبایل‌ها همگام می‌شود.'
          : 'برای استفادهٔ چند نفره و بکاپ آنلاین، مشخصات پروژهٔ Supabase را وارد کنید.'}
      </p>
      {!expanded ? (
        <button onClick={() => setExpanded(true)} className="rounded-xl bg-slate-100 px-5 py-2 font-bold text-slate-700">
          {configured ? 'تغییر سرور' : 'تنظیم سرور'}
        </button>
      ) : (
        <>
          <Field label="Project URL">
            <input className={inputCls} dir="ltr" placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field label="Anon Key">
            <input className={inputCls} dir="ltr" placeholder="eyJhbGciOi..." value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={!url.trim().startsWith('https://') || key.trim().length < 20}
            onClick={async () => {
              await setServerConfig({ url, anonKey: key })
              setMsg('✅ ذخیره شد. حالا از صفحهٔ ورود، ثبت‌نام یا ورود کنید.')
              setExpanded(false)
            }}
          >
            ذخیره و اتصال
          </PrimaryBtn>
        </>
      )}
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </Card>
  )
}

export default ServerCard
