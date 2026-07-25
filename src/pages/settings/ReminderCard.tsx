import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { Card, inputCls } from '../../components/ui'

export function ReminderCard() {
  const on = useLiveQuery(async () => (await db.settings.get('expenseReminderOn'))?.value === true, [])
  const hour = useLiveQuery(async () => Number((await db.settings.get('expenseReminderHour'))?.value ?? 18), [])
  const debtOn = useLiveQuery(async () => (await db.settings.get('debtReminderOn'))?.value, [])

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-800">یادآوری روزانهٔ مصارف</p>
      <p className="mb-3 text-sm text-slate-500">
        اگر تا آخر روز مصرفی ثبت نکرده باشید، هنگام باز بودن اپ یادآوری نشان داده می‌شود.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={async () => {
            const next = !on
            await db.settings.put({ key: 'expenseReminderOn', value: next })
            if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
              try {
                await Notification.requestPermission()
              } catch {
                /* اجازهٔ اعلان اختیاری است */
              }
            }
          }}
          className={`rounded-xl px-5 py-2 font-bold ${on ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          {on ? 'فعال ✓' : 'غیرفعال'}
        </button>
        {on && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            از ساعت
            <select
              className={inputCls + ' w-20'}
              value={hour}
              onChange={(e) => db.settings.put({ key: 'expenseReminderHour', value: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="mb-1 font-bold text-slate-800">یادآوری روزانهٔ قرضداران</p>
        <p className="mb-3 text-sm text-slate-500">
          هر روز یک بار مشتریان قرضدار با مجموع قرض یادآوری می‌شوند تا تقاضای قرض فراموش نشود.
        </p>
        <button
          onClick={() => void db.settings.put({ key: 'debtReminderOn', value: debtOn === false })}
          className={`rounded-xl px-5 py-2 font-bold ${debtOn !== false ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          {debtOn !== false ? 'فعال ✓' : 'غیرفعال'}
        </button>
      </div>
    </Card>
  )
}

export default ReminderCard
