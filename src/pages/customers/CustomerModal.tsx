import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer } from '../../db'
import { toDateInput, fromDateInput } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

export function CustomerModal({
  customer,
  defaultType,
  onClose,
  onCreated
}: {
  customer: Customer | null
  defaultType?: 'retail' | 'wholesale'
  onClose: () => void
  /** مشتری تازه ساخته شد — تا حسابش باز شود و قرض قبلی‌اش نوشته شود */
  onCreated?: (c: Customer) => void
}) {
  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [type, setType] = useState<'retail' | 'wholesale'>(customer?.type ?? defaultType ?? 'retail')
  const [family, setFamily] = useState(customer?.family ?? '')
  const families = useLiveQuery(
    async () => [...new Set((await db.customers.filter((c) => !c.deleted && Boolean(c.family?.trim())).toArray()).map((c) => c.family!.trim()))],
    []
  )
  const [flag, setFlag] = useState<'good' | 'bad' | ''>(customer?.flag ?? '')
  const [promise, setPromise] = useState(customer?.promiseDate ? toDateInput(customer.promiseDate) : '')

  return (
    <Modal title={customer ? 'ویرایش مشتری' : 'مشتری جدید'} onClose={onClose}>
      <Field label="نام *">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="شماره تلفن">
        <input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="نوع مشتری">
        <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as 'retail' | 'wholesale')}>
          <option value="retail">پرچون</option>
          <option value="wholesale">عمده</option>
        </select>
      </Field>
      {type === 'retail' && (
        <Field label="خانواده (اختیاری — اعضای یک خانواده یکجا دیده می‌شوند)">
          <input className={inputCls} value={family} onChange={(e) => setFamily(e.target.value)} list="family-list" placeholder="مثلاً خانوادهٔ حاجی کریم" />
          <datalist id="family-list">
            {families?.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Field>
      )}
      <Field label="نشان مشتری">
        <select className={inputCls} value={flag} onChange={(e) => setFlag(e.target.value as 'good' | 'bad' | '')}>
          <option value="">عادی</option>
          <option value="good">⭐ مشتری خوب</option>
          <option value="bad">⚠️ قرض بد / احتیاط</option>
        </select>
      </Field>
      {!customer && (
        <p className="mb-3 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-500">
          قرض قبلی اینجا نوشته نمی‌شود — بعد از ذخیره، حساب همین شخص باز می‌شود و
          با دکمهٔ «قرض قبلی» مبلغ و صفحهٔ دفترش را می‌نویسید.
        </p>
      )}
      {customer && customer.balance > 0 && (
        <>
          <Field label="وعدهٔ پرداخت قرض">
            <input type="date" className={inputCls} value={promise} onChange={(e) => setPromise(e.target.value)} />
          </Field>
          <p className="-mt-2 mb-3 text-xs text-slate-400">
            با وعده، این طلب در «پول آینده» و در یادآوری قرضداران حساب می‌شود.
          </p>
        </>
      )}
      <PrimaryBtn
        disabled={!name.trim()}
        onClick={async () => {
          const data = {
            name: name.trim(),
            phone: phone.trim(),
            type,
            family: type === 'retail' && family.trim() ? family.trim() : undefined,
            flag: (flag || null) as 'good' | 'bad' | null,
            promiseDate: promise ? fromDateInput(promise) : undefined
          }
          if (customer?.id) await db.customers.update(customer.id, data)
          else {
            const id = (await db.customers.add({ ...data, balance: 0, createdAt: Date.now() })) as number
            // قدم بعدی خودش باز می‌شود: قرض قبلی با صفحهٔ دفترش
            onCreated?.({ ...data, id, balance: 0 } as Customer)
          }
          onClose()
        }}
      >
        ذخیره
      </PrimaryBtn>
    </Modal>
  )
}

export default CustomerModal
