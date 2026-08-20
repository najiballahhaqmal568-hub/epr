import type { SettingsSection } from './Settings'

export type MoreTarget = 'expenses' | 'reports' | `settings:${Exclude<SettingsSection, 'all'>}`

export default function More({ goTo, isStaff }: { goTo: (target: MoreTarget) => void; isStaff?: boolean }) {
  const itemClass =
    'flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-right shadow-sm active:bg-slate-50'

  const item = (target: MoreTarget, title: string, description: string, tone = '') => (
    <button key={target} onClick={() => goTo(target)} className={`${itemClass} ${tone}`}>
      <span>
        <span className="block font-bold text-slate-800">{title}</span>
        <span className="text-[11px] text-slate-500">{description}</span>
      </span>
    </button>
  )

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">بیشتر</h1>

      <div className="space-y-1.5">
        {item('expenses', 'مصارف و صندوق', 'مصارف روزانه، کتگوری‌ها و صندوق')}
        {!isStaff && item('reports', 'راپورها', 'فروش، مفاد، مصارف و نتیجه‌ها')}
        {item('settings:account', 'همگام‌سازی و حساب کاربری', isStaff ? 'حساب کاربری و خروج' : 'وضعیت سرور، حساب و کاربران')}
        {!isStaff && item('settings:backup', 'بکاپ و بازیابی', 'دانلود بکاپ یا برگرداندن معلومات')}
        {item('settings:reminders', 'یادآوری‌ها', 'مصارف روزانه و وعده‌های قرض')}
        {item('settings:app', 'تنظیمات اپ', isStaff ? 'اندازهٔ نوشته' : 'اندازهٔ نوشته و قفل برنامه')}
      </div>

      {!isStaff && (
        <>
          <h2 className="mt-4 mb-1.5 text-base font-bold text-slate-700">تنظیمات پیشرفته</h2>
          <div className="space-y-1.5">
            {item('settings:year', 'شروع سال مالی', 'فقط یک‌بار هنگام آماده‌کردن حساب‌ها')}
            {item('settings:integrity', 'کنترل حساب‌ها', 'مقایسهٔ رقم‌ها با سندها')}
            {item('settings:danger', 'منطقهٔ خطر', 'ریست این دستگاه یا تمام معلومات', 'border-red-200 bg-red-50')}
          </div>
        </>
      )}
    </div>
  )
}
