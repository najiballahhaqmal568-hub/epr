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

async function pushTable(
  table: SyncTable,
  shopId: string,
  deviceId: string,
  generation: number,
  mergeOnly: boolean
): Promise<number> {
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
      generation,
      device_id: deviceId,
      deleted: Boolean(r.deleted),
      data: await encodeRefs(table, r)
    })
  }
  const { error } = await supa.from(REMOTE[table]).upsert(payload, {
    onConflict: 'uuid',
    // Safe merge adds backup rows that are absent from the server, while the
    // current server copy wins whenever the same uuid already exists.
    ignoreDuplicates: mergeOnly
  })
  if (error) throw new Error(`${table}: ${error.message}`)
  await setState(`push:${table}`, scanStart)
  return payload.length
}

async function pullTable(table: SyncTable, deviceId: string, generation: number): Promise<number> {
  const supa = (await getSupa())!
  const cursor = ((await getState(`pull:${table}`)) as string | undefined) ?? '1970-01-01T00:00:00Z'
  const { data, error } = await supa
    .from(REMOTE[table])
    .select('*')
    .eq('generation', generation)
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

async function currentGeneration(shopId: string): Promise<number> {
  const supa = (await getSupa())!
  const { data, error } = await supa.from('shops').select('restore_generation').eq('id', shopId).single()
  if (error) throw new Error(`shops: ${error.message}`)
  return Number(data.restore_generation ?? 0)
}

async function clearForGeneration(shopId: string, generation: number): Promise<void> {
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.syncState], async () => {
    for (const table of SYNC_TABLES) await db.table(table).clear()
    await db.syncState.clear()
    await db.syncState.bulkPut([
      { key: 'cloudShopId', value: shopId },
      { key: 'restoreGeneration', value: generation }
    ])
  })
}

export function shouldResetForGeneration(
  localShop: string | undefined,
  localGeneration: number | undefined,
  remoteShop: string,
  remoteGeneration: number,
  hasSyncHistory: boolean
): boolean {
  if (localShop && localShop !== remoteShop) return true
  if (localGeneration !== undefined) return localGeneration !== remoteGeneration

  // A device that synchronized with an older app version has cursors but no
  // stored generation. Once the server generation is above zero, its local
  // rows predate a full restore and must not be uploaded into the new snapshot.
  return remoteGeneration > 0 && hasSyncHistory
}

/**
 * A full restore increments the shop generation. Every updated device then
 * discards its stale synchronized tables before it can push them back.
 */
async function ensureGeneration(shopId: string): Promise<number> {
  const generation = await currentGeneration(shopId)
  const localShop = (await getState('cloudShopId')) as string | undefined
  const localGeneration = (await getState('restoreGeneration')) as number | undefined
  const hasSyncHistory =
    localGeneration === undefined &&
    (await db.syncState.filter((row) => row.key.startsWith('push:') || row.key.startsWith('pull:')).count()) > 0

  if (shouldResetForGeneration(localShop, localGeneration, shopId, generation, hasSyncHistory)) {
    await clearForGeneration(shopId, generation)
  } else {
    await setState('cloudShopId', shopId)
    await setState('restoreGeneration', generation)
  }
  return generation
}

export async function pauseSyncForRestore(): Promise<void> {
  stopSync()
  const deadline = Date.now() + 30_000
  while (syncing && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  if (syncing) throw new Error('همگام‌سازی هنوز روان است؛ چند لحظه بعد دوباره کوشش کنید')
}

export async function hasPendingCloudRestore(): Promise<boolean> {
  return Boolean(await getState('restorePending'))
}

interface RestoreStageRow {
  batch_id: string
  shop_id: string
  table_name: string
  uuid: string
  device_id: string
  deleted: boolean
  data: Record<string, unknown>
}

/**
 * Keep PostgREST requests small enough for backups that contain product photos.
 * A single large row is still sent by itself so the server can return a useful
 * size error instead of silently omitting it.
 */
function restoreChunks(rows: RestoreStageRow[], maxBytes = 400_000, maxRows = 100): RestoreStageRow[][] {
  const chunks: RestoreStageRow[][] = []
  let chunk: RestoreStageRow[] = []
  let bytes = 2
  for (const row of rows) {
    const rowBytes = JSON.stringify(row).length + 1
    if (chunk.length && (chunk.length >= maxRows || bytes + rowBytes > maxBytes)) {
      chunks.push(chunk)
      chunk = []
      bytes = 2
    }
    chunk.push(row)
    bytes += rowBytes
  }
  if (chunk.length) chunks.push(chunk)
  return chunks
}

/**
 * Upload the complete local backup into an isolated staging area, then ask
 * PostgreSQL to verify and activate it in one transaction. Until commit, the
 * live cloud generation is untouched and other devices continue seeing the
 * previous complete snapshot.
 */
export async function replaceCloudWithLocalSnapshot(): Promise<{ shopId: string; generation: number }> {
  const supa = await getSupa()
  if (!supa) throw new Error('سرور تنظیم نشده')
  const profile = await getProfile()
  if (!profile || profile.role !== 'owner') throw new Error('فقط مالک می‌تواند همهٔ موبایل‌ها را با بکاپ عوض کند')
  const deviceId = await getDeviceId()
  const snapshotStartedAt = Date.now()
  const expectedCounts: Record<string, number> = {}
  const stagedByTable = new Map<SyncTable, RestoreStageRow[]>()

  // Build and encode the entire snapshot before creating a server batch. This
  // catches malformed local records while the old cloud copy is still live.
  for (const table of SYNC_TABLES) {
    const staged: RestoreStageRow[] = []
    for (const row of await db.table(table).toArray()) {
      if (!row.uuid) throw new Error(`بکاپ ناقص است: شناسهٔ ${table} یافت نشد`)
      staged.push({
        batch_id: '',
        shop_id: profile.shop_id,
        table_name: REMOTE[table],
        uuid: row.uuid,
        device_id: deviceId,
        deleted: Boolean(row.deleted),
        data: await encodeRefs(table, row)
      })
    }
    expectedCounts[REMOTE[table]] = staged.length
    stagedByTable.set(table, staged)
  }

  let batchId: string | null = null
  try {
    const { data: begun, error: beginError } = await supa.rpc('begin_shop_restore_batch', {
      requested_counts: expectedCounts
    })
    if (beginError) throw new Error(`آماده‌سازی سرور: ${beginError.message}`)
    batchId = String(begun ?? '')
    if (!batchId) throw new Error('سرور شمارهٔ جایگزینی را نداد')

    for (const table of SYNC_TABLES) {
      const rows = (stagedByTable.get(table) ?? []).map((row) => ({ ...row, batch_id: batchId! }))
      for (const chunk of restoreChunks(rows)) {
        const { error } = await supa.from('restore_staging').insert(chunk)
        if (error) throw new Error(`فرستادن ${REMOTE[table]}: ${error.message}`)
      }
    }

    const { data: committed, error: commitError } = await supa.rpc('commit_shop_restore_batch', {
      target_batch: batchId
    })
    if (commitError) throw new Error(`فعال‌سازی بکاپ: ${commitError.message}`)
    const generation = Number(committed)
    if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('نسخهٔ تازهٔ سرور معتبر نیست')

    const stateRows = [
      { key: 'cloudShopId', value: profile.shop_id },
      { key: 'restoreGeneration', value: generation },
      // Rows modified after snapshotStartedAt must still be sent normally.
      ...SYNC_TABLES.map((table) => ({ key: `push:${table}`, value: snapshotStartedAt - 1 }))
    ]
    await db.syncState.bulkPut(stateRows)
    await db.syncState.delete('restorePending')
    return { shopId: profile.shop_id, generation }
  } catch (error) {
    if (batchId) {
      // Abort only removes isolated staging rows; the previous live cloud copy
      // remains untouched even if this cleanup request itself cannot connect.
      try {
        await supa.rpc('abort_shop_restore_batch', { target_batch: batchId })
      } catch {
        // The next begin call also removes abandoned pending batches.
      }
    }
    throw error
  }
}

export async function syncNow(throwOnError = false): Promise<void> {
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
    if (await hasPendingCloudRestore()) {
      throw new Error('جایگزینی بکاپ نیمه‌تمام است؛ همان فایل بکاپ را دوباره جایگزین کنید')
    }
    const profile = await getProfile()
    if (!profile) throw new Error('پروفایل یافت نشد')
    const generation = await ensureGeneration(profile.shop_id)
    const deviceId = await getDeviceId()
    const mergeOnly = (await getState('restorePushMode')) === 'merge'
    for (const t of SYNC_TABLES) await pushTable(t, profile.shop_id, deviceId, generation, mergeOnly)
    await db.syncState.delete('restorePushMode')
    for (const t of SYNC_TABLES) await pullTable(t, deviceId, generation)
    setStatus({ state: 'ok', lastSync: Date.now(), message: undefined })
  } catch (e) {
    setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    if (throwOnError) throw e
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
