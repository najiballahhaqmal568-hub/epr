import type { Purchase, PurchaseLine, Sale, SaleLine } from '../db'

export type CommercialSaleLine = Omit<SaleLine, 'variantId'> & { variantId?: number; lineUuid?: string }
export type CommercialPurchaseLine = Omit<PurchaseLine, 'variantId'> & { variantId?: number; lineUuid?: string }

export function commercialSaleLines(sale: Sale): ReadonlyArray<CommercialSaleLine> {
  if (!sale.directLines) return sale.lines
  return sale.directLines.map(({ lineUuid, productName, size, color, qty, unitPrice, unitCost }) => ({
    lineUuid, productName, size, color, qty, unitPrice, unitCost
  }))
}

export function commercialPurchaseLines(purchase: Purchase): ReadonlyArray<CommercialPurchaseLine> {
  if (!purchase.directLines) return purchase.lines
  return purchase.directLines.map(({ lineUuid, productName, size, color, qty, unitCost }) => ({
    lineUuid, productName, size, color, qty, unitCost
  }))
}
