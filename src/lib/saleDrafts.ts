import { type SaleLine } from '../db'
import { parseNum } from './format'

const STORAGE_KEY = 'epr_sale_drafts_v1'
const MAX_DRAFTS = 20

export interface SaleDraft {
  id: string
  createdAt: number
  updatedAt: number
  saleType: 'retail' | 'wholesale'
  customerId?: number
  lines: SaleLine[]
  paidStr: string
  paidTouched: boolean
  discountStr: string
  promise: string
  bookPage: string
}

export type SaleDraftInput = Omit<SaleDraft, 'id' | 'createdAt' | 'updatedAt'>

function validLine(value: unknown): value is SaleLine {
  if (!value || typeof value !== 'object') return false
  const line = value as Partial<SaleLine>
  return (
    typeof line.variantId === 'number' &&
    Number.isFinite(line.variantId) &&
    typeof line.productName === 'string' &&
    typeof line.size === 'string' &&
    typeof line.color === 'string' &&
    typeof line.qty === 'number' &&
    Number.isFinite(line.qty) &&
    line.qty > 0 &&
    typeof line.unitPrice === 'number' &&
    Number.isFinite(line.unitPrice) &&
    line.unitPrice >= 0
  )
}

function normalizeDraft(value: unknown): SaleDraft | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Partial<SaleDraft>
  if (
    typeof draft.id !== 'string' ||
    !draft.id ||
    typeof draft.createdAt !== 'number' ||
    !Number.isFinite(draft.createdAt) ||
    typeof draft.updatedAt !== 'number' ||
    !Number.isFinite(draft.updatedAt) ||
    (draft.saleType !== 'retail' && draft.saleType !== 'wholesale') ||
    !Array.isArray(draft.lines) ||
    !draft.lines.every(validLine)
  ) {
    return null
  }

  return {
    id: draft.id,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    saleType: draft.saleType,
    customerId: typeof draft.customerId === 'number' && Number.isFinite(draft.customerId) ? draft.customerId : undefined,
    lines: draft.lines.map((line) => ({
      variantId: line.variantId,
      productName: line.productName,
      size: line.size,
      color: line.color,
      qty: line.qty,
      unitPrice: line.unitPrice
    })),
    paidStr: typeof draft.paidStr === 'string' ? draft.paidStr : '',
    paidTouched: draft.paidTouched === true,
    discountStr: typeof draft.discountStr === 'string' ? draft.discountStr : '',
    promise: typeof draft.promise === 'string' ? draft.promise : '',
    bookPage: typeof draft.bookPage === 'string' ? draft.bookPage : ''
  }
}

export function readSaleDrafts(): SaleDraft[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeDraft)
      .filter((draft): draft is SaleDraft => draft !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_DRAFTS)
  } catch {
    return []
  }
}

export function saveSaleDraft(input: SaleDraftInput, previous?: SaleDraft): SaleDraft {
  const now = Date.now()
  const draft: SaleDraft = {
    ...input,
    id: previous?.id ?? globalThis.crypto?.randomUUID?.() ?? `sale-${now}-${Math.random().toString(36).slice(2)}`,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  }
  const others = readSaleDrafts().filter((item) => item.id !== draft.id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify([draft, ...others].slice(0, MAX_DRAFTS)))
  return draft
}

export function deleteSaleDraft(id: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readSaleDrafts().filter((draft) => draft.id !== id)))
}

export function saleDraftTotal(draft: Pick<SaleDraft, 'lines' | 'discountStr'>): number {
  const subtotal = draft.lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0)
  const rawDiscount = parseNum(draft.discountStr)
  return subtotal - Math.min(Math.max(rawDiscount, 0), subtotal)
}
