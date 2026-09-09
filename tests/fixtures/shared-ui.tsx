import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Card, Empty, Fab, Field, inputCls, Modal, PrimaryBtn } from '../../src/components/ui'
import { accessFlags } from '../../src/db'
import { FONT_SCALES, setFontScale } from '../../src/lib/fontScale'
import '../../src/index.css'

// Local-only fixture: actual shared controls, no application/auth/sync bootstrap.
function Fixture() {
  const [modal, setModal] = useState(false)
  const [nested, setNested] = useState(false)
  const [parent, setParent] = useState(0)
  const [child, setChild] = useState(0)
  const [commits, setCommits] = useState(0)
  const [readOnly, setReadOnly] = useState(false)
  return <main className="mx-auto max-w-2xl p-4 pb-32">
    <header className="page-heading"><div><h1>حساب فروشگاه</h1><p>آزمایش محلی اجزای مشترک — معلومات ساختگی</p></div></header>
    <Field label="اندازهٔ نوشته"><select className={inputCls} defaultValue="md" onChange={e => setFontScale(e.target.value as 'sm' | 'md' | 'lg' | 'xl')}>
      {FONT_SCALES.map(scale => <option key={scale.id} value={scale.id}>{scale.label}</option>)}
    </select></Field>
    <Card><h2 className="mb-3 font-bold">معلومات حساب</h2>
      <Field label="نام مشتری"><input className={inputCls} placeholder="نام کامل مشتری" /></Field>
      <Field label="مبلغ به افغانی"><input className={inputCls} type="number" defaultValue="123456789.50" /></Field>
      <Field label="یادداشت"><textarea className={inputCls} defaultValue="یادداشت طولانی برای بررسی خوانایی نوشته‌های دری و شکستن سطرها در صفحهٔ کوچک" /></Field>
      <div className="summary-strip"><div><dt>بستانکار</dt><dd className="text-teal-700">۱۲۳٬۴۵۶</dd></div><div><dt>قرضدار</dt><dd className="text-red-600">۷۸٬۹۰۰</dd></div></div>
      <PrimaryBtn onClick={() => setModal(true)}>باز کردن جزئیات</PrimaryBtn>
      <div className="mt-3"><PrimaryBtn disabled onClick={() => setCommits(n => n + 1)}>ثبت غیرفعال</PrimaryBtn></div>
    </Card>
    <section data-testid="interactive-card"><Card onClick={() => setParent(n => n + 1)}>
      <p>جزئیات مشتری آزمایشی با نام طولانی برای بررسی شکستن سطر</p>
      <button className="mt-2 rounded-xl bg-slate-100 px-3" onClick={() => setChild(n => n + 1)}><span>پرداخت مستقل</span></button>
    </Card></section>
    <section data-testid="static-card"><Card>این کارت فقط معلومات را نشان می‌دهد و دکمه نیست.</Card></section>
    <section data-testid="money-card"><Card><div className="flex items-center justify-between gap-3">
      <p data-testid="card-prose">مشتری آزمایشی با نام خانوادگی طولانی</p><p data-testid="card-money" className="font-bold text-teal-700">۱۲۳٬۴۵۶</p>
    </div></Card></section>
    <button className="account-row surface mb-3"><span data-testid="button-prose">مشتری آزمایشی با نام خانوادگی طولانی</span><span data-testid="button-money" className="font-bold text-red-600">۱۲۳٬۴۵۶</span></button>
    <output data-testid="counts">{parent},{child},{commits}</output>
    <label className="mt-3 flex items-center gap-3"><input type="checkbox" checked={readOnly} onChange={e => { accessFlags.readOnly = e.target.checked; setReadOnly(e.target.checked) }} />فقط مشاهده</label>
    <Empty text="هنوز معامله‌ای ثبت نشده است." />
    <Fab onClick={() => setModal(true)} />
    {modal && <Modal title="جزئیات حساب مشتری آزمایشی با نام طولانی" onClose={() => setModal(false)}>
      <Field label="یادداشت جزئیات"><input className={inputCls} defaultValue="معلومات آزمایشی" /></Field>
      <button onClick={() => setNested(true)}>جزئیات بیشتر</button>
      <PrimaryBtn onClick={() => setModal(false)}>تمام شد</PrimaryBtn>
      {nested && <Modal title="جزئیات بیشتر" onClose={() => setNested(false)}><p>یادداشت محلی</p></Modal>}
    </Modal>}
  </main>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
