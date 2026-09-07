import { syncNow, useSyncStatus } from '../lib/sync'
import { syncStatusLabel } from '../lib/syncStatusLabel'
import { fmtNum } from '../lib/format'
import { Card } from './ui'

const dateTime = new Intl.DateTimeFormat('fa-AF', { dateStyle: 'medium', timeStyle: 'short' })

export default function SyncDetails() {
  const status = useSyncStatus()
  const disabled = status.state === 'syncing' || status.state === 'offline' || status.state === 'off' || status.restorePending
  return <Card>
    <section aria-labelledby="sync-details-title">
      <h2 id="sync-details-title" className="mb-2 font-bold text-slate-800">وضعیت همگام‌سازی</h2>
      <p role="status" className="mb-3 text-sm font-bold">{syncStatusLabel(status)}</p>
      <dl className="space-y-3 text-sm">
        <div><dt className="text-slate-500">آخرین همگام‌سازی موفق این دستگاه</dt>
          <dd>{status.lastSync ? <time dateTime={new Date(status.lastSync).toISOString()}>{dateTime.format(status.lastSync)}</time> : 'هنوز ثبت نشده'}</dd></div>
        <div><dt className="text-slate-500">ثبت‌های منتظر ارسال یا تأیید</dt>
          <dd>{status.pending === null ? 'در حال بررسی…' : fmtNum(status.pending)}</dd></div>
      </dl>
      <p className="mt-3 text-xs leading-6 text-slate-500">این تعداد، ثبت‌های مرتبط با همگام‌سازی است؛ یک فروش می‌تواند چند ثبت داشته باشد. موفقیت این دستگاه به معنی دریافت اطلاعات در دستگاه دیگر نیست.</p>
      {status.state === 'offline' && <p className="mt-3 text-sm">اینترنت وصل نیست. اطلاعات را حذف نکنید؛ پس از اتصال، همگام‌سازی دوباره انجام می‌شود.</p>}
      {status.state === 'off' && <p className="mt-3 text-sm">برای ارسال اطلاعات، اتصال سرور و ورود به حساب کاربری را بررسی کنید.</p>}
      {status.state === 'error' && <div role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
        <p>{status.restorePending ? status.message : 'همگام‌سازی کامل نشد. اتصال اینترنت و حساب کاربری را بررسی کنید؛ اطلاعات یا بکاپ را حذف نکنید.'}</p>
        {!status.restorePending && status.message && <details className="mt-2"><summary className="cursor-pointer">جزئیات خطا</summary><p className="mt-2 break-words" dir="auto">{status.message}</p></details>}
      </div>}
      <button className="mt-4 rounded-xl bg-teal-700 px-5 py-3 font-bold text-white disabled:opacity-50" disabled={Boolean(disabled)} onClick={() => void syncNow()}>
        {status.state === 'syncing' ? 'در حال همگام‌سازی…' : status.state === 'error' && !status.restorePending ? 'تلاش دوباره' : 'همگام‌سازی اکنون'}
      </button>
    </section>
  </Card>
}
