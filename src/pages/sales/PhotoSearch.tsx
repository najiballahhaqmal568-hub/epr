import { useRef, useState, type ChangeEvent } from 'react'
import type { Product, Variant } from '../../db'
import { fmtMoney, fmtNum } from '../../lib/format'
import { findByPhoto, type PhotoMatch, type PhotoMethod } from '../../lib/photoMatch'
import { downscalePhoto } from '../inventory/helpers'

type Entry = { p: Product; vs: Variant[]; stock: number }

type State =
  | { kind: 'idle' }
  | { kind: 'working'; done: number; total: number }
  | { kind: 'results'; shot: string; matches: PhotoMatch[]; withoutPhoto: number; method: PhotoMethod }
  | { kind: 'error'; message: string; detail?: string }

/**
 * 📷 در میز فروش: از کفش عکس بگیرید، سه بوت شبیه با عکس، قیمت و موجودی‌شان می‌آید، بوت درست را لمس کنید.
 * این‌جا هیچ چیزی به سبد نمی‌رود — فقط onPick با لمس فروشنده.
 */
export default function PhotoSearch<E extends Entry>({ entries, saleType, onPick }: {
  entries: E[]
  saleType: 'retail' | 'wholesale'
  onPick: (entry: E, el: HTMLElement) => void
}) {
  const camera = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const busy = state.kind === 'working'
  const byId = new Map(entries.map((e) => [e.p.id!, e]))
  const withPhoto = entries.filter((e) => e.p.photo).length

  async function shoot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = '' // همان عکس دوباره هم انتخاب شود
    if (!file || busy) return
    if (!withPhoto) return setState({ kind: 'error', message: 'هیچ بوتی در گدام عکس ندارد. اول در «گدام» برای بوت‌ها عکس بگذارید؛ تا آن وقت با نام جستجو کنید.' })
    setState({ kind: 'working', done: 0, total: 0 })
    let shot: string
    try {
      shot = await downscalePhoto(file)
    } catch {
      return setState({ kind: 'error', message: 'عکس باز نشد. دوباره عکس بگیرید.' })
    }
    try {
      const result = await findByPhoto(shot, entries.map((e) => e.p), (done, total) => setState({ kind: 'working', done, total }))
      setState({ kind: 'results', shot, ...result })
    } catch (error) {
      // متن اصلی خطا هم نشان داده می‌شود: عکس صفحه از گوشی دکان علت را می‌گوید
      setState({ kind: 'error', message: 'بوت با عکس پیدا نشد. یک بار دیگر عکس بگیرید؛ تا آن وقت با نام جستجو کنید.', detail: error instanceof Error ? error.message : String(error) })
    }
  }

  const priceOf = (v: Variant) => (saleType === 'retail' ? v.retailPrice : v.wholesalePrice)

  return <div className="sale-photo-search mb-3">
    <button type="button" className="sale-photo-button" disabled={busy} onClick={() => camera.current?.click()}>
      📷 پیدا کردن بوت با عکس
    </button>
    <input ref={camera} aria-label="فایل کامره برای جستجو" type="file" accept="image/*" capture="environment" className="hidden" onChange={shoot} />
    {state.kind === 'working' && <p role="status" className="mt-2 text-sm text-slate-600">
      {state.total > 0 && state.done < state.total
        ? `در حال آماده‌کردن عکس‌های گدام: ${fmtNum(state.done)} از ${fmtNum(state.total)} (فقط بار اول طول می‌کشد)`
        : 'در حال پیدا کردن بوت…'}
    </p>}
    {state.kind === 'error' && <div role="alert" className="mt-2 rounded-xl bg-red-50 p-2.5 text-sm text-red-700">
      <p>{state.message}</p>
      {state.detail && <p dir="ltr" className="mt-1 break-words text-left text-xs opacity-80">{state.detail}</p>}
    </div>}
    {state.kind === 'results' && <section className="sale-photo-results mt-2" aria-label="بوت‌های شبیه عکس">
      <div className="sale-photo-results-head">
        <img src={state.shot} alt="عکسی که گرفتید" className="sale-photo-shot" />
        <p className="min-w-0 flex-1 text-sm font-bold">بوت درست را لمس کنید</p>
        <button type="button" className="sale-secondary-action" onClick={() => setState({ kind: 'idle' })}>بستن</button>
      </div>
      {state.matches.map((m) => {
        const e = byId.get(m.productId)
        if (!e) return null
        const inStock = e.vs.filter((v) => v.stockQty > 0)
        const prices = (inStock.length ? inStock : e.vs).map(priceOf)
        return <button
          key={m.productId}
          type="button"
          className="sale-photo-match"
          aria-label={`${e.p.name} — ${fmtNum(Math.max(0, e.stock))} جوړه — ${fmtMoney(Math.min(...prices))}`}
          onClick={(ev) => { onPick(e, ev.currentTarget); setState({ kind: 'idle' }) }}
        >
          <img src={e.p.photo} alt="" className="sale-photo-thumb" />
          <span className="min-w-0 flex-1 text-right">
            <b className="block break-words">{e.p.name}</b>
            <span className="block text-sm text-slate-600">{e.stock > 0 ? `${fmtNum(e.stock)} جوړه در گدام` : 'در گدام ختم شده'}</span>
          </span>
          <span className="shrink-0 font-bold">{fmtMoney(Math.min(...prices))}</span>
        </button>
      })}
      <p className="mt-2 text-xs text-slate-600">اگر بوت درست این‌جا نیست، نامش را در جستجو بنویسید.</p>
      {state.method === 'basic' && <p className="mt-1 text-xs text-slate-600">این گوشی ابزار کامل شناختن عکس را ندارد؛ بوت‌ها با رنگ و شکل مقایسه شدند. پیش از لمس، عکس را با دقت ببینید.</p>}
      {state.withoutPhoto > 0 && <p className="mt-1 text-xs text-slate-600">{fmtNum(state.withoutPhoto)} بوت در گدام عکس ندارد و با عکس پیدا نمی‌شود.</p>}
    </section>}
  </div>
}
