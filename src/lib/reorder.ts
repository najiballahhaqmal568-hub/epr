import type { Product, Variant } from '../db'

export const DEFAULT_PAIRS_PER_CARTON = 12
export const DEFAULT_REORDER_CARTONS = 1

const positiveWhole = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) && value! > 0 ? Math.max(1, Math.round(value!)) : fallback

/** تعداد جفتی که برای هشدار خرید، یک کارتن این جنس شمرده می‌شود. */
export function pairsPerCartonOf(product: Product): number {
  if (product.pairsPerCarton) return positiveWhole(product.pairsPerCarton, DEFAULT_PAIRS_PER_CARTON)
  const templatePairs = product.carton?.items.reduce((sum, item) => sum + item.qty, 0) ?? 0
  return positiveWhole(templatePairs, DEFAULT_PAIRS_PER_CARTON)
}

export function reorderCartonsOf(product: Product): number {
  return positiveWhole(product.reorderAtCartons, DEFAULT_REORDER_CARTONS)
}

export interface ProductReorderInfo {
  product: Product
  variants: Variant[]
  stockPairs: number
  pairsPerCarton: number
  reorderCartons: number
  thresholdPairs: number
  fullCartons: number
  loosePairs: number
  needsReorder: boolean
}

/**
 * هشدار خرید برای کل جنس است: همهٔ رنگ‌ها و سایزهای آن یکجا حساب می‌شوند.
 * موجودی هر سایز جدا می‌ماند و فقط تصمیم خرید کارتنی است.
 */
export function productReorderInfo(product: Product, variants: Variant[]): ProductReorderInfo {
  const active = variants.filter((variant) => !variant.deleted && variant.productId === product.id)
  const stockPairs = active.reduce((sum, variant) => sum + variant.stockQty, 0)
  const pairsPerCarton = pairsPerCartonOf(product)
  const reorderCartons = reorderCartonsOf(product)
  return {
    product,
    variants: active,
    stockPairs,
    pairsPerCarton,
    reorderCartons,
    thresholdPairs: pairsPerCarton * reorderCartons,
    fullCartons: Math.floor(stockPairs / pairsPerCarton),
    loosePairs: stockPairs % pairsPerCarton,
    needsReorder: active.length > 0 && stockPairs <= pairsPerCarton * reorderCartons
  }
}

export function reorderProducts(products: Product[], variants: Variant[]): ProductReorderInfo[] {
  return products
    .filter((product) => !product.deleted)
    .map((product) => productReorderInfo(product, variants))
    .filter((info) => info.needsReorder)
    .sort((a, b) => a.stockPairs / a.thresholdPairs - b.stockPairs / b.thresholdPairs)
}
