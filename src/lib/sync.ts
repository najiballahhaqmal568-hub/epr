import { useEffect, useState } from 'react'
import { applyRebuiltCosts } from './costing'
import { effectsOf, type DocTable } from './effects'
import { db, syncFlags, newUuid, SYNC_TABLES, landingSarrafOwed, type SyncTable, type Purchase } from '../db'
import { getSupa, getProfile } from './supa'

/** نام جدول‌ها در سرور (snake_case) */
const REMOTE: Record<SyncTable, string> = {
  products: 'products',
  variants: 'variants',
  customers: 'customers',
  suppliers: 'suppliers',
  sales: 'sales',
  purchases: 'purchases',
  payments: 'payments',
  expenseCategories: 'expense_categories',
  expenses: 'expenses',
  cashMovements: 'cash_movements',
  reconciliations: 'reconciliations',
  adjustments: 'adjustments',
  returns: 'returns'
}

export interface SyncStatus {
  state: 'off' | 'offline' | 'syncing' | 'ok' | 'error'
  lastSync: number | null
  pending: number
  message?: string
}

let status: SyncStatus = { state: 'off', lastSync: null, pending: 0 }
const listeners = new Set<() => void>()

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__syncStatus = status
  listeners.forEach((l) => l())
}

export function useSyncStatus(): SyncStatus {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((x) => x + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  return status
}

async function getState(key: string): Promise<unknown> {
  return (await db.syncState.get(key))?.value
}
async function setState(key: string, value: unknown): Promise<void> {
  await db.syncState.put({ key, value })
}

async function getDeviceId(): Promise<string> {
  let id = (await getState('deviceId')) as string | undefined
  if (!id) {
    id = newUuid()
    await setState('deviceId', id)
  }
  return id
}

/** نقشهٔ uuid ↔ id محلی برای یک جدول */
async function uuidMap(table: SyncTable): Promise<Map<string, number>> {
  const rows = await db.table(table).toArray()
  const m = new Map<string, number>()
  rows.forEach((r) => r.uuid && m.set(r.uuid, r.id))
  return m
}
async function idMap(table: SyncTable): Promise<Map<number, string>> {
  const rows = await db.table(table).toArray()
  const m = new Map<number, string>()
  rows.forEach((r) => r.uuid && m.set(r.id, r.uuid))
  return m
}

/** تبدیل ارجاع‌های عددی محلی به uuid قبل از ارسال */
async function encodeRefs(table: SyncTable, rec: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = { ...rec }
  delete out.id
  delete out.localUpdatedAt
  const enc = async (field: string, refTable: SyncTable, target: string) => {
    const v = out[field]
    if (typeof v === 'number') out[target] = (await idMap(refTable)).get(v) ?? null
  }
  if (table === 'variants') await enc('productId', 'products', 'productUuid')
  if (table === 'sales') await enc('customerId', 'customers', 'customerUuid')
  if (table === 'purchases') {
    await enc('supplierId', 'suppliers', 'supplierUuid')
    await enc('sarrafId', 'suppliers', 'sarrafUuid')
    await enc('landingSarrafId', 'suppliers', 'landingSarrafUuid')
  }
  if (table === 'expenses') await enc('categoryId', 'expenseCategories', 'categoryUuid')
  if (table === 'adjustments') await enc('variantId', 'variants', 'variantUuid')
  if (table === 'payments' || table === 'returns') {
    const kind = (out.partyType ?? out.kind) as string
    await enc('partyId', kind === 'customer' ? 'customers' : 'suppliers', 'partyUuid')
  }
  if (table === 'payments') await enc('sarrafId', 'suppliers', 'sarrafUuid')
  if ('lines' in out && Array.isArray(out.lines)) {
    const vmap = await idMap('variants')
    out.lines = (out.lines as Array<Record<string, unknown>>).map((l) => ({
      ...l,
      variantUuid: typeof l.variantId === 'number' ? (vmap.get(l.variantId) ?? null) : null
    }))
  }
  return out
}

/** تبدیل uuid ها به id محلی هنگام دریافت */
async function decodeRefs(table: SyncTable, rec: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = { ...rec }
  const dec = async (target: string, refTable: SyncTable, field: string) => {
    const u = out[target]
    if (typeof u === 'string') {
      const local = (await uuidMap(refTable)).get(u)
      if (local !== undefined) out[field] = local
    }
  }
  if (table === 'variants') await dec('productUuid', 'products', 'productId')
  if (table === 'sales') await dec('customerUuid', 'customers', 'customerId')
  if (table === 'purchases') {
    await dec('supplierUuid', 'suppliers', 'supplierId')
    await dec('sarrafUuid', 'suppliers', 'sarrafId')
    await dec('landingSarrafUuid', 'suppliers', 'landingSarrafId')
  }
  if (table === 'expenses') await dec('categoryUuid', 'expenseCategories', 'categoryId')
  if (table === 'adjustments') await dec('variantUuid', 'variants', 'variantId')
  if (table === 'payments' || table === 'returns') {
    const kind = (out.partyType ?? out.kind) as string
    await dec('partyUuid', kind === 'customer' ? 'customers' : 'suppliers', 'partyId')
  }
  if (table === 'payments') await dec('sarrafUuid', 'suppliers', 'sarrafId')
  if ('lines' in out && Array.isArray(out.lines)) {
    const vmap = await uuidMap('variants')
    out.lines = (out.lines as Array<Record<string, unknown>>).map((l) => {
      const local = typeof l.variantUuid === 'string' ? vmap.get(l.variantUuid) : undefined
      return { ...l, variantId: local ?? l.variantId }
    })
  }
  return out
}

const MASTERS: SyncTable[] = ['products', 'variants', 'customers', 'suppliers', 'expenseCategories']

/**
 * اعمال اثرات جانبی یک سند دریافتی (گدام/قرض) — پول نقد سند جداگانه دارد.
 * قاعده‌ها اینجا نوشته نمی‌شوند؛ همه از lib/effects.ts می‌آیند تا با
 * «کنترل حساب‌ها» و با ops.ts هرگز فرق نکنند.
 */
export async function applyDocEffects(table: SyncTable, rec: Record<string, unknown>, reverse: boolean) {
  const sign = reverse ? -1 : 1
  for (const e of effectsOf(table as DocTable, rec)) {
    const row = await db.table(e.table).get(e.id!)
    if (row) await db.table(e.table).update(e.id!, { [e.field]: (row[e.field] ?? 0) + e.delta * sign })
  }
}

async function pushTable(table: SyncTable, shopId: string, deviceId: string): Promise<number> {
  const supa = (await getSupa())!
  const cursor = ((await getState(`push:${table}`)) as number | undefined) ?? 0
  const scanStart = Date.now()
  const rows = await db.table(table).where('localUpdatedAt').above(cursor).toArray()
  if (!rows.length) return 0
  const payload = []
  for (const r of rows) {
    if (!r.uuid) continue
    payload.push({
      uuid: r.uuid,
      shop_id: shopId,
      device_id: deviceId,
      deleted: Boolean(r.deleted),
      data: await encodeRefs(table, r)
    })
  }
  const { error } = await supa.from(REMOTE[table]).upsert(payload, { onConflict: 'uuid' })
  if (error) throw new Error(`${table}: ${error.message}`)
  await setState(`push:${table}`, scanStart)
  return payload.length
}

async function pullTable(table: SyncTable, deviceId: string): Promise<number> {
  const supa = (await getSupa())!
  const cursor = ((await getState(`pull:${table}`)) as string | undefined) ?? '1970-01-01T00:00:00Z'
  const { data, error } = await supa
    .from(REMOTE[table])
    .select('*')
    .gt('updated_at', cursor)
    .order('updated_at', { ascending: true })
    .limit(1000)
  if (error) throw new Error(`${table}: ${error.message}`)
  if (!data?.length) return 0
  let applied = 0
  for (const row of data) {
    if (row.device_id !== deviceId) {
      await applyRemoteRow(table, row)
      applied++
    }
    await setState(`pull:${table}`, row.updated_at)
  }
  return applied
}

async function applyRemoteRow(table: SyncTable, row: { uuid: string; deleted: boolean; data: Record<string, unknown> }) {
  const rec = await decodeRefs(table, row.data)
  rec.uuid = row.uuid
  rec.deleted = row.deleted
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t))], async () => {
    syncFlags.applyingRemote = true
    try {
      const existing = await db.table(table).where('uuid').equals(row.uuid).first()
      if (MASTERS.includes(table)) {
        if (existing) {
          // فیلدهای مشتقی (موجودی/قرض) محلی را نگه می‌داریم — اسناد آن‌ها را اصلاح می‌کنند
          if (table === 'variants') rec.stockQty = existing.stockQty
          if (table === 'customers' || table === 'suppliers') rec.balance = existing.balance
          await db.table(table).update(existing.id, { ...rec, id: existing.id })
        } else {
          delete rec.id
          // مقادیر مشتقی همیشه از اسناد بازسازی می‌شوند
          if (table === 'variants') rec.stockQty = 0
          if (table === 'customers' || table === 'suppliers') rec.balance = 0
          await db.table(table).add(rec)
        }
      } else {
        if (!existing) {
          delete rec.id
          const wasDeleted = Boolean(rec.deleted)
          await db.table(table).add(rec)
          if (!wasDeleted) await applyDocEffects(table, rec, false)
        } else if (row.deleted && !existing.deleted) {
          await db.table(table).update(existing.id, { deleted: true })
          await applyDocEffects(table, existing as unknown as Record<string, unknown>, true)
        } else if (table === 'purchases') {
          // رسیدِ جنس (موجودی از سند تعدیل می‌آید) و
          // مصارف رسیدن بعد از تحویل ثبت/پرداخت می‌شود — سهم آن در قیمت تمام‌شده اینجا اعمال می‌گردد
          const inc = rec as unknown as Purchase
          const oldLanding = (existing as Purchase).landingCost ?? 0
          const newLanding = inc.landingCost ?? 0
          if (newLanding !== oldLanding) {
            const deltaSarraf = landingSarrafOwed(inc as unknown as Purchase) - landingSarrafOwed(existing as Purchase)
            if (deltaSarraf > 0 && typeof inc.landingSarrafId === 'number') {
              const sf = await db.suppliers.get(inc.landingSarrafId)
              if (sf) await db.suppliers.update(inc.landingSarrafId, { balance: sf.balance + deltaSarraf })
            }
          }
          await db.table(table).update(existing.id, {
            ...(inc.received !== false ? { received: true, receivedAt: inc.receivedAt ?? Date.now() } : {}),
            landingCost: newLanding || undefined,
            landingUnpaid: inc.landingUnpaid,
            landingVia: inc.landingVia,
            landingPaid: inc.landingPaid,
            landingSarrafId: inc.landingSarrafId,
            landingSarrafName: inc.landingSarrafName,
            landingSarrafAmount: inc.landingSarrafAmount
          })
          // قیمت تمام‌شده از اسناد بازسازی می‌شود — نه با جمعِ تدریجی که با ops فرق داشت
          await applyRebuiltCosts()
        }
      }
    } finally {
      syncFlags.applyingRemote = false
    }
  })
}

let syncing = false
let timer: ReturnType<typeof setInterval> | null = null

export async function syncNow(): Promise<void> {
  if (syncing) return
  const supa = await getSupa()
  if (!supa) {
    setStatus({ state: 'off' })
    return
  }
  const { data: auth } = await supa.auth.getSession()
  if (!auth.session) {
    setStatus({ state: 'off' })
    return
  }
  if (!navigator.onLine) {
    setStatus({ state: 'offline' })
    return
  }
  syncing = true
  setStatus({ state: 'syncing' })
  try {
    const profile = await getProfile()
    if (!profile) throw new Error('پروفایل یافت نشد')
    const deviceId = await getDeviceId()
    for (const t of SYNC_TABLES) await pushTable(t, profile.shop_id, deviceId)
    for (const t of SYNC_TABLES) await pullTable(t, deviceId)
    setStatus({ state: 'ok', lastSync: Date.now(), message: undefined })
  } catch (e) {
    setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) })
  } finally {
    syncing = false
  }
}

export function startSync(): void {
  if (timer) return
  void syncNow()
  timer = setInterval(() => void syncNow(), 30_000)
  window.addEventListener('online', () => void syncNow())
  window.addEventListener('focus', () => void syncNow())
}

export function stopSync(): void {
  if (timer) clearInterval(timer)
  timer = null
}
