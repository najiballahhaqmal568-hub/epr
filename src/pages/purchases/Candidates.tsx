import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Candidate } from '../../db'
import { fmtNum, fmtMoney, fmtDate, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Fab, Empty, Card } from '../../components/ui'

const SOURCE_LABELS: Record<string, string> = {
  telegram: '📨 تلگرام',
  whatsapp: '💬 واتساپ',
  market: '🏪 بازار',
  other: 'دیگر'
}

/** کاندیدهای خرید آینده + پیشنهاد طبق دادهٔ فروش */
export function CandidatesView() {
  const [showNew, setShowNew] = useState(false)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)

  const candidates = useLiveQuery(() => db.candidates.orderBy('createdAt').reverse().toArray(), [])
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const recentSales = useLiveQuery(
    () => db.sales.where('date').aboveOrEqual(Date.now() - 30 * 86400000).filter((s) => !s.deleted).toArray(),
    []
  )

  // پیشنهاد خرید: تیزفروش‌هایی که موجودی‌شان به اندازهٔ فروش ۳۰ روز نیست
  const sold = new Map<number, number>()
  recentSales?.forEach((s) => s.lines.forEach((l) => sold.set(l.variantId, (sold.get(l.variantId) ?? 0) + l.qty)))
  const productMap = new Map(products?.map((p) => [p.id!, p]))
  const suggestions = (variants ?? [])
    .map((v) => ({ v, p: productMap.get(v.productId), sold30: sold.get(v.id!) ?? 0 }))
    .filter((x) => x.p && x.sold30 > 0 && x.v.stockQty < x.sold30)
    .sort((a, b) => b.sold30 - b.v.stockQty - (a.sold30 - a.v.stockQty))
    .slice(0, 8)

  return (
    <>
      {suggestions.length > 0 && (
        <Card>
          <p className="mb-2 font-bold text-slate-700">💡 پیشنهاد خرید طبق فروش ۳۰ روز اخیر</p>
          {suggestions.map(({ v, p, sold30 }) => (
            <div key={v.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
              <span className="text-slate-700">
                {p!.name} {v.size} {v.color}
              </span>
              <span className="text-left text-xs">
                <span className="block font-bold text-red-600">مانده: {fmtNum(v.stockQty)}</span>
                <span className="text-slate-400">فروش ۳۰ روز: {fmtNum(sold30)}</span>
              </span>
            </div>
          ))}
          <p className="mt-2 text-xs text-slate-400">این اجناس تیزتر از موجودی‌شان می‌فروشند — برای خرید بعدی در نظر بگیرید.</p>
        </Card>
      )}

      <p className="mb-2 mt-2 font-bold text-slate-700">جنس‌های کاندید ({fmtNum(candidates?.length ?? 0)})</p>
      {candidates?.length === 0 && <Empty text="جنسی که در تلگرام/واتساپ دیدید و شاید بخرید را اینجا ثبت کنید." />}
      {candidates?.map((c) => (
        <Card key={c.id}>
          <div className="flex items-start gap-3">
            {c.photo ? (
              <img src={c.photo} alt="" className="h-14 w-14 rounded-lg object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-xl">👞</div>
            )}
            <div className="flex-1">
              <p className="font-bold text-slate-800">{c.name}</p>
              <p className="text-sm text-slate-600">
                {SOURCE_LABELS[c.source ?? 'other']}
                {c.shopName && <b> · {c.shopName}</b>}
              </p>
              {c.address && <p className="break-all text-xs text-slate-500">📍 {c.address}</p>}
              {c.phone && (
                <p className="text-xs text-slate-500" dir="ltr">
                  📞 {c.phone}
                </p>
              )}
              {c.note && <p className="text-xs text-slate-400">{c.note}</p>}
            </div>
            {(c.price ?? 0) > 0 && <p className="text-sm font-bold text-teal-700">{fmtMoney(c.price!)}</p>}
          </div>
          <div className="mt-2 flex gap-4">
            {confirmDel === c.id ? (
              <button className="text-xs font-bold text-red-600" onClick={() => void db.candidates.delete(c.id!)}>
                تأیید حذف؟
              </button>
            ) : (
              <button className="text-xs text-red-400" onClick={() => setConfirmDel(c.id!)}>
                حذف
              </button>
            )}
            <span className="mr-auto text-xs text-slate-400">{fmtDate(c.createdAt)}</span>
          </div>
        </Card>
      ))}
      <Fab onClick={() => setShowNew(true)} label="کاندید جدید" />
      {showNew && <NewCandidateModal onClose={() => setShowNew(false)} />}
    </>
  )
}

function NewCandidateModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [source, setSource] = useState<Candidate['source']>('telegram')
  const [shopName, setShopName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<string | undefined>(undefined)

  async function pickPhoto(f: File) {
    const url = URL.createObjectURL(f)
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image()
        i.onload = () => res(i)
        i.onerror = rej
        i.src = url
      })
      const max = 800
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      setPhoto(canvas.toDataURL('image/jpeg', 0.75))
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  return (
    <Modal title="جنس کاندید جدید" onClose={onClose}>
      <div className="mb-3 flex items-center gap-3">
        {photo ? (
          <img src={photo} alt="" className="h-14 w-14 rounded-xl object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-2xl">👞</div>
        )}
        <label className="cursor-pointer rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">
          📷 عکس / اسکرین‌شات
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void pickPhoto(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <Field label="نام جنس *">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً اسکچرز مودل نو" />
      </Field>
      <Field label="کجا دیدید؟">
        <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value as Candidate['source'])}>
          <option value="telegram">📨 تلگرام</option>
          <option value="whatsapp">💬 واتساپ</option>
          <option value="market">🏪 بازار</option>
          <option value="other">دیگر</option>
        </select>
      </Field>
      <Field label="نام فروشگاه">
        <input className={inputCls} value={shopName} onChange={(e) => setShopName(e.target.value)} />
      </Field>
      <Field label={source === 'telegram' ? 'آدرس / لینک کانال' : source === 'whatsapp' ? 'آدرس فروشگاه' : 'آدرس'}>
        <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="لینک یا آدرس..." />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="شماره تماس">
          <input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="قیمت تخمینی">
          <input className={inputCls} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      <Field label="یادداشت">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="سایزها، رنگ، شرایط..." />
      </Field>
      <PrimaryBtn
        disabled={!name.trim()}
        onClick={async () => {
          await db.candidates.add({
            name: name.trim(),
            source,
            shopName: shopName.trim() || undefined,
            address: address.trim() || undefined,
            phone: phone.trim() || undefined,
            price: parseNum(price) || undefined,
            note: note.trim() || undefined,
            photo,
            createdAt: Date.now()
          })
          onClose()
        }}
      >
        ذخیره
      </PrimaryBtn>
    </Modal>
  )
}

export default CandidatesView
