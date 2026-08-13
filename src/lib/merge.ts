/**
 * یکجا کردن اجناس تکراری.
 *
 * یک جنس (مثلاً «کوهستان») گاهی چند بار ثبت می‌شود چون یک بار کارتنی، یک بار
 * جوړه‌ای و یک بار بوجی وارد شده. بسته‌بندی هویت جنس نیست — موجودی همیشه به
 * جوړه شمرده می‌شود، پس این‌ها باید زیر یک نام بیایند.
 *
 * قاعدهٔ سخت: مجموع جوړه و ارزش گدام هرگز تغییر نمی‌کند.
 * برای همین هر انتقالِ موجودی با دو سند تعدیل ثبت می‌شود (منفی از مبدأ،
 * مثبت به مقصد) تا کنترل حساب‌ها و همگام‌سازی موبایل‌های دیگر هم درست بماند.
 */
import { weightedCost, applyRebuiltCosts } from './costing'
import { db, type Product, type Variant } from '../db'

/** کلمه‌هایی که فقط بسته‌بندی را می‌گویند، نه نام جنس را */
const PACK_WORDS = new Set([
  'کارتن',
  'کارتنی',
  'بوجی',
  'بوجه',
  'بوجیی',
  'جوړه',
  'جوړهای',
  'جوړهیی',
  'جوره',
  'جورهای',
  'جفت',
  'خرده',
  'فله',
  'ای',
  'یی',
  'ها'
])

/** نام را برای مقایسه ساده می‌کند: فاصله‌ها، ی/ك عربی و کلمه‌های بسته‌بندی */
export function normalizeName(raw: string): string {
  const cleaned = raw
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    // نیم‌فاصله حذف می‌شود تا «جوړه‌ای» یک کلمه شود
    .replace(/[‌‎‏]/g, '')
    .replace(/[.,،_\-()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return cleaned
    .split(' ')
    .filter((w) => w && !PACK_WORDS.has(w))
    .join(' ')
}

export interface DuplicateGroup {
  key: string
  products: Product[]
}

/** جنس‌هایی که بعد از ساده‌سازیِ نام یکی می‌شوند */
export function findDuplicateGroups(products: Product[]): DuplicateGroup[] {
  const map = new Map<string, Product[]>()
  for (const p of products) {
    if (p.deleted) continue
    const key = normalizeName(p.name)
    if (!key) continue
    const list = map.get(key) ?? []
    list.push(p)
    map.set(key, list)
  }
  return [...map.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, products: list }))
    .sort((a, b) => b.products.length - a.products.length)
}

const variantKey = (v: Variant) => `${v.size.trim()}|${v.color.trim()}`.toLowerCase()

export interface MergeResult {
  moved: number
  combined: number
  pairsBefore: number
  pairsAfter: number
}

/**
 * جنس‌های `sourceIds` را زیر `targetId` می‌آورد.
 * سایز+رنگ یکسان جمع می‌شود؛ سایز نو فقط جابه‌جا می‌شود (بدون تغییر موجودی).
 */
export async function mergeProducts(targetId: number, sourceIds: number[]): Promise<MergeResult> {
  // تکراری‌ها حذف می‌شوند — ورنه موجودی یک جنس دو بار جمع می‌شد
  const sources = [...new Set(sourceIds)].filter((id) => id !== targetId)
  if (sources.length === 0) return { moved: 0, combined: 0, pairsBefore: 0, pairsAfter: 0 }

  const result: MergeResult = { moved: 0, combined: 0, pairsBefore: 0, pairsAfter: 0 }

  await db.transaction('rw', [db.products, db.variants, db.adjustments, db.sales, db.purchases, db.returns], async () => {
    const target = await db.products.get(targetId)
    if (!target) throw new Error('جنس مقصد پیدا نشد')

    const all = await db.variants.filter((v) => !v.deleted).toArray()
    const targetVariants = all.filter((v) => v.productId === targetId)
    const byKey = new Map(targetVariants.map((v) => [variantKey(v), v]))
    result.pairsBefore = all
      .filter((v) => v.productId === targetId || sources.includes(v.productId))
      .reduce((s, v) => s + v.stockQty, 0)

    const now = Date.now()
    for (const srcId of sources) {
      const src = await db.products.get(srcId)
      for (const v of all.filter((x) => x.productId === srcId)) {
        const twin = byKey.get(variantKey(v))
        if (!twin) {
          // سایز نو — فقط زیر نام مقصد می‌آید، موجودی دست‌نخورده
          await db.variants.update(v.id!, { productId: targetId })
          byKey.set(variantKey(v), { ...v, productId: targetId })
          result.moved++
          continue
        }
        // سایز تکراری — موجودی جمع می‌شود، با دو سند (منفی از مبدأ، مثبت به مقصد)
        // تا کنترل حساب‌ها و موبایل دوم همان عدد را بسازند
        const qty = v.stockQty
        if (qty !== 0) {
          const note = `یکجا شدن با «${target.name}»`
          const move = (from: Variant, name: string, change: number, unitCost?: number) =>
            db.adjustments.add({
              date: now,
              variantId: from.id!,
              productName: name,
              size: from.size,
              color: from.color,
              qtyChange: change,
              reason: 'correction',
              note,
              ...(unitCost !== undefined ? { unitCost } : {})
            })
          await move(v, src?.name ?? '', -qty)
          // سند مقصد قیمتِ جنسی را که می‌آید با خود دارد، تا بازسازیِ قیمت
          // از روی اسناد همان میانگینی را بسازد که همین‌جا ساخته می‌شود
          await move(twin, target.name, qty, v.purchasePrice)
        }
        // قیمت خرید: میانگین وزنی (اگر قیمت‌ها یکی باشد همان می‌ماند)
        const total = twin.stockQty + qty
        // قیمت میانگین است نه پول، پس گرد نمی‌شود — وگرنه با بازسازی فرق می‌کند
        const price = weightedCost(twin.stockQty, twin.purchasePrice, qty, v.purchasePrice)
        await db.variants.update(twin.id!, {
          stockQty: total,
          purchasePrice: price,
          lastPurchaseAt: Math.max(twin.lastPurchaseAt ?? 0, v.lastPurchaseAt ?? 0) || undefined
        })
        // نسخهٔ در حافظه هم تازه می‌شود — اگر جنس سومی هم به همین سایز بیاید،
        // میانگینش باید روی عددِ نو حساب شود، نه عددِ کهنه
        twin.stockQty = total
        twin.purchasePrice = price
        await db.variants.update(v.id!, { stockQty: 0, deleted: true })
        result.combined++
      }
      // کارتن‌بندی مقصد اگر نبود، از مبدأ گرفته می‌شود
      if (!target.carton && src?.carton) {
        target.carton = src.carton
        await db.products.update(targetId, { carton: src.carton })
      }
      if (!target.pairsPerCarton && src?.pairsPerCarton) {
        target.pairsPerCarton = src.pairsPerCarton
        await db.products.update(targetId, { pairsPerCarton: src.pairsPerCarton })
      }
      if (!target.reorderAtCartons && src?.reorderAtCartons) {
        target.reorderAtCartons = src.reorderAtCartons
        await db.products.update(targetId, { reorderAtCartons: src.reorderAtCartons })
      }
      if (!target.photo && src?.photo) {
        target.photo = src.photo
        await db.products.update(targetId, { photo: src.photo })
      }
      await db.products.update(srcId, { deleted: true })
    }

    // قیمت تمام‌شده از روی اسناد بازسازی می‌شود — همان دو سندی که همین‌جا نوشتیم
    await applyRebuiltCosts()

    const after = await db.variants.filter((v) => !v.deleted && v.productId === targetId).toArray()
    result.pairsAfter = after.reduce((s, v) => s + v.stockQty, 0)
  })

  return result
}
