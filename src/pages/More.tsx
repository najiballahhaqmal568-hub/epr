import type { SettingsSection } from './Settings'
import { Icon, type IconName } from '../components/Icon'

export type MoreTarget = 'dashboard' | 'inventory' | 'purchases' | 'expenses' | 'reports' | `settings:${Exclude<SettingsSection, 'all'>}`

export default function More({ goTo, isStaff, pendingExpenseCount = 0 }: { goTo: (target: MoreTarget) => void; isStaff?: boolean; pendingExpenseCount?: number }) {
  const itemClass =
    'management-row'

  const item = (target: MoreTarget, title: string, description: string, tone = '') => (
    <button key={target} onClick={() => goTo(target)} className={`${itemClass} ${tone}`}>
      <Icon name={({ dashboard: 'chart', inventory: 'stock', purchases: 'receipt', expenses: 'wallet', reports: 'chart', 'settings:backup': 'backup', 'settings:account': 'sync', 'settings:reminders': 'clock' } as Partial<Record<MoreTarget, IconName>>)[target] ?? 'settings'} />
      <span>
        <span className="block font-bold text-slate-800">{title}</span>
        <span className="text-[11px] text-slate-500">{description}</span>
      </span>
    </button>
  )

  return (
    <div className="p-4">
      <div className="page-heading"><div><h1>بیشتر</h1><p>گدام، مصارف و مدیریت دکان</p></div></div>

      <div className="surface">
        {item('inventory', 'گدام و خرید', 'موجودی و سفارش مجدد')}
        {item('purchases', 'خریدها', 'اسناد و تاریخچهٔ خرید')}
        {item('expenses', 'مصارف و صندوق', 'مصارف روزانه، کتگوری‌ها و صندوق')}
        {pendingExpenseCount > 0 && item('expenses', 'مصارف ثبت‌نشدهٔ امروز', 'ثبت دستی مصارف روزانه')}
      </div>
      <h2 className="mb-2 mt-6 font-bold text-slate-700">راپورها و پشتیبانی</h2>
      <div className="surface">
        {item('dashboard', 'خلاصهٔ دکان', 'فروش امروز، موجودی و وضعیت حساب‌ها')}
        {!isStaff && item('reports', 'راپورها', 'فروش، مفاد، مصارف و نتیجه‌ها')}
        {item('settings:account', 'همگام‌سازی و حساب کاربری', isStaff ? 'حساب کاربری و خروج' : 'وضعیت سرور، حساب و کاربران')}
        {!isStaff && item('settings:backup', 'بکاپ و بازیابی', 'دانلود بکاپ یا برگرداندن معلومات')}
        {item('settings:reminders', 'یادآوری‌ها', 'مصارف روزانه و وعده‌های قرض')}
        {item('settings:app', 'تنظیمات اپ', isStaff ? 'اندازهٔ نوشته و نمای روز و شب' : 'اندازهٔ نوشته، نمای روز و شب و قفل برنامه')}
      </div>

      {!isStaff && (
        <details className="surface mt-6 p-4">
          <summary className="font-bold text-slate-700">تنظیمات پیشرفته</summary>
          <div className="mt-3">
            {item('settings:year', 'شروع سال مالی', 'فقط یک‌بار هنگام آماده‌کردن حساب‌ها')}
            {item('settings:integrity', 'کنترل حساب‌ها', 'مقایسهٔ رقم‌ها با سندها')}
            {item('settings:danger', 'منطقهٔ خطر', 'ریست این دستگاه یا تمام معلومات', 'border-red-200 bg-red-50')}
          </div>
        </details>
      )}
    </div>
  )
}
